import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { answerToOps, applyOps, emptyState, evaluate, explain, toResultJson, type Op, type SessionState } from '../src/index.js';
import * as S from '../src/fixtures.js';

const bench = JSON.parse(readFileSync(fileURLToPath(new URL('../../../kb/04_benchmarks.json', import.meta.url)), 'utf8'));
const expected = (id: string) => {
  const item = bench.items.find((i: any) => i.id === id);
  return item.expected ?? item.follow_up?.expected;
};

function build(ops: Op[], base: SessionState = emptyState()) {
  const { state, errors } = applyOps(base, ops);
  expect(errors).toEqual([]);
  return { state, res: evaluate(state) };
}

function answer(state: SessionState, qid: string, value: any) {
  return applyOps(state, answerToOps(state, qid, value).ops).state;
}

/** Сравнение с эталоном по смыслу: тип, стороны, режим, протокол, порт, файловые пользователи. */
function compareWithBenchmark(id: string, ops: Op[], base?: SessionState) {
  const { state, res } = build(ops, base);
  const json = toResultJson(state, res, { sessionId: 't' });
  const exp = expected(id);
  expect(json.status).toBe('completed');
  expect(json.rules_count).toBe(exp.rules_count);
  expect(json.firewall.side).toBe(exp.firewall.side);
  expect(json.file_users_count).toBe(exp.file_users_count);
  const norm = (r: any) => ({ type: r.type, from: r.from, to: r.to, mode: r.mode, ...(r.type === 'data' ? { protocol: r.protocol, port: r.port } : {}) });
  const sortKey = (r: any) => JSON.stringify(norm(r));
  expect(json.rules.map(norm).sort((a: any, b: any) => sortKey(a).localeCompare(sortKey(b)))).toEqual(
    exp.rules.map(norm).sort((a: any, b: any) => sortKey(a).localeCompare(sortKey(b))),
  );
  return { state, res, json };
}

describe('эталоны 04_benchmarks.json', () => {
  it('F02 — Modbus двунаправленное, журналы и NTP однонаправленные', () => {
    compareWithBenchmark('F02', S.F02);
  });

  it('F07 — MQTT всегда двунаправленное, USB только на Узле А, 1 файловый пользователь', () => {
    const { res, json } = compareWithBenchmark('F07', S.F07);
    const file = json.rules.find((r: any) => r.type === 'file') as any;
    expect(file.usb).toBe(true);
    expect(file.protocol.open).toContain('USB');
    expect(file.protocol.closed).toContain('SMB');
    expect((json.rules.find((r: any) => r.protocol === 'MQTT') as any).port).toBeNull();
    expect(res.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('F01 — три отправителя одному получателю = одно правило', () => {
    compareWithBenchmark('F01', S.F01);
  });

  it('F04 — SFTP и SMB на разных сторонах — одно правило, PUSH не добавляет пользователя', () => {
    const { json } = compareWithBenchmark('F04', S.F04);
    expect((json.rules[0] as any).checks).toHaveLength(3);
  });

  it('N05 — сначала уточнение файловой части, после ответа 2 правила', () => {
    const first = build(S.N05);
    expect(first.res.status).toBe('needs_clarification');
    const ids = first.res.questions.map((q) => q.id);
    expect(ids).toContain('ff:f2:send:n1');
    expect(ids).toContain('ff:f2:recv:n2');
    expect(ids).toContain('ff:f2:checks');
    // Журналы спрашивать не нужно.
    expect(ids.some((i) => i.startsWith('flow:f1'))).toBe(false);
    compareWithBenchmark('N05', S.N05_followup, first.state);
  });
});

describe('N01 — неполный файловый обмен', () => {
  it('задаёт вопросы о способах, проверках, видимости и пользователях', () => {
    const { res } = build(S.N01);
    expect(res.status).toBe('needs_clarification');
    const ids = res.questions.map((q) => q.id);
    for (const id of ['ff:f1:send:n1', 'ff:f1:recv:n2', 'ff:f1:send:n2', 'ff:f1:recv:n1', 'ff:f1:checks', 'ff:f1:differentChecks', 'ff:f1:isolation', 'ff:f1:users'])
      expect(ids).toContain(id);
    // Все вопросы с «не знаю».
    expect(res.questions.every((q) => q.allowUnknown)).toBe(true);
  });

  it('на «не знаю» — предварительная оценка: минимум 1 правило', () => {
    let { state, res } = build(S.N01);
    for (const q of res.questions) state = answer(state, q.id, 'unknown');
    res = evaluate(state);
    expect(res.status).toBe('preliminary');
    expect(res.minRules).toBe(1);
    expect(res.questions).toEqual([]);
    expect(explain(state, res)).toContain('Предварительная оценка: минимум 1 правило');
    const json = toResultJson(state, res, { sessionId: 't' });
    expect(json.file_users_count).toBeNull();
    // Ничего не выдумано.
    expect(JSON.stringify(json.rules)).not.toMatch(/SFTP|антивирус/);
  });
});

describe('файловые правила', () => {
  it('U01 — PULL с обеих сторон → 2 правила, 2 технических пользователя', () => {
    const { res } = build(S.U01);
    expect(res.status).toBe('completed');
    expect(res.rulesCount).toBe(2);
    expect(res.rules.every((r) => r.pull)).toBe(true);
    expect(res.fileUsers.count).toBe(2);
  });

  it('U02a — изоляция двух отделов → 2 правила, число людей спрашивается', () => {
    const { res } = build(S.U02a);
    expect(res.rulesCount).toBe(2);
    expect(res.questions.map((q) => q.id)).toEqual(['ff:f1:users']);
  });

  it('U02a — два отдела описаны отдельными потоками с изоляцией → тоже 2 правила', () => {
    const { res } = build([
      ...S.U02a.slice(0, 2),
      {
        op: 'upsert_file_flow', id: 'a', description: 'Отдел 1',
        transfers: [{ from: 'n1', to: 'n2', send: { method: 'manual', protocol: 'SFTP' }, receive: { method: 'manual', protocol: 'SFTP' } }],
        checks: ['icap_av'], differentChecks: false, isolation: true, isolatedGroups: 1, users: { exact: 3 },
      },
      {
        op: 'upsert_file_flow', id: 'b', description: 'Отдел 2',
        transfers: [{ from: 'n1', to: 'n2', send: { method: 'manual', protocol: 'SFTP' }, receive: { method: 'manual', protocol: 'SFTP' } }],
        checks: ['icap_av'], differentChecks: false, isolation: true, isolatedGroups: 1, users: { exact: 4 },
      },
    ]);
    expect(res.rulesCount).toBe(2);
    expect(res.fileUsers.count).toBe(7);
  });

  it('U02b — разные проверки на противоположных узлах не делят правило', () => {
    const { res, state } = build(S.U02b);
    expect(res.status).toBe('completed');
    expect(res.rulesCount).toBe(1);
    expect(res.rules[0].checksByNode).toBeDefined();
    expect(res.fileUsers.range).toEqual({ min: 2, max: 10 });
    expect(toResultJson(state, res, { sessionId: 't' }).file_users_count).toBeNull();
  });

  it('PULL и PUSH на одном узле → 2 правила', () => {
    const { res } = build([
      ...S.U01.slice(0, 4),
      {
        op: 'upsert_file_flow', id: 'f1', description: 'Обмен',
        transfers: [
          { from: 'n1', to: 'n2', send: { method: 'manual', protocol: 'SFTP' }, receive: { method: 'push', protocol: 'SMB', storage: 'st-shop' } },
          { from: 'n2', to: 'n1', send: { method: 'pull', protocol: 'SMB', storage: 'st-shop' }, receive: { method: 'manual', protocol: 'SFTP' } },
        ],
        checks: [], differentChecks: false, isolation: false, users: { exact: 1 },
      },
    ]);
    expect(res.rulesCount).toBe(2);
    expect(res.fileUsers.count).toBe(2); // 1 человек + 1 технический для PULL
  });

  it('обмен в обе стороны вручную — одно двунаправленное правило', () => {
    const { res } = build([
      ...S.U01.slice(0, 2),
      {
        op: 'upsert_file_flow', id: 'f1', description: 'Обмен документами',
        transfers: [
          { from: 'n1', to: 'n2', send: { method: 'manual', protocol: 'SFTP' }, receive: { method: 'manual', protocol: 'SFTP' } },
          { from: 'n2', to: 'n1', send: { method: 'manual', protocol: 'SFTP' }, receive: { method: 'manual', protocol: 'SFTP' } },
        ],
        checks: ['size'], differentChecks: false, isolation: false, users: { exact: 5 },
      },
    ]);
    expect(res.rulesCount).toBe(1);
    expect(res.rules[0].mode).toBe('two-way');
  });

  it('USB в сторону Узла В — ошибка, а не тихая подмена', () => {
    const { res } = build([
      ...S.U01.slice(0, 2),
      {
        op: 'upsert_file_flow', id: 'f1', description: 'Выгрузка с флешки в офис',
        transfers: [{ from: 'n2', to: 'n1', send: { method: 'usb' }, receive: { method: 'manual', protocol: 'SFTP' } }],
        checks: [], differentChecks: false, isolation: false, users: { exact: 1 },
      },
    ]);
    expect(res.status).toBe('needs_clarification');
    expect(res.issues.some((i) => i.severity === 'error' && i.text.includes('Узле А'))).toBe(true);
  });
});

describe('данные', () => {
  it('другой получатель на тот же порт — отдельное правило (U03 шаг 2) и удаление (шаг 4)', () => {
    let { state, res } = build(S.F01);
    ({ state, res } = build(
      [
        { op: 'upsert_device', id: 'logsrv2', name: 'Второй сервер журналов', networkId: 'n1' },
        { op: 'upsert_data_flow', id: 'f2', description: 'Журналы событий трёх станков на второй сервер', senders: ['machines'], receivers: ['logsrv2'], protocol: 'UDP', port: 514, reverse: false },
      ],
      state,
    ));
    expect(res.rulesCount).toBe(2);
    ({ state, res } = build([{ op: 'upsert_device', id: 'logsrv2', name: 'Резервный сервер журналов' }], state));
    expect(res.rulesCount).toBe(2);
    expect(explain(state, res)).toContain('Резервный сервер журналов');
    ({ state, res } = build([{ op: 'remove_device', id: 'logsrv2' }], state));
    expect(res.rulesCount).toBe(1);
    expect(res.rules[0].receivers).toEqual(['logsrv']);
  });

  it('два отправителя разными потоками одному получателю на один порт — одно правило', () => {
    const { res } = build([
      ...S.F01.slice(0, 4),
      { op: 'upsert_device', id: 'other', name: 'АРМ мастера', networkId: 'n2' },
      { op: 'upsert_data_flow', id: 'f1', description: 'Журналы станков', senders: ['machines'], receivers: ['logsrv'], protocol: 'UDP', port: 514, reverse: false },
      { op: 'upsert_data_flow', id: 'f2', description: 'Журналы АРМ мастера', senders: ['other'], receivers: ['logsrv'], protocol: 'UDP', port: 514, reverse: false },
    ]);
    expect(res.rulesCount).toBe(1);
  });

  it('NTP на несколько устройств без порта — одно правило, порт не угадан', () => {
    const { res } = build([
      ...S.F02.slice(0, 2),
      { op: 'upsert_device', id: 'ntp', name: 'Сервер времени', networkId: 'n1' },
      { op: 'upsert_device', id: 'a', name: 'Контроллер 1', networkId: 'n2' },
      { op: 'upsert_device', id: 'b', name: 'Контроллер 2', networkId: 'n2' },
      { op: 'upsert_data_flow', id: 't1', description: 'Время', isTimeSync: true, senders: ['ntp'], receivers: ['a', 'b'], protocol: null, port: null, reverse: null },
    ]);
    expect(res.status).toBe('completed');
    expect(res.rulesCount).toBe(1);
    expect(res.rules[0].mode).toBe('one-way');
    expect(res.rules[0].port).toBeNull();
  });

  it('TCP без сведений об обратной передаче — вопрос, а не догадка', () => {
    const { res } = build([
      ...S.F01.slice(0, 4),
      { op: 'upsert_data_flow', id: 'f1', description: 'Выгрузка данных', senders: ['machines'], receivers: ['logsrv'], protocol: 'TCP', port: 8080, reverse: null },
    ]);
    expect(res.status).toBe('needs_clarification');
    expect(res.questions.map((q) => q.id)).toEqual(['flow:f1:reverse']);
  });
});

describe('границы задачи', () => {
  it('три сети — объяснение рамок и выбор пары', () => {
    const { state, res } = build(S.THREE_NETS);
    expect(res.status).toBe('needs_clarification');
    expect(res.rules).toEqual([]);
    expect(res.questions[0].id).toBe('net:pair');
    const next = evaluate(answer(state, 'net:pair', 'n1+n2'));
    expect(next.questions[0].id).toBe('net:protected');
  });

  it('обе сети открытые — спрашиваем защищаемую сторону; «не знаю» → предварительный', () => {
    const { state, res } = build(S.BOTH_OPEN);
    expect(res.status).toBe('needs_clarification');
    expect(res.questions.map((q) => q.id)).toEqual(['net:protected_choice']);
    const unk = evaluate(answer(state, 'net:protected_choice', 'unknown'));
    expect(unk.status).toBe('preliminary');
    const chosenState = answer(state, 'net:protected_choice', 'n2');
    const chosen = evaluate(chosenState);
    expect(chosen.status).toBe('completed');
    expect(chosen.closedNetwork).toBe('n2');
    expect(chosen.firewall.side).toBe('both');
    expect(chosen.assumptions[0].text).toContain('Сеть отдела продаж');
    // исходное описание не переписано
    expect(chosenState.networks.every((n) => n.trust === 'open')).toBe(true);
  });
});
