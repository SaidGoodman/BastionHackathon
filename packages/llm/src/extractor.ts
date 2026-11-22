/**
 * Извлечение: свободный текст пользователя → намерение + операции над состоянием (Op[]).
 * Модель не считает правила и не рисует схему — это делает детерминированный движок.
 */
import type { ChatTurn, EngineResult, Op, SessionState, SourceRef } from '@synonyx/core';
import type { ModelsConfig } from './config.js';
import { pricesOf } from './config.js';
import type { OpenRouterClient } from './openrouter.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { InvalidModelOutputError, validateExtractOutput } from './validation.js';

export type Intent =
  | 'describe' // новое описание задачи или дополнение
  | 'modify' // правка готовой схемы
  | 'question_about_solution' // вопрос о текущей схеме — конфигурацию не меняет
  | 'product_question' // вопрос о возможностях продукта — ответ по базе знаний
  | 'ambiguous' // неоднозначная правка — нужно уточнение, конфигурацию не меняем
  | 'off_topic';

export interface ExtractInput {
  sessionId: string;
  turnId: string;
  state: SessionState;
  result: EngineResult | null;
  history: ChatTurn[];
  text: string;
  /** Фрагменты базы знаний, найденные по сообщению (поиск без модели). */
  kb?: KbSnippet[];
}

export interface KbSnippet {
  id: string;
  file: string;
  section: string;
  text: string;
  /** Строки фрагмента, ближе всего к запросу. */
  excerpt: string[];
  score: number;
}

export interface ExtractOutput {
  intent: Intent;
  ops: Op[];
  /** Ответ пользователю словами модели (для вопросов о схеме, уточнений, отказов). */
  reply?: string;
  sources?: SourceRef[];
}

export interface Extractor {
  readonly configured: boolean;
  readonly models: string[];
  extract(input: ExtractInput): Promise<ExtractOutput>;
}

const QUESTION = /\?|^(сколько|зачем|почему|как|что|чем|какой|какая|какие|каким|где|когда|можно ли|есть ли|поддерживает|умеет|нужен ли|нужно ли)(\s|$)/i;
/** Порог BM25, ниже которого найденное считается случайным совпадением слов. */
const KB_MIN_SCORE = 4;

/**
 * Заглушка, пока модель не выбрана: интерфейс и движок работают, описание задачи не разбирается.
 * На вопрос о продукте отвечает дословными выдержками из найденных разделов базы знаний.
 */
export class NullExtractor implements Extractor {
  readonly configured = false;
  readonly models: string[] = [];
  async extract(input: ExtractInput): Promise<ExtractOutput> {
    const hits = (input.kb ?? []).filter((h) => h.score >= KB_MIN_SCORE).slice(0, 2);
    if (QUESTION.test(input.text.trim()) && hits.length) {
      return {
        intent: 'product_question',
        ops: [],
        reply: [
          'Модель не подключена, поэтому привожу дословные выдержки из базы знаний без пересказа:',
          ...hits.map((h) => h.excerpt.map((l) => '— ' + l).join('\n') + `\n(${h.file}, § ${h.section})`),
        ].join('\n\n'),
        sources: hits.map((h) => ({ file: h.file, section: h.section })),
      };
    }
    return {
      intent: 'off_topic',
      ops: [],
      reply:
        'Модель ещё не подключена, поэтому свободный текст пока не разбирается. ' +
        'Ответы на карточки вопросов работают без модели. Для проверки интерфейса в режиме разработки можно загрузить открытый сценарий.',
    };
  }
}

export class LlmExtractor implements Extractor {
  readonly configured = true;
  constructor(
    private client: OpenRouterClient,
    private cfg: ModelsConfig,
  ) {}

  get models(): string[] {
    return [this.cfg.models.extract.id, this.cfg.models.answer.id].filter((x): x is string => !!x);
  }

  async extract(input: ExtractInput): Promise<ExtractOutput> {
    const m = this.cfg.models.extract;
    const user = JSON.stringify({
      state: compactState(input.state),
      rules: input.result?.rules.map((r) => ({ id: r.id, type: r.type, from: r.from, to: r.to, mode: r.mode, protocol: r.protocol, port: r.port, description: r.description })),
      pending_questions: input.result?.questions.map((q) => q.id),
      recent: input.history.slice(-6).map((t) => ({ role: t.role, text: t.text.slice(0, 600) })),
      kb: (input.kb ?? []).map((k) => ({ id: k.id, file: k.file, section: k.section, text: k.text })),
      message: input.text,
    });
    const messages: import('./openrouter.js').ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      const { text } = await this.client.chat({
        model: m.id!, provider: m.provider, prices: pricesOf(m), purpose: 'extract',
        sessionId: input.sessionId, turnId: input.turnId, jsonMode: true,
        reasoning: m.reasoning ?? 'off', messages,
      });
      try {
        const output = parseOutput(text, input.kb, true);
        validateExtractOutput(output, input.state, input.kb);
        return output;
      } catch (error) {
        if (attempt > 0 || !(error instanceof InvalidModelOutputError || error instanceof SyntaxError)) throw error;
        messages.push({ role: 'assistant', content: text });
        messages.push({ role: 'user', content: `Предыдущий ответ не прошёл проверку: ${error.message}. Исправь JSON. Не выдумывай изменения: примени однозначные корректные части запроса, а по остальным кратко попроси уточнение. Для FTP и SMB проверь тип потока и способ передачи.` });
      }
    }
    throw new InvalidModelOutputError('не удалось исправить ответ');
  }
}

function compactState(s: SessionState) {
  return {
    networks: s.networks,
    protectedNetwork: s.protectedNetwork,
    existingFirewall: s.existingFirewall,
    devices: s.devices,
    flows: s.flows,
  };
}

export function parseOutput(text: string, kb: KbSnippet[] = [], strictSources = false): ExtractOutput {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const json = JSON.parse(start >= 0 ? text.slice(start, end + 1) : text);
  if (strictSources && (!json || typeof json !== 'object' || Array.isArray(json))) throw new InvalidModelOutputError('корень JSON должен быть объектом');
  if (strictSources && typeof json.intent !== 'string') throw new InvalidModelOutputError('поле intent должно быть строкой');
  if (strictSources && !Array.isArray(json.ops)) throw new InvalidModelOutputError('поле ops должно быть массивом');
  if (strictSources && json.sources !== undefined && !Array.isArray(json.sources)) throw new InvalidModelOutputError('поле sources должно быть массивом');
  if (strictSources && json.reply !== undefined && typeof json.reply !== 'string') throw new InvalidModelOutputError('поле reply должно быть строкой');
  const intent: Intent = json.intent ?? 'describe';
  const ops: Op[] = Array.isArray(json.ops) ? json.ops : [];
  // Модель называет id фрагментов; ссылку «файл § раздел» строим сами — выдуманный id отбрасывается.
  const ids: string[] = Array.isArray(json.sources) ? json.sources.filter((x: unknown) => typeof x === 'string') : [];
  if (strictSources && Array.isArray(json.sources) && (json.sources.some((x: unknown) => typeof x !== 'string') || ids.some((id) => !kb.some((k) => k.id === id)))) {
    throw new InvalidModelOutputError('указан неизвестный источник базы знаний');
  }
  const sources = ids.map((id) => kb.find((k) => k.id === id)).filter((k): k is KbSnippet => !!k).map((k) => ({ file: k.file, section: k.section }));
  return { intent, ops, reply: typeof json.reply === 'string' ? json.reply : undefined, sources: sources.length ? sources : undefined };
}
