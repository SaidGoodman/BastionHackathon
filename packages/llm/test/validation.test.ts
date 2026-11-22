import { describe, expect, it } from 'vitest';
import { emptyState, type Op } from '@synonyx/core';
import { InvalidModelOutputError, parseOutput, validateExtractOutput } from '../src/index.js';

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

  it('строгий разбор отклоняет выдуманный источник', () => {
    expect(() => parseOutput('{"intent":"product_question","ops":[],"sources":["missing"]}', [{ id: 'real', file: 'a.md', section: '1', text: '', excerpt: [], score: 1 }], true)).toThrow(InvalidModelOutputError);
  });
});
