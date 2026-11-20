import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { AnswersRequest, MessageRequest, TimingReport } from '@synonyx/core';
import type { KbIndex } from '@synonyx/kb';
import type { Extractor } from '@synonyx/llm';
import { HttpError, SessionService } from './service.js';
import { Store } from './store.js';

export interface AppOptions {
  extractor: Extractor;
  dataDir: string | null;
  webDist?: string;
  dev?: boolean;
  modelsInfo?: unknown;
  kb?: KbIndex | null;
}

export function buildApp(opts: AppOptions): { app: FastifyInstance; service: SessionService; store: Store } {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  const store = new Store(opts.dataDir);
  const service = new SessionService(store, opts.extractor, opts.kb ?? null);

  app.setErrorHandler((err: any, _req, reply) => {
    const status = err instanceof HttpError ? err.status : (err.statusCode ?? 500);
    reply.status(status).send({ error: err.message ?? 'Внутренняя ошибка' });
  });

  app.get('/api/config', async () => ({
    llm: { configured: opts.extractor.configured, models: opts.extractor.models },
    models: opts.modelsInfo ?? null,
    dev: !!opts.dev,
    fixtures: opts.dev ? ['F02', 'F07', 'F01', 'F04', 'N01', 'N05', 'U01', 'U02a', 'U02b', 'THREE_NETS', 'BOTH_OPEN'] : [],
  }));

  app.post('/api/sessions', async () => service.create());

  // База знаний: поиск (отладка, автотесты) и текст раздела по ссылке-источнику (кнопки источников в интерфейсе).
  app.get<{ Querystring: { q?: string; k?: string } }>('/api/kb/search', async (req) => {
    const q = (req.query.q ?? '').trim();
    if (!q) throw new HttpError(400, 'Пустой запрос');
    const hits = opts.kb?.search(q, Math.min(10, Number(req.query.k) || 5)) ?? [];
    return { hits: hits.map((h) => ({ ...h.chunk, score: h.score, excerpt: h.excerpt })) };
  });
  app.get<{ Querystring: { file?: string; section?: string } }>('/api/kb/section', async (req) => {
    const { file = '', section = '' } = req.query;
    const chunks = opts.kb?.section({ file, section }) ?? [];
    if (!chunks.length) throw new HttpError(404, `Раздел не найден: ${file} § ${section}`);
    return { file, section, chunks };
  });
  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req) => service.view(service.get(req.params.id)));

  app.post<{ Params: { id: string }; Body: MessageRequest }>('/api/sessions/:id/messages', async (req) => {
    const { view, turnId } = await service.message(req.params.id, String(req.body?.text ?? ''));
    return { ...view, turnId };
  });

  app.post<{ Params: { id: string }; Body: AnswersRequest }>('/api/sessions/:id/answers', async (req) => {
    const { view, turnId } = await service.answers(req.params.id, req.body?.answers ?? []);
    return { ...view, turnId };
  });

  app.post<{ Params: { id: string }; Body: TimingReport }>('/api/sessions/:id/timing', async (req) => {
    service.timing(req.params.id, req.body.turnId, Number(req.body.clientMs));
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id/result.json', async (req, reply) => {
    const rec = service.get(req.params.id);
    reply.header('Content-Disposition', `attachment; filename="synonyx-${rec.id.slice(0, 8)}-v${rec.version}.json"`);
    return service.resultJson(rec);
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id/diagram.drawio', async (req, reply) => {
    const rec = service.get(req.params.id);
    reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="synonyx-${rec.id.slice(0, 8)}-v${rec.version}.drawio"`);
    return service.view(rec).drawio;
  });

  /** Журнал вызовов и шагов одной сессии (JSONL). */
  app.get<{ Params: { id: string } }>('/api/sessions/:id/log.jsonl', async (req, reply) => {
    const rec = service.get(req.params.id);
    const lines = [
      ...rec.calls.map((c) => JSON.stringify({ type: 'call', ...c })),
      ...rec.timings.map((t) => JSON.stringify({ type: 'turn', session_id: rec.id, ...t })),
    ];
    reply.header('Content-Type', 'application/x-ndjson; charset=utf-8').header('Content-Disposition', `attachment; filename="log-${rec.id.slice(0, 8)}.jsonl"`);
    return lines.join('\n') + '\n';
  });

  /** Выгрузка пожеланий для разработчика продукта по всем сессиям (доп. задание). */
  app.get('/api/vendor-requests', async () =>
    store.all().flatMap((s) => s.state.requestsForVendor.map((r) => ({ session_id: s.id, ...r }))),
  );

  if (opts.dev) {
    app.post<{ Params: { id: string; name: string } }>('/api/sessions/:id/dev/scenario/:name', async (req) =>
      service.devScenario(req.params.id, req.params.name),
    );
  }

  if (opts.webDist && existsSync(opts.webDist)) {
    app.register(fastifyStatic, { root: opts.webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Не найдено' });
      return reply.sendFile('index.html');
    });
  }

  return { app, service, store };
}
