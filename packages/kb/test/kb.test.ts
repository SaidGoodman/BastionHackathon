import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { applyOps, emptyState, evaluate, fixtures, SRC, type Op } from '@synonyx/core';
import { chunkMarkdown, KbIndex, stem, tokenize } from '../src/index.js';

const kb = KbIndex.fromDir(fileURLToPath(new URL('../../../kb', import.meta.url)));
const top = (q: string, k = 3) => kb.search(q, k);
const has = (q: string, file: string, section: string, k = 3) =>
  top(q, k).some((h) => h.chunk.file === file && h.chunk.section.startsWith(section));

describe('разбиение на разделы', () => {
  it('раздел = заголовок 2-го уровня, подраздел — «раздел — подраздел»; заголовки внутри ``` не режут текст', () => {
    const md = '# Док\n\nвступление\n\n## 1. Раз\n\nтекст\n\n### Под\n\nещё\n\n```\n# не заголовок\n```\n\n## 2. Два\n\nконец';
    const ch = chunkMarkdown('x.md', md);
    expect(ch.map((c) => c.section)).toEqual(['Док', '1. Раз', '1. Раз — Под', '2. Два']);
    expect(ch[2].text).toContain('# не заголовок');
  });

  it('индексируются только md базы; машинные эталоны 04_benchmarks.json не попадают в ответы', () => {
    const files = new Set(kb.chunks.map((c) => c.file));
    expect(files).toContain('01_scope_functions_synonyx_1.9.md');
    expect(files).toContain('02_methodology.md');
    expect([...files].some((f) => f.includes('benchmarks'))).toBe(false);
  });

  it('длинные разделы делятся на части, каждая не длиннее ~1,4 тыс. символов (кроме неделимого абзаца)', () => {
    for (const c of kb.chunks) if (c.text.length > 1400) expect(c.text.split(/\n\s*\n/)).toHaveLength(1);
  });
});

describe('ссылки на источники ведут на существующие разделы', () => {
  it('все ссылки методики расчёта (SRC) находят раздел', () => {
    for (const [k, ref] of Object.entries(SRC)) expect(kb.section(ref).length, k).toBeGreaterThan(0);
  });

  it('все источники в результатах открытых сценариев находят раздел', () => {
    for (const [name, ops] of Object.entries(fixtures as Record<string, Op[]>)) {
      const res = evaluate(applyOps(emptyState(), ops).state);
      const refs = [...res.sources, ...res.rules.flatMap((r) => r.sources)];
      for (const ref of refs) expect(kb.section(ref).length, `${name}: ${ref.file} § ${ref.section}`).toBeGreaterThan(0);
    }
  });
});

describe('поиск по вопросам о продукте', () => {
  it('Q01: число правил — раздел с ограничением 256', () => {
    const [h] = top('Сколько правил можно настроить на одном Синониксе?');
    expect(h.chunk.file).toBe('01_scope_functions_synonyx_1.9.md');
    expect(h.excerpt.join(' ')).toContain('256');
  });

  it('Q01 другими словами: «максимум правил»', () => {
    expect(top('Какой максимум правил на одном устройстве?', 4).some((h) => h.chunk.text.includes('256'))).toBe(true);
  });

  it('Q10: зачем МЭ — сравнение с NGFW и раздел размещения методики', () => {
    const q = 'Зачем ещё нужен межсетевой экран, если уже стоит Синоникс?';
    expect(has(q, '01_scope_functions_synonyx_1.9.md', '10.')).toBe(true);
    expect(has(q, '02_methodology.md', '2. Размещение')).toBe(true);
  });

  it('сокращение «МЭ» в вопросе находит то же, что «межсетевой экран»', () => {
    expect(has('А МЭ тогда для чего?', '02_methodology.md', '2. Размещение', 4)).toBe(true);
  });

  it('O01: встроенный антивирус — факт об отсутствии и проверки по ICAP', () => {
    const hits = top('Хотим проверять обновления встроенным антивирусом Синоникса', 3);
    expect(hits.some((h) => /встроенного\)? антивируса/i.test(h.chunk.text))).toBe(true);
    expect(hits.some((h) => h.chunk.text.includes('ICAP'))).toBe(true);
  });

  it('флешка к Узлу В: находится ограничение «USB только на Узле А»', () => {
    const hits = top('Можно ли подключить флешку к Узлу В?', 3);
    expect(hits.some((h) => /Узле В нет|только на Узле А/.test(h.chunk.text))).toBe(true);
  });

  it('прочие факты: скорость, сертификат, остановка обмена, подсеть', () => {
    expect(top('Какая скорость передачи?')[0].excerpt.join(' ')).toContain('1 Гбит/с');
    expect(top('Есть ли сертификат ФСТЭК?')[0].chunk.section).toBe('8. Сертификаты');
    expect(top('Как экстренно остановить обмен?')[0].chunk.section).toBe('6. Остановка обмена');
    expect(top('Можно открыть доступ ко всей подсети?')[0].chunk.text).toContain('диапазон адресов');
  });

  it('вопрос вне базы ничего не находит или находит слабо', () => {
    const hits = top('рецепт борща');
    expect(hits.every((h) => h.score < 4)).toBe(true);
  });
});

describe('токенизация', () => {
  it('формы слова сводятся к одной основе', () => {
    expect(new Set(['правило', 'правила', 'правил', 'правилам'].map(stem)).size).toBe(1);
    expect(new Set(['антивирус', 'антивируса', 'антивирусом'].map(stem)).size).toBe(1);
    expect(stem('межсетевой')).toBe(stem('межсетевого'));
  });

  it('«Узел А» и «Узел В» различаются, хотя «а» и «в» — стоп-слова', () => {
    expect(tokenize('к Узлу В')).toContain('nodeb');
    expect(tokenize('Узел А')).toContain('nodea');
    expect(tokenize('на Узле В нет')).toEqual(tokenize('к Узлу В'));
  });
});
