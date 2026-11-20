/**
 * Запуск: npm run dev (сервер + Vite) или npm start (собранный интерфейс отдаёт сервер).
 * Переменные окружения (или файл .env в корне): ключ модели (OPENROUTER_API_KEY либо key_env из config/models.json), SYNONYX_PORT (по умолчанию 8787), DEV=1 — сценарии для отладки интерфейса.
 */
import { fileURLToPath } from 'node:url';
import { apiOf, isConfigured, LlmExtractor, loadDotEnv, loadModels, NullExtractor, OpenRouterClient, validateModels, type Extractor } from '@synonyx/llm';
import { KbIndex } from '@synonyx/kb';
import { buildApp } from './app.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
loadDotEnv(root + '.env');
const cfg = loadModels(root + 'config/models.json');
const problems = validateModels(cfg);
if (problems.length) console.error('Конфигурация моделей не проходит проверку:\n  ' + problems.join('\n  '));

let extractor: Extractor = new NullExtractor();
// eslint-disable-next-line prefer-const
let sinkRef: { fn: (l: any) => void } = { fn: () => {} };
if (isConfigured(cfg)) {
  const api = apiOf(cfg.models.extract);
  const client = new OpenRouterClient(process.env[api.key_env]!, (l) => sinkRef.fn(l), api.base_url);
  extractor = new LlmExtractor(client, cfg);
} else {
  console.warn('Модель не настроена (config/models.json + ключ в .env) — свободный текст разбираться не будет.');
}

const { app, store } = buildApp({
  extractor,
  dataDir: root + 'data',
  webDist: root + 'apps/web/dist',
  dev: process.env.DEV === '1' || process.argv.includes('--dev'),
  modelsInfo: cfg,
  kb: KbIndex.fromDir(root + 'kb'),
});
sinkRef.fn = (l) => store.addCall(l);

const port = Number(process.env.SYNONYX_PORT ?? 8787);
app.listen({ port, host: '127.0.0.1' }).then(() => console.log(`Сервер: http://127.0.0.1:${port}`));
