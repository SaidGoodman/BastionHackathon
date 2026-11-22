import { describe, expect, it } from 'vitest';
import { emptyState, type Op } from '@synonyx/core';
import { InvalidModelOutputError, LlmExtractor, parseOutput, validateExtractOutput } from '../src/index.js';

describe('строгая проверка ответа модели', () => {
  it('разрешает ссылки на сущности, созданные ранее в том же ответе', () => {
    const ops: Op[] = [
      { op: 'set_network', id: 'n1', name: 'Офис', trust: 'open' },
      { op: 'upsert_device', id: 'd1', name: 'Сервер', networkId: 'n1' },
      { op: 'upsert_data_flow', id: 'f1', senders: ['d1'], fromNetwork: 'n1', toNetwork: 'n1', protocol: 'TCP', port: 443 },
    ];
    expect(() => validateExtractOutput({ intent: 'describe', ops }, emptyState())).not.toThrow();
  });

  it.each([
    [{ intent: 'unknown_intent', ops: [] }, 'намерение'],
    [{ intent: 'describe', ops: [{ op: 'upsert_data_flow', id: 'f1', protocol: 'HTTP' }] }, 'protocol'],
    [{ intent: 'describe', ops: [{ op: 'upsert_device', id: 'd1', networkId: 'missing' }] }, 'неизвестную сеть'],
  ])('отклоняет некорректный ответ (%s)', (out, part) => {
    expect(() => validateExtractOutput(out as any, emptyState())).toThrowError(new RegExp(`Ответ модели отклонён.*${part}`));
  });

  it('повторно запрашивает исправление, когда модель назначила FTP потоку данных', async () => {
    const requests: any[] = [];
    const client = { chat: async (request: any) => {
      requests.push(structuredClone(request));
      return { text: requests.length === 1
        ? JSON.stringify({ intent: 'modify', ops: [{ op: 'upsert_data_flow', id: 'd1', protocol: 'FTP' }], reply: 'Готово.' })
        : JSON.stringify({ intent: 'modify', ops: [], reply: 'Уточните, нужна ли автоматическая передача файлов по FTP?' }) };
    } };
    const config = { models: { extract: { id: 'test', api: {}, input_per_m: 0, output_per_m: 0 }, answer: { id: null } } };
    const extractor = new LlmExtractor(client as any, config as any);
    const output = await extractor.extract({ sessionId: 's', turnId: 't', state: emptyState(), result: null, history: [], text: 'измени протокол' });
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1).content).toContain('protocol');
    expect(output.reply).toContain('Уточните');
    expect(output.ops).toEqual([]);
  });

  it('строгий разбор отклоняет выдуманный источник', () => {
    expect(() => parseOutput('{"intent":"product_question","ops":[],"sources":["missing"]}', [{ id: 'real', file: 'a.md', section: '1', text: '', excerpt: [], score: 1 }], true)).toThrow(InvalidModelOutputError);
  });
});
