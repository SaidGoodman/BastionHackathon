/**
 * Клиент OpenRouter Chat Completions с учётом usage (ТЗ §8):
 * https://openrouter.ai/docs/cookbook/administration/usage-accounting
 * Каждый вызов (включая неудачные и повторы) пишется в журнал; неизвестный usage не подменяется нулём.
 */
import { randomUUID } from 'node:crypto';
import { callCost, type CallLog, type Prices } from '@synonyx/core';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  provider?: string | null;
  prices: Prices | null;
  messages: ChatMessage[];
  purpose: CallLog['purpose'];
  sessionId: string;
  turnId: string;
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Режим рассуждения (только OpenRouter): 'off' — выключить. */
  reasoning?: 'off' | 'low' | 'medium';
}

export interface ChatResult {
  text: string;
  log: CallLog;
}

export type LogSink = (log: CallLog) => void;

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';

/**
 * Клиент Chat Completions. По умолчанию OpenRouter; другой OpenAI-совместимый API допустим по ТЗ §7
 * для той же модели из каталога — стоимость всё равно считается по тарифам снимка OpenRouter.
 */
export class OpenRouterClient {
  constructor(
    private apiKey: string,
    private sink: LogSink,
    private baseUrl = OPENROUTER_URL,
  ) {}

  /** Сам OpenRouter: поддерживает закрепление провайдера, usage.cost и объект reasoning. */
  private get isOpenRouter() {
    return this.baseUrl.startsWith(OPENROUTER_URL);
  }

  async chat(req: ChatRequest, attempt = 1): Promise<ChatResult> {
    const callId = randomUUID();
    const started = new Date();
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      temperature: req.temperature ?? 0,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.jsonMode) body.response_format = { type: 'json_object' };
    if (this.isOpenRouter) {
      body.usage = { include: true };
      // Закреплённый провайдер без переключений: иначе запрос может уйти к провайдеру дороже лимита.
      if (req.provider) body.provider = { order: [req.provider], allow_fallbacks: false };
      // Рассуждение извлечению не нужно: оно добавляет время и выходные токены.
      if (req.reasoning === 'off') body.reasoning = { enabled: false };
      else if (req.reasoning) body.reasoning = { effort: req.reasoning };
    } else if (req.reasoning) {
      // Посредники (ProxyAPI …/openrouter/v1) не передают provider и объект reasoning,
      // но понимают reasoning_effort: у DeepSeek V4.1 Flash «none» выключает рассуждение полностью.
      body.reasoning_effort = req.reasoning === 'off' ? 'none' : req.reasoning;
    }

    const base: Omit<CallLog, 'finished_at' | 'status' | 'input_tokens' | 'output_tokens' | 'cached_tokens' | 'reasoning_tokens' | 'cost_input_usd' | 'cost_output_usd' | 'cost_total_usd' | 'actual_cost_usd' | 'usage_source' | 'provider_response_id' | 'raw_usage'> = {
      session_id: req.sessionId,
      turn_id: req.turnId,
      call_id: callId,
      model_id: req.model,
      // Провайдер в журнале — только если он действительно закреплён (у посредников закрепления нет).
      provider: this.isOpenRouter ? (req.provider ?? null) : null,
      purpose: req.purpose,
      started_at: started.toISOString(),
      prices: req.prices,
      attempt,
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 20000);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'synonyx-assistant' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const json: any = await res.json().catch(() => ({}));
      const usage = json?.usage ?? null;
      const inTok: number | null = usage?.prompt_tokens ?? null;
      const outTok: number | null = usage?.completion_tokens ?? null;
      const cost = callCost(inTok, outTok, req.prices);
      const log: CallLog = {
        ...base,
        finished_at: new Date().toISOString(),
        status: res.ok && !json?.error ? 'ok' : 'error',
        input_tokens: inTok,
        output_tokens: outTok,
        cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens ?? null,
        // reasoning уже входит в completion_tokens — второй раз не прибавляем.
        reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
        cost_input_usd: cost.input,
        cost_output_usd: cost.output,
        cost_total_usd: cost.total,
        actual_cost_usd: typeof usage?.cost === 'number' ? usage.cost : null,
        usage_source: usage ? 'provider_response' : 'unknown',
        provider_response_id: json?.id ?? null,
        raw_usage: usage,
        provider: json?.provider ?? base.provider,
        ...(res.ok && !json?.error ? {} : { error: String(json?.error?.message ?? res.status) }),
      };
      this.sink(log);
      if (log.status !== 'ok') throw new Error(`API модели: ${log.error}`);
      return { text: json.choices?.[0]?.message?.content ?? '', log };
    } catch (e: any) {
      if (e?.name === 'AbortError' || !String(e?.message).startsWith('API модели:')) {
        this.sink({
          ...base,
          finished_at: new Date().toISOString(),
          status: e?.name === 'AbortError' ? 'cancelled' : 'error',
          input_tokens: null,
          output_tokens: null,
          cached_tokens: null,
          reasoning_tokens: null,
          cost_input_usd: null,
          cost_output_usd: null,
          cost_total_usd: null,
          actual_cost_usd: null,
          usage_source: 'unknown',
          provider_response_id: null,
          raw_usage: null,
          error: String(e?.message ?? e),
        });
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
