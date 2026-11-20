/**
 * Поиск по базе знаний synonyx_base (kb/*.md): разделы по заголовкам, BM25 по ключевым словам.
 * Модели и эмбеддинги не используются — поиск бесплатный и не попадает в расходы сессии.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceRef } from '@synonyx/core';
import { queryTerms, tokenize } from './text.js';

export { tokenize, queryTerms, stem } from './text.js';

export interface KbChunk {
  /** Устойчивый id: `<файл>#<n>`, части длинного раздела — `<файл>#<n>.<k>`. */
  id: string;
  file: string;
  /** Раздел в формате источников: «2. Размещение» или «5. Передача файлов — Проверки файлов». */
  section: string;
  text: string;
}

export interface KbHit {
  chunk: KbChunk;
  score: number;
  /** Строки раздела, лучше всего отвечающие на запрос, в исходном порядке. */
  excerpt: string[];
}

/** Не индексируются: машинные эталоны открытых сценариев нельзя подмешивать в ответы. */
const SKIP = new Set(['04_benchmarks.json']);
const MAX_CHUNK = 1400;

const clean = (h: string) => h.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();

export function chunkMarkdown(file: string, md: string): KbChunk[] {
  const out: KbChunk[] = [];
  let h1 = '';
  let h2 = '';
  let h3 = '';
  let buf: string[] = [];
  let n = 0;
  const flush = () => {
    const body = buf.join('\n').trim();
    buf = [];
    if (!body) return;
    const section = h3 ? `${h2} — ${h3}` : h2 || h1;
    n++;
    const parts = splitLong(body);
    parts.forEach((text, k) => out.push({ id: parts.length > 1 ? `${file}#${n}.${k + 1}` : `${file}#${n}`, file, section, text }));
  };
  let fence = false;
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('```')) fence = !fence;
    const m = !fence && /^(#{1,3})\s/.exec(line);
    if (m) {
      flush();
      const level = m[1].length;
      if (level === 1) [h1, h2, h3] = [clean(line), '', ''];
      else if (level === 2) [h2, h3] = [clean(line), ''];
      else h3 = clean(line);
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}

/** Длинный раздел делится по пустым строкам на части не длиннее MAX_CHUNK (абзац, список и таблица не рвутся). */
function splitLong(body: string): string[] {
  if (body.length <= MAX_CHUNK) return [body];
  const parts: string[] = [];
  let cur = '';
  for (const p of body.split(/\n\s*\n/)) {
    if (cur && cur.length + p.length > MAX_CHUNK) {
      parts.push(cur.trim());
      cur = '';
    }
    cur += (cur ? '\n\n' : '') + p;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

interface Doc {
  chunk: KbChunk;
  tf: Map<string, number>;
  len: number;
}

export class KbIndex {
  private docs: Doc[];
  private df = new Map<string, number>();
  private avgLen: number;

  constructor(readonly chunks: KbChunk[]) {
    this.docs = chunks.map((chunk) => {
      // Заголовок раздела весит вдвое больше текста.
      const head = tokenize(chunk.section);
      const toks = [...head, ...head, ...tokenize(chunk.text)];
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      return { chunk, tf, len: toks.length };
    });
    for (const d of this.docs) for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }

  static fromDir(dir: string): KbIndex {
    const chunks: KbChunk[] = [];
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.md') || SKIP.has(f)) continue;
      chunks.push(...chunkMarkdown(f, readFileSync(join(dir, f), 'utf8')));
    }
    return new KbIndex(chunks);
  }

  search(query: string, k = 4): KbHit[] {
    const terms = queryTerms(query);
    if (!terms.size) return [];
    const N = this.docs.length;
    const k1 = 1.2;
    const b = 0.75;
    return this.docs
      .map((d) => {
        let score = 0;
        for (const [t, w] of terms) {
          const f = d.tf.get(t);
          if (!f) continue;
          const df = this.df.get(t)!;
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          score += w * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / this.avgLen)));
        }
        score *= weightOf(d.chunk);
        return { d, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ d, score }) => ({ chunk: d.chunk, score: Math.round(score * 100) / 100, excerpt: excerpt(d.chunk.text, terms) }));
  }

  /**
   * Все части раздела по ссылке-источнику (показ «откуда это» в интерфейсе). Подразделы входят в раздел;
   * подраздел можно назвать и без родителя: «3.1. Правила передачи данных».
   */
  section(ref: SourceRef): KbChunk[] {
    const s = ref.section;
    return this.chunks.filter((c) => c.file === ref.file && (c.section === s || c.section.startsWith(s + ' — ') || c.section.endsWith(' — ' + s)));
  }

  get(id: string): KbChunk | undefined {
    return this.chunks.find((c) => c.id === id);
  }
}

/**
 * Приоритет фактов о продукте — справочник версии 1.9 (ТЗ, раздел об источниках).
 * Разделы методики о порядке диалога, формате ответа и оформлении схемы — инструкции ассистенту,
 * а не сведения о продукте: в выдаче они ниже.
 */
function weightOf(c: KbChunk): number {
  if (c.file.startsWith('01_')) return 1.15;
  if (c.file.startsWith('00_')) return 0.5;
  if (c.file.startsWith('02_') && /^(1|4|5|6)\. /.test(c.section)) return 0.6;
  return 1;
}

export function refOf(c: KbChunk): SourceRef {
  return { file: c.file, section: c.section };
}

/** Строки (пункты списка, абзацы, строки таблицы), в которых больше всего слов запроса. */
function excerpt(text: string, terms: Map<string, number>, max = 3): string[] {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\|?[\s|:-]*-{3,}/.test(l));
  const best = lines
    .map((l, i) => {
      const toks = new Set(tokenize(l));
      let s = 0;
      for (const [t, w] of terms) if (toks.has(t)) s += w;
      return { l, i, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => tidy(x.l));
  return best.length ? best : lines.slice(0, 1).map(tidy);
}

const tidy = (l: string) =>
  l
    .replace(/^[-*]\s+/, '')
    .replace(/^\|\s*|\s*\|$/g, '')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s{2,}/g, ' ');
