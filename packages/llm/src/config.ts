import { readFileSync } from 'node:fs';
import type { Prices } from '@synonyx/core';

export interface ModelEntry {
  id: string | null;
  provider: string | null;
  card: string | null;
  purpose: string;
  input_per_m: number | null;
  output_per_m: number | null;
  /** Куда отправлять запросы. По умолчанию OpenRouter и ключ из OPENROUTER_API_KEY. */
  api?: { base_url: string; key_env: string };
  /** Режим рассуждения (OpenRouter): по умолчанию выключен. */
  reasoning?: 'off' | 'low' | 'medium';
}

export const DEFAULT_API = { base_url: 'https://openrouter.ai/api/v1', key_env: 'OPENROUTER_API_KEY' };
export const apiOf = (m: ModelEntry) => m.api ?? DEFAULT_API;

export interface ModelsConfig {
  snapshot: { taken_at: string | null; source: string; note?: string };
  max_input_price_per_m: number;
  models: Record<'extract' | 'answer', ModelEntry>;
  fallbacks: ModelEntry[];
}

export function loadModels(path: string): ModelsConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as ModelsConfig;
}

export function pricesOf(m: ModelEntry): Prices | null {
  if (m.input_per_m === null || m.output_per_m === null) return null;
  return { input: m.input_per_m, output: m.output_per_m };
}

/** Проверка лимита ТЗ §7: max(P_in) по всем моделям контура, включая резервные, ≤ лимита. */
export function validateModels(cfg: ModelsConfig): string[] {
  const errors: string[] = [];
  const all = [...Object.entries(cfg.models).map(([k, m]) => [k, m] as const), ...cfg.fallbacks.map((m, i) => [`fallback#${i}`, m] as const)];
  for (const [key, m] of all) {
    if (!m.id) continue;
    if (m.input_per_m === null) errors.push(`${key}: не указан входной тариф для ${m.id}`);
    else if (m.input_per_m > cfg.max_input_price_per_m)
      errors.push(`${key}: входной тариф ${m.id} = $${m.input_per_m}/млн > лимита $${cfg.max_input_price_per_m}/млн`);
    if (m.output_per_m === null) errors.push(`${key}: не указан выходной тариф для ${m.id}`);
  }
  return errors;
}

export function isConfigured(cfg: ModelsConfig): boolean {
  const m = cfg.models.extract;
  return !!m.id && !!process.env[apiOf(m).key_env] && validateModels(cfg).length === 0;
}

/** Переменные из .env (если есть) — ключи не хранятся в коде и конфиге. */
export function loadDotEnv(path: string) {
  try {
    process.loadEnvFile(path);
  } catch {
    /* файла нет — используем переменные окружения */
  }
}
