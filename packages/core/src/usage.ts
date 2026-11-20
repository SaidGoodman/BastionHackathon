/**
 * Учёт модельных вызовов и стоимости (ТЗ §7–8). Чистые функции: используются и сервером, и интерфейсом.
 * C_call = (T_in × P_in + T_out × P_out) / 1 000 000; кэшированные входные токены — по базовому входному тарифу.
 */

export interface Prices {
  /** USD за 1 млн входных токенов. */
  input: number;
  /** USD за 1 млн выходных токенов. */
  output: number;
}

export interface CallLog {
  session_id: string;
  turn_id: string;
  call_id: string;
  model_id: string;
  provider: string | null;
  purpose: 'extract' | 'answer' | 'check' | 'embedding' | 'other';
  started_at: string;
  finished_at: string;
  status: 'ok' | 'error' | 'cancelled';
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  prices: Prices | null;
  cost_input_usd: number | null;
  cost_output_usd: number | null;
  cost_total_usd: number | null;
  /** usage.cost от провайдера — хранится отдельно от оценочной стоимости. */
  actual_cost_usd: number | null;
  usage_source: 'provider_response' | 'provider_generation_api' | 'unknown';
  provider_response_id: string | null;
  raw_usage: unknown;
  error?: string;
  attempt?: number;
}

export function callCost(inputTokens: number | null, outputTokens: number | null, p: Prices | null) {
  if (!p || inputTokens === null || outputTokens === null) return { input: null, output: null, total: null };
  const input = (inputTokens * p.input) / 1_000_000;
  const output = (outputTokens * p.output) / 1_000_000;
  return { input, output, total: input + output };
}

export interface ModelUsage {
  model_id: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_input_usd: number;
  cost_output_usd: number;
  cost_total_usd: number;
  prices: Prices | null;
}

export interface UsageSummary {
  calls: number;
  /** Вызовы без подтверждённого usage: их стоимость не подставляется нулём. */
  unconfirmed_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_input_usd: number;
  cost_output_usd: number;
  cost_total_usd: number;
  actual_cost_usd: number | null;
  by_model: ModelUsage[];
}

/** Сводка по журналу. Повторная запись одного call_id не удваивает расход. */
export function summarize(calls: CallLog[]): UsageSummary {
  const uniq = new Map<string, CallLog>();
  for (const c of calls) uniq.set(c.call_id, c);
  const s: UsageSummary = {
    calls: uniq.size,
    unconfirmed_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cost_input_usd: 0,
    cost_output_usd: 0,
    cost_total_usd: 0,
    actual_cost_usd: null,
    by_model: [],
  };
  const byModel = new Map<string, ModelUsage>();
  for (const c of uniq.values()) {
    if (c.input_tokens === null || c.output_tokens === null || c.cost_total_usd === null) {
      s.unconfirmed_calls++;
      continue;
    }
    s.input_tokens += c.input_tokens;
    s.output_tokens += c.output_tokens;
    s.cost_input_usd += c.cost_input_usd ?? 0;
    s.cost_output_usd += c.cost_output_usd ?? 0;
    s.cost_total_usd += c.cost_total_usd;
    if (c.actual_cost_usd !== null) s.actual_cost_usd = (s.actual_cost_usd ?? 0) + c.actual_cost_usd;
    const m = byModel.get(c.model_id) ?? {
      model_id: c.model_id,
      calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost_input_usd: 0,
      cost_output_usd: 0,
      cost_total_usd: 0,
      prices: c.prices,
    };
    m.calls++;
    m.input_tokens += c.input_tokens;
    m.output_tokens += c.output_tokens;
    m.cost_input_usd += c.cost_input_usd ?? 0;
    m.cost_output_usd += c.cost_output_usd ?? 0;
    m.cost_total_usd += c.cost_total_usd;
    byModel.set(c.model_id, m);
  }
  s.by_model = [...byModel.values()];
  return s;
}

/** Сумма в USD без превращения малой ненулевой стоимости в «$0,00». */
export function formatUsd(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'не подтверждено';
  if (v === 0) return '$0';
  if (v < 0.000001) return 'менее $0,000001';
  const digits = v >= 1 ? 4 : Math.min(10, Math.max(6, 2 - Math.floor(Math.log10(v)) + 3));
  return '$' + v.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}
