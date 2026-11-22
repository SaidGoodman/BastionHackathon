/**
 * Обработка шагов сессии. Один шаг = сообщение или ответы на карточки → ответ ассистента
 * с согласованно обновлёнными текстом, таблицей, JSON и схемой.
 */
import { randomUUID } from 'node:crypto';
import {
  answerToOps,
  applyOps,
  emptyState,
  evaluate,
  explain,
  fixtures,
  summarize,
  toResultJson,
  uniqSources,
  type AnswerValue,
  type ChatTurn,
  type EngineResult,
  type Op,
  type Question,
  type SessionState,
  type SessionView,
  type SourceRef,
  type TurnTiming,
} from '@synonyx/core';
import { toDrawio } from '@synonyx/diagram';
import type { KbIndex } from '@synonyx/kb';
import type { Extractor, ExtractOutput, KbSnippet } from '@synonyx/llm';
import type { SessionRecord, Store } from './store.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const CHANGING = new Set(['describe', 'modify']);

export class SessionService {
  constructor(
    private store: Store,
    private extractor: Extractor,
    private kb: KbIndex | null = null,
  ) {}

  /** Поиск по базе знаний без модели: фрагменты для промпта и для ответа выдержками. */
  snippets(text: string, k = 4): KbSnippet[] {
    return (this.kb?.search(text, k) ?? []).map((h) => ({
      id: h.chunk.id,
      file: h.chunk.file,
      section: h.chunk.section,
      text: h.chunk.text,
      excerpt: h.excerpt,
      score: h.score,
    }));
  }

  create(): SessionView {
    const rec: SessionRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      version: 0,
      state: emptyState(),
      lastGood: null,
      history: [],
      calls: [],
      timings: [],
    };
    this.store.save(rec);
    return this.view(rec);
  }

  get(id: string): SessionRecord {
    const rec = this.store.get(id);
    if (!rec) throw new HttpError(404, 'Сессия не найдена');
    return rec;
  }

  view(rec: SessionRecord): SessionView {
    const result = evaluate(rec.state);
    const timed = rec.timings.filter((t) => t.status === 'ok');
    const mean = timed.length ? timed.reduce((s, t) => s + (t.client_ms ?? t.server_ms), 0) / timed.length / 1000 : null;
    return {
      id: rec.id,
      createdAt: rec.createdAt,
      version: rec.version,
      state: rec.state,
      result,
      explanation: explain(rec.state, result),
      drawio: toDrawio(rec.state, result),
      pendingQuestions: result.questions,
      history: rec.history,
      usage: summarize(rec.calls),
      timing: { turns: rec.timings, mean_seconds: mean },
      llm: { configured: this.extractor.configured, models: this.extractor.models },
    };
  }

  resultJson(rec: SessionRecord) {
    const result = evaluate(rec.state);
    const timed = rec.timings.filter((t) => t.status === 'ok');
    return toResultJson(rec.state, result, {
      sessionId: rec.id,
      usage: { ...summarize(rec.calls), calls: rec.calls },
      timing: {
        turns: rec.timings,
        mean_turn_seconds: timed.length ? timed.reduce((s, t) => s + (t.client_ms ?? t.server_ms), 0) / timed.length / 1000 : null,
      },
    });
  }

  // ------------------------------------------------------------------ шаги

  async message(id: string, text: string): Promise<{ view: SessionView; turnId: string }> {
    const rec = this.get(id);
    const clean = text.trim();
    if (!clean) throw new HttpError(400, 'Пустое сообщение');
    const turnId = randomUUID();
    return this.step(rec, turnId, 'message', { id: randomUUID(), role: 'user', at: now(), kind: 'message', text: clean }, async () => {
      const out = await this.extractor.extract({
        sessionId: rec.id,
        turnId,
        state: rec.state,
        result: evaluate(rec.state),
        history: rec.history,
        text: clean,
        kb: this.snippets(clean),
      });
      return out;
    });
  }

  async answers(id: string, answers: { questionId: string; value: AnswerValue }[]): Promise<{ view: SessionView; turnId: string }> {
    const rec = this.get(id);
    if (!answers.length) throw new HttpError(400, 'Нет ответов');
    const pending = evaluate(rec.state).questions;
    const turnId = randomUUID();
    const labels = answers.map((a) => ({ questionId: a.questionId, label: answerLabel(pending.find((q) => q.id === a.questionId), a.value) }));
    const userTurn: ChatTurn = {
      id: randomUUID(),
      role: 'user',
      at: now(),
      kind: 'answers',
      text: labels.map((l) => l.label).join('; '),
      answers: labels,
    };
    return this.step(rec, turnId, 'answers', userTurn, async () => {
      // Клик по варианту превращается в операции без вызова модели.
      let state = rec.state;
      const ops: Op[] = [];
      const forLlm: string[] = [];
      for (const a of answers) {
        const r = answerToOps(state, a.questionId, a.value);
        ops.push(...r.ops);
        state = applyOps(state, r.ops).state;
        if (r.forLlm) {
          const q = pending.find((x) => x.id === a.questionId);
          forLlm.push(q ? `На вопрос «${q.text}»${q.context ? ` (${q.context})` : ''} пользователь ответил: ${r.forLlm}` : r.forLlm);
        }
      }
      if (forLlm.length && this.extractor.configured) {
        const text = forLlm.join('\n');
        const out = await this.extractor.extract({ sessionId: rec.id, turnId, state, result: evaluate(state), history: rec.history, text, kb: this.snippets(text) });
        return { ...out, intent: CHANGING.has(out.intent) ? out.intent : 'describe', ops: [...ops, ...out.ops] };
      }
      return { intent: 'describe', ops };
    });
  }

  /** Режим разработки: применить готовый сценарий без модели (не используется в зачётном прогоне). */
  devScenario(id: string, name: string): SessionView {
    const rec = this.get(id);
    const ops = (fixtures as Record<string, Op[]>)[name];
    if (!ops) throw new HttpError(404, `Нет сценария ${name}`);
    rec.state = applyOps(rec.state, ops).state;
    rec.version++;
    const result = evaluate(rec.state);
    rec.history.push({ id: randomUUID(), role: 'user', at: now(), kind: 'message', text: `[dev] загружен сценарий ${name}` });
    rec.history.push(assistantTurn(rec.state, result, rec.version));
    this.store.save(rec);
    return this.view(rec);
  }

  timing(id: string, turnId: string, clientMs: number) {
    const rec = this.get(id);
    const t = rec.timings.find((x) => x.turn_id === turnId);
    if (!t) throw new HttpError(404, 'Шаг не найден');
    t.client_ms = Math.round(clientMs);
    this.store.addTiming(rec.id, t);
    this.store.save(rec);
  }

  private async step(
    rec: SessionRecord,
    turnId: string,
    kind: 'message' | 'answers',
    userTurn: ChatTurn,
    run: () => Promise<ExtractOutput>,
  ): Promise<{ view: SessionView; turnId: string }> {
    const t0 = Date.now();
    const startedAt = now();
    const callsBefore = rec.calls.length;
    try {
      const out = await run();
      const vendorBefore = rec.state.requestsForVendor.length;
      const prevResult = evaluate(rec.state);
      let reply = out.reply;

      if (CHANGING.has(out.intent)) {
        const { state: next, errors } = applyOps(rec.state, out.ops);
        const nextResult = evaluate(next);
        const blocking = nextResult.issues.filter((i) => i.severity === 'error');
        if (blocking.length && rec.lastGood && (prevResult.status === 'completed' || prevResult.status === 'preliminary')) {
          // Недопустимое изменение: последнее корректное решение сохраняется.
          reply = [reply, ...blocking.map((b) => b.text), 'Изменение не применено, последнее корректное решение сохранено.'].filter(Boolean).join('\n\n');
          rec.state = { ...rec.state, requestsForVendor: next.requestsForVendor };
        } else {
          if (JSON.stringify(stripMeta(next)) !== JSON.stringify(stripMeta(rec.state))) rec.version++;
          rec.state = next;
          if (!blocking.length && (nextResult.status === 'completed' || nextResult.status === 'preliminary')) rec.lastGood = next;
        }
        if (errors.length) console.warn('applyOps errors', errors);
      } else {
        // Вопрос о схеме или о продукте конфигурацию не меняет; сохраняем только пожелания для разработчика.
        const vendorOps = out.ops.filter((o) => o.op === 'add_vendor_request');
        if (vendorOps.length) rec.state = applyOps(rec.state, vendorOps).state;
      }

      const newVendor = rec.state.requestsForVendor.slice(vendorBefore).map((r) => ({ ...r, turnId }));
      if (newVendor.length) this.store.addVendorRequests(rec.id, newVendor);

      const result = evaluate(rec.state);
      rec.history.push(userTurn);
      const changed = CHANGING.has(out.intent);
      const assistant: ChatTurn = changed
        ? assistantTurn(rec.state, result, rec.version, reply, out.sources)
        : { id: randomUUID(), role: 'assistant', at: now(), kind: 'reply', text: reply ?? 'Готово.', resultVersion: rec.version, sources: out.sources };
      // При явной просьбе показать схему сохраняем снимок именно этого ответа в истории.
      const diagramRequest = /(?:схем|диаграмм)/i.test(userTurn.text) && /(?:нарис|постро|отрис|покаж|показ|созда|сдела|сгенер|вывед)/i.test(userTurn.text);
      if (kind === 'message' && diagramRequest && (result.rules.length > 0 || result.status !== 'needs_clarification')) {
        assistant.diagramXml = toDrawio(rec.state, result);
      }
      rec.history.push(assistant);
      const timing: TurnTiming = {
        turn_id: turnId,
        kind,
        started_at: startedAt,
        server_ms: Date.now() - t0,
        client_ms: null,
        llm_calls: rec.calls.length - callsBefore,
        status: 'ok',
      };
      rec.timings.push(timing);
      this.store.addTiming(rec.id, timing);
      this.store.save(rec);
      return { view: this.view(rec), turnId };
    } catch (e: any) {
      // Неудачный шаг фиксируется (вызовы с начисленными токенами уже в журнале), состояние не меняется.
      const timing: TurnTiming = {
        turn_id: turnId,
        kind,
        started_at: startedAt,
        server_ms: Date.now() - t0,
        client_ms: null,
        llm_calls: rec.calls.length - callsBefore,
        status: 'error',
      };
      rec.timings.push(timing);
      this.store.addTiming(rec.id, timing);
      this.store.save(rec);
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, `Не удалось обработать запрос: ${e?.message ?? e}. Введённые данные сохранены — можно повторить.`);
    }
  }
}

function assistantTurn(state: SessionState, res: EngineResult, version: number, prefix?: string, extra: SourceRef[] = []): ChatTurn {
  const parts: string[] = [];
  if (prefix) parts.push(prefix);
  if (res.status === 'needs_clarification') {
    for (const i of res.issues.filter((x) => x.severity !== 'info' || res.rules.length === 0)) parts.push(i.text);
    parts.push(res.questions.length ? 'Уточню параметры, от которых зависят правила:' : 'Нужно уточнить описание.');
  } else {
    // В чат — первый абзац объяснения без разметки; полное объяснение во вкладке.
    parts.push(explain(state, res).split('\n\n')[0].replace(/\*\*/g, ''));
    parts.push('Объяснение, таблица правил и схема обновлены.');
  }
  return {
    id: randomUUID(),
    role: 'assistant',
    at: now(),
    kind: 'reply',
    text: parts.join('\n\n'),
    questions: res.questions.length ? res.questions : undefined,
    resultVersion: version,
    // Сначала источники фактического ответа модели, затем методика расчёта.
    sources: uniqSources([...extra, ...res.sources]),
  };
}

function answerLabel(q: Question | undefined, v: AnswerValue): string {
  const head = q ? `${q.text} — ` : '';
  if (v === 'unknown') return head + 'не знаю';
  if (typeof v === 'object' && !Array.isArray(v)) return head + `другое: ${v.other}`;
  const vals = Array.isArray(v) ? v : [v];
  return head + vals.map((x) => q?.options.find((o) => o.value === x)?.label ?? x).join(', ');
}

function stripMeta(s: SessionState) {
  const { asked: _a, rejected: _r, ...rest } = s;
  return rest;
}

const now = () => new Date().toISOString();
