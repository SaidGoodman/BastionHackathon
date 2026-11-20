import { describe, expect, it } from 'vitest';
import { callCost, fixtures, formatUsd, summarize, type CallLog, type Op } from '@synonyx/core';
import { fileURLToPath } from 'node:url';
import { KbIndex } from '@synonyx/kb';
import { NullExtractor, parseOutput, type ExtractInput, type ExtractOutput, type Extractor } from '@synonyx/llm';
import { buildApp } from '../src/app.js';

/** Поддельная модель: отвечает по сценарию и пишет «вызов» в журнал, как настоящий клиент. */
class FakeExtractor implements Extractor {
  configured = true;
  models = ['fake/model'];
  constructor(
    private script: (input: ExtractInput) => ExtractOutput | Promise<ExtractOutput>,
    private sink?: (l: CallLog) => void,
  ) {}
  async extract(input: ExtractInput) {
    const c = callCost(1000, 200, { input: 0.1, output: 0.4 });
    this.sink?.({
      session_id: input.sessionId, turn_id: input.turnId, call_id: `${input.turnId}-1`, model_id: 'fake/model', provider: null, purpose: 'extract',
      started_at: '', finished_at: '', status: 'ok', input_tokens: 1000, output_tokens: 200, cached_tokens: null, reasoning_tokens: null,
      prices: { input: 0.1, output: 0.4 }, cost_input_usd: c.input, cost_output_usd: c.output, cost_total_usd: c.total, actual_cost_usd: null,
      usage_source: 'provider_response', provider_response_id: 'gen-1', raw_usage: {},
    });
    return this.script(input);
  }
}

function setup(script: (input: ExtractInput) => ExtractOutput | Promise<ExtractOutput>) {
  const holder: { sink?: (l: CallLog) => void } = {};
  const extractor = new FakeExtractor(script, (l) => holder.sink?.(l));
  const built = buildApp({ extractor, dataDir: null, dev: true });
  holder.sink = (l) => built.store.addCall(l);
  return built;
}

async function post(app: any, url: string, body?: unknown) {
  const res = await app.inject({ method: 'POST', url, payload: body });
  return { status: res.statusCode, json: res.json() };
}

describe('цикл сессии', () => {
  it('описание → готовый результат с JSON, drawio и учётом стоимости', async () => {
    const { app } = setup(() => ({ intent: 'describe', ops: fixtures.F02 }));
    const s = (await post(app, '/api/sessions')).json;
    const r = await post(app, `/api/sessions/${s.id}/messages`, { text: 'насосная станция…' });
    expect(r.status).toBe(200);
    expect(r.json.result.status).toBe('completed');
    expect(r.json.result.rulesCount).toBe(3);
    expect(r.json.drawio).toContain('<mxfile');
    expect(r.json.usage.calls).toBe(1);
    expect(r.json.usage.cost_total_usd).toBeCloseTo(0.00018, 10);
    expect(r.json.history).toHaveLength(2);

    const json = (await app.inject({ method: 'GET', url: `/api/sessions/${s.id}/result.json` })).json();
    expect(json.rules_count).toBe(3);
    expect(json.session_id).toBe(s.id);
    expect(json.usage.calls).toHaveLength(1);

    const drawio = await app.inject({ method: 'GET', url: `/api/sessions/${s.id}/diagram.drawio` });
    expect(drawio.headers['content-disposition']).toContain('.drawio');
    expect(drawio.body.startsWith('<mxfile')).toBe(true);

    await post(app, `/api/sessions/${s.id}/timing`, { turnId: r.json.turnId, clientMs: 1234 });
    const log = (await app.inject({ method: 'GET', url: `/api/sessions/${s.id}/log.jsonl` })).body.trim().split('\n').map((l: string) => JSON.parse(l));
    expect(log.filter((l: any) => l.type === 'call')).toHaveLength(1);
    expect(log.find((l: any) => l.type === 'turn').client_ms).toBe(1234);
  });

  it('ответы на карточки обрабатываются без модели', async () => {
    let calls = 0;
    const { app } = setup(() => {
      calls++;
      return { intent: 'describe', ops: fixtures.N05 };
    });
    const s = (await post(app, '/api/sessions')).json;
    const r1 = (await post(app, `/api/sessions/${s.id}/messages`, { text: 'журналы и обновления' })).json;
    expect(r1.result.status).toBe('needs_clarification');
    expect(r1.history.at(-1).questions.length).toBeGreaterThan(0);

    const r2 = await post(app, `/api/sessions/${s.id}/answers`, {
      answers: [
        { questionId: 'ff:f2:send:n1', value: 'usb' },
        { questionId: 'ff:f2:recv:n2', value: 'push:SMB' },
        { questionId: 'ff:f2:checks', value: ['icap_av'] },
        { questionId: 'ff:f2:differentChecks', value: 'no' },
        { questionId: 'ff:f2:isolation', value: 'shared' },
        { questionId: 'ff:f2:users', value: '1' },
      ],
    });
    expect(r2.status).toBe(200);
    // Способ и протокол PUSH — одним ответом, второго шага уточнений нет.
    const view = r2.json;
    expect(view.pendingQuestions).toEqual([]);
    expect(view.result.status).toBe('completed');
    expect(JSON.stringify(view.result.rules[1].protocol)).toContain('SMB');
    expect(view.result.rulesCount).toBe(2);
    expect(calls).toBe(1);
    expect(view.usage.calls).toBe(1);
  });

  it('«другое» сохраняется в пожелания для разработчика', async () => {
    const { app } = setup(() => ({ intent: 'describe', ops: fixtures.N01 }));
    const s = (await post(app, '/api/sessions')).json;
    await post(app, `/api/sessions/${s.id}/messages`, { text: 'обмен файлами' });
    const r = (await post(app, `/api/sessions/${s.id}/answers`, { answers: [{ questionId: 'ff:f1:checks', value: { other: 'проверка по хешу из нашего реестра' } }] })).json;
    expect(r.state.requestsForVendor.map((x: any) => x.text)).toContain('проверка по хешу из нашего реестра');
    const all = (await app.inject({ method: 'GET', url: '/api/vendor-requests' })).json();
    expect(all[0].session_id).toBe(s.id);
  });

  it('вопрос о схеме не меняет конфигурацию', async () => {
    let n = 0;
    const { app } = setup(() =>
      n++ === 0 ? { intent: 'describe', ops: fixtures.F01 } : { intent: 'question_about_solution', ops: fixtures.F02 as Op[], reply: 'Один получатель — одно правило.' },
    );
    const s = (await post(app, '/api/sessions')).json;
    const r1 = (await post(app, `/api/sessions/${s.id}/messages`, { text: 'F01' })).json;
    const r2 = (await post(app, `/api/sessions/${s.id}/messages`, { text: 'почему одно правило?' })).json;
    expect(r2.version).toBe(r1.version);
    expect(r2.result.rulesCount).toBe(1);
    expect(r2.history.at(-1).text).toContain('Один получатель');
    expect(r2.usage.calls).toBe(2);
  });

  it('недопустимая правка не ломает последнее корректное решение', async () => {
    let n = 0;
    const { app } = setup(() =>
      n++ === 0
        ? { intent: 'describe', ops: fixtures.F07 }
        : {
            intent: 'modify',
            ops: [{ op: 'upsert_file_flow', id: 'f3', transfers: [{ from: 'n2', to: 'n1', send: { method: 'usb' }, receive: { method: 'manual', protocol: 'SFTP' } }] }],
          },
    );
    const s = (await post(app, '/api/sessions')).json;
    const r1 = (await post(app, `/api/sessions/${s.id}/messages`, { text: 'F07' })).json;
    const r2 = (await post(app, `/api/sessions/${s.id}/messages`, { text: 'подключи флешку к узлу В' })).json;
    expect(r2.result.status).toBe('completed');
    expect(r2.version).toBe(r1.version);
    expect(r2.history.at(-1).text).toContain('Узле А');
    expect(r2.history.at(-1).text).toContain('последнее корректное решение сохранено');
  });

  it('ошибка модели → 502, состояние и история не меняются, повтор возможен', async () => {
    let fail = true;
    const { app } = setup(() => {
      if (fail) throw new Error('timeout');
      return { intent: 'describe', ops: fixtures.F01 };
    });
    const s = (await post(app, '/api/sessions')).json;
    const bad = await post(app, `/api/sessions/${s.id}/messages`, { text: 'F01' });
    expect(bad.status).toBe(502);
    expect(bad.json.error).toContain('можно повторить');
    const after = (await app.inject({ method: 'GET', url: `/api/sessions/${s.id}` })).json();
    expect(after.history).toHaveLength(0);
    expect(after.usage.calls).toBe(1); // оплаченный неудачный вызов учтён
    expect(after.timing.turns[0].status).toBe('error');
    fail = false;
    const ok = await post(app, `/api/sessions/${s.id}/messages`, { text: 'F01' });
    expect(ok.json.result.rulesCount).toBe(1);
  });

  it('dev-сценарии доступны только в режиме разработки', async () => {
    const { app } = buildApp({ extractor: new FakeExtractor(() => ({ intent: 'off_topic', ops: [] })), dataDir: null, dev: false });
    const s = (await post(app, '/api/sessions')).json;
    expect((await post(app, `/api/sessions/${s.id}/dev/scenario/F02`)).status).toBe(404);
  });
});

describe('стоимость', () => {
  it('формула ТЗ: 10 000 вход по $0,10 и 2 000 выход по $0,40 = $0,0018', () => {
    expect(callCost(10000, 2000, { input: 0.1, output: 0.4 }).total).toBeCloseTo(0.0018, 12);
    expect(formatUsd(0.0018)).toBe('$0,0018');
  });

  it('малые суммы не превращаются в $0,00', () => {
    expect(formatUsd(0.00001234)).toBe('$0,00001234');
    expect(formatUsd(0.0000004)).toBe('менее $0,000001');
    expect(formatUsd(null)).toBe('не подтверждено');
  });

  it('повторный usage одного call_id не удваивает расход; неизвестный usage не равен нулю', () => {
    const base: CallLog = {
      session_id: 's', turn_id: 't', call_id: 'c1', model_id: 'm', provider: null, purpose: 'extract', started_at: '', finished_at: '', status: 'ok',
      input_tokens: 100, output_tokens: 10, cached_tokens: null, reasoning_tokens: null, prices: { input: 0.1, output: 0.4 },
      cost_input_usd: 0.00001, cost_output_usd: 0.000004, cost_total_usd: 0.000014, actual_cost_usd: null, usage_source: 'provider_response', provider_response_id: null, raw_usage: null,
    };
    const unknownCall: CallLog = { ...base, call_id: 'c2', input_tokens: null, output_tokens: null, cost_input_usd: null, cost_output_usd: null, cost_total_usd: null, usage_source: 'unknown' };
    const s = summarize([base, { ...base }, unknownCall]);
    expect(s.calls).toBe(2);
    expect(s.cost_total_usd).toBeCloseTo(0.000014, 12);
    expect(s.unconfirmed_calls).toBe(1);
  });
});

describe('база знаний', () => {
  const kb = KbIndex.fromDir(fileURLToPath(new URL('../../../kb', import.meta.url)));

  it('без модели: вопрос о продукте → дословные выдержки с источником, конфигурация не меняется', async () => {
    const { app } = buildApp({ extractor: new NullExtractor(), dataDir: null, kb });
    const s = (await post(app, '/api/sessions')).json;
    const r = await post(app, `/api/sessions/${s.id}/messages`, { text: 'Сколько правил можно настроить на одном Синониксе?' });
    expect(r.status).toBe(200);
    expect(r.json.version).toBe(0);
    const last = r.json.history.at(-1);
    expect(last.text).toContain('256');
    expect(last.text).toContain('Модель не подключена');
    expect(last.sources.some((x: any) => x.file === '01_scope_functions_synonyx_1.9.md')).toBe(true);
    expect(r.json.usage.calls).toBe(0);
  });

  it('без модели: описание задачи не выдаётся за ответ из базы', async () => {
    const { app } = buildApp({ extractor: new NullExtractor(), dataDir: null, kb });
    const s = (await post(app, '/api/sessions')).json;
    const r = await post(app, `/api/sessions/${s.id}/messages`, { text: 'Есть офисная сеть и сеть цеха, нужно передавать журналы' });
    expect(r.json.history.at(-1).sources ?? []).toHaveLength(0);
  });

  it('фрагменты базы передаются модели, ссылки строятся по id фрагмента, выдуманные id отбрасываются', async () => {
    let seen: ExtractInput | null = null;
    const { app } = buildApp({
      extractor: new FakeExtractor((input) => {
        seen = input;
        const real = input.kb!.find((k) => k.text.includes('256'))!;
        return { ...parseOutput(JSON.stringify({ intent: 'product_question', ops: [], reply: 'До 256 правил.', sources: [real.id, 'выдумка#1'] }), input.kb) };
      }),
      dataDir: null,
      kb,
    });
    const s = (await post(app, '/api/sessions')).json;
    const r = await post(app, `/api/sessions/${s.id}/messages`, { text: 'Какой лимит правил?' });
    expect(seen!.kb!.length).toBeGreaterThan(0);
    const last = r.json.history.at(-1);
    expect(last.text).toBe('До 256 правил.');
    expect(last.sources).toHaveLength(1);
    expect(last.sources[0].file).toBe('01_scope_functions_synonyx_1.9.md');
  });

  it('текст раздела по ссылке-источнику; несуществующий раздел — 404', async () => {
    const { app } = buildApp({ extractor: new NullExtractor(), dataDir: null, kb });
    const ok = await app.inject({ method: 'GET', url: `/api/kb/section?file=02_methodology.md&section=${encodeURIComponent('2. Размещение')}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().chunks.map((c: any) => c.text).join('\n')).toContain('Узел А обращён к открытой сети');
    const no = await app.inject({ method: 'GET', url: `/api/kb/section?file=02_methodology.md&section=${encodeURIComponent('99. Нет')}` });
    expect(no.statusCode).toBe(404);
    const search = await app.inject({ method: 'GET', url: `/api/kb/search?q=${encodeURIComponent('встроенный антивирус')}` });
    expect(search.json().hits[0].text).toMatch(/антивирус/i);
  });
});
