/**
 * Детерминированный движок: состояние сессии → правила, вопросы, статус.
 * Методика: 02_methodology.md (разделы 2–4, 7) и ТЗ §4.
 */
import { checkLabel, MAX_RULES, receiveLabel, sendLabel, SRC, uniqSources } from './labels.js';
import { isIndustrial, normalizeProtocol, supportsOneWay } from './protocols.js';
import { Q } from './questions.js';
import {
  isKnown,
  UNKNOWN,
  type DataFlow,
  type EngineResult,
  type FileCheck,
  type FileFlow,
  type FileTransfer,
  type Issue,
  type Network,
  type Question,
  type Rule,
  type RuleMode,
  type SessionState,
  type SourceRef,
  type Unknown,
} from './types.js';

interface Ctx {
  state: SessionState;
  nets: Network[];
  closed: string | null;
  open: string | null;
  questions: Question[];
  unknowns: Unknown[];
  issues: Issue[];
  sources: SourceRef[];
}

export function evaluate(state: SessionState): EngineResult {
  const ctx: Ctx = {
    state,
    nets: state.networks,
    closed: null,
    open: null,
    questions: [],
    unknowns: [],
    issues: [],
    sources: [SRC.placement],
  };

  const early = checkNetworks(ctx);
  if (early) return early;

  if (state.placementRequest) {
    ctx.issues.push({
      severity: 'warning',
      text:
        `Вы предложили разместить «Синоникс» иначе («${state.placementRequest}»). Рекомендуем ставить его внутри защищаемого сегмента сразу за межсетевым экраном: ` +
        'так Узел А обращён к открытой сети, а системы закрытого сегмента не имеют иных путей наружу. Схема построена по этой рекомендации.',
      sources: [SRC.placement],
    });
  }
  for (const r of state.rejected ?? []) {
    ctx.issues.push({ severity: 'warning', text: `Не применено: «${r.text}». ${r.reason}` });
  }

  const dataFlows = state.flows.filter((f): f is DataFlow => f.kind === 'data');
  const fileFlows = state.flows.filter((f): f is FileFlow => f.kind === 'file');

  if (state.flows.length === 0) {
    ctx.questions.push(Q.whatToTransfer());
  }

  const rules: Rule[] = [];
  let minExtra = 0;
  // Правила нумеруются в порядке описания потоков пользователем.
  const dataRules = buildDataRules(ctx, dataFlows);
  const file = buildFileRules(ctx, fileFlows);
  minExtra += file.minExtra;

  const order = new Map(state.flows.map((f, i) => [f.id, i]));
  const all = [...dataRules, ...file.rules].sort(
    (a, b) => (order.get(a.flowIds[0]) ?? 0) - (order.get(b.flowIds[0]) ?? 0),
  );
  all.forEach((r, i) => rules.push({ ...r, id: i + 1 }));

  const fileUsers = countFileUsers(ctx, fileFlows, rules);

  // --- статус
  const hasErrors = ctx.issues.some((i) => i.severity === 'error');
  const affecting = ctx.unknowns.filter((u) => u.affectsResult);
  let status: EngineResult['status'];
  if (rules.length > MAX_RULES) {
    status = 'unsupported';
    ctx.issues.push({
      severity: 'error',
      text: `По расчёту нужно ${rules.length} правил, а на одном ПАК «Синоникс» можно настроить не больше ${MAX_RULES}. Требуемый набор в рамки одного устройства не помещается.`,
      sources: [SRC.scopeRulesLimit, SRC.scopeLimits],
    });
  } else if (ctx.questions.length > 0 || hasErrors) {
    status = 'needs_clarification';
  } else if (affecting.length > 0) {
    status = 'preliminary';
  } else {
    status = 'completed';
  }

  const assumptions = [...state.assumptions];

  return {
    status,
    rules,
    rulesCount: rules.length,
    minRules: rules.length + minExtra,
    questions: dedupeQuestions(ctx.questions),
    unknowns: ctx.unknowns,
    assumptions,
    issues: ctx.issues,
    fileUsers,
    firewall: {
      side: bothDeclaredOpen(ctx) ? 'both' : 'open',
      existing: state.existingFirewall,
      name: state.firewallName,
    },
    closedNetwork: ctx.closed,
    openNetwork: ctx.open,
    sources: uniqSources(ctx.sources),
  };
}

// ====================================================================== networks

function bothDeclaredOpen(ctx: Ctx): boolean {
  return ctx.nets.length === 2 && ctx.nets.every((n) => n.trust === 'open');
}

function emptyResult(ctx: Ctx, status: EngineResult['status']): EngineResult {
  return {
    status,
    rules: [],
    rulesCount: 0,
    minRules: 0,
    questions: ctx.questions,
    unknowns: ctx.unknowns,
    assumptions: ctx.state.assumptions,
    issues: ctx.issues,
    fileUsers: { count: null, range: null, breakdown: [] },
    firewall: { side: 'open', existing: ctx.state.existingFirewall },
    closedNetwork: null,
    openNetwork: null,
    sources: uniqSources(ctx.sources),
  };
}

/** Определяет закрытую/открытую сеть. Возвращает результат, если дальше считать нельзя. */
function checkNetworks(ctx: Ctx): EngineResult | null {
  const { nets, state } = ctx;
  if (nets.length > 2) {
    ctx.issues.push({
      severity: 'info',
      text:
        `В описании ${nets.length} сети. В рамках проекта один «Синоникс» защищает одну границу между двумя сетями; ` +
        'схемы с тремя и более сетями и резервированием не проектируются. Выберите одну пару сегментов — остальные границы можно рассмотреть отдельно.',
      sources: [{ file: '02_methodology.md', section: 'Рамки кейса (введение)' }],
    });
    ctx.questions.push(Q.networkPair(nets));
    return emptyResult(ctx, 'needs_clarification');
  }
  if (nets.length < 2) {
    if (state.flows.length > 0 || nets.length === 1) ctx.questions.push(Q.secondNetwork());
    else ctx.questions.push(Q.whatToTransfer());
    return emptyResult(ctx, 'needs_clarification');
  }

  const [a, b] = nets;
  const closedDeclared = nets.filter((n) => n.trust === 'closed');
  const openDeclared = nets.filter((n) => n.trust === 'open');

  if (closedDeclared.length === 1) {
    ctx.closed = closedDeclared[0].id;
  } else if (openDeclared.length === 1 && closedDeclared.length === 0) {
    // Одна названа открытой, вторая не названа — вторая и есть защищаемая.
    const other = nets.find((n) => n.trust !== 'open')!;
    ctx.closed = other.id;
  }

  if (!ctx.closed) {
    // Обе открытые, обе закрытые или ничего не сказано.
    const both = openDeclared.length === 2 || closedDeclared.length === 2;
    if (isKnown(state.protectedNetwork)) {
      ctx.closed = state.protectedNetwork;
    } else if (state.protectedNetwork === UNKNOWN) {
      ctx.unknowns.push({
        path: 'net:protected',
        text: 'Не выбрана защищаемая сторона: размещение показано условно, результат предварительный.',
        affectsResult: true,
      });
      ctx.closed = b.id; // условно, только для отрисовки
    } else {
      ctx.questions.push(both ? Q.protectedChoice(nets) : Q.protectedSide(nets));
      ctx.closed = b.id; // условно, пока идёт уточнение
    }
    if (bothDeclaredOpen(ctx) && isKnown(state.protectedNetwork)) {
      ctx.issues.push({
        severity: 'info',
        text: 'Обе сети названы открытыми, поэтому межсетевые экраны можно поставить с обеих сторон «Синоникса».',
        sources: [SRC.placement],
      });
    }
  }
  ctx.open = ctx.closed === a.id ? b.id : a.id;
  return null;
}

function net(ctx: Ctx, id: string | null | undefined): Network | undefined {
  return ctx.nets.find((n) => n.id === id);
}

function deviceNet(ctx: Ctx, deviceId: string): string | undefined {
  return ctx.state.devices.find((d) => d.id === deviceId)?.networkId;
}

function deviceName(ctx: Ctx, deviceId: string): string {
  return ctx.state.devices.find((d) => d.id === deviceId)?.name ?? deviceId;
}

// ====================================================================== data rules

interface DataGroup {
  key: string;
  from: string;
  to: string;
  protocol: string | null;
  port: number | null;
  modes: (RuleMode | null)[];
  senders: Set<string>;
  receivers: Set<string>;
  flows: DataFlow[];
  timeSync: boolean;
  unknowns: string[];
  notes: string[];
}

function buildDataRules(ctx: Ctx, flows: DataFlow[]): Omit<Rule, 'id'>[] {
  const groups = new Map<string, DataGroup>();
  ctx.sources.push(SRC.dataRules);

  for (const f of flows) {
    const ctxLabel = f.description;
    // --- направление
    const senderNets = new Set(f.senders.map((s) => deviceNet(ctx, s)).filter(Boolean) as string[]);
    const receivers = isKnown(f.receivers) ? f.receivers : [];
    const receiverNets = new Set(receivers.map((r) => deviceNet(ctx, r)).filter(Boolean) as string[]);
    let from: string | undefined = [...senderNets][0] ?? (isKnown(f.fromNetwork ?? null) ? (f.fromNetwork as string) : undefined);
    let to: string | undefined = [...receiverNets][0] ?? (isKnown(f.toNetwork ?? null) ? (f.toNetwork as string) : undefined);
    if (!from && to) from = otherNet(ctx, to);
    if (!to && from) to = otherNet(ctx, from);

    if (senderNets.size > 1 || receiverNets.size > 1) {
      ctx.issues.push({
        severity: 'error',
        text: `Поток «${f.description}»: отправители или получатели оказались в разных сетях. Уточните, кто в какой сети.`,
      });
      continue;
    }
    if (!from || !to) {
      ctx.questions.push(Q.dataDirection(f.id, ctxLabel, ctx.nets));
      continue;
    }
    if (from === to) {
      ctx.issues.push({
        severity: 'warning',
        text: `Поток «${f.description}» идёт внутри одной сети («${net(ctx, from)?.name}») и через «Синоникс» не проходит — правило для него не нужно.`,
      });
      continue;
    }

    // --- протокол
    let protocol: string | null = null;
    const unknowns: string[] = [];
    const notes: string[] = [];
    if (isKnown(f.protocol)) {
      protocol = normalizeProtocol(f.protocol);
      if (!protocol) {
        ctx.issues.push({
          severity: 'info',
          text: `Протокол «${f.protocol}» не входит в список поддерживаемых для передачи данных (TCP, UDP, MQTT, Modbus TCP, МЭК 104). Уточните транспорт: обычно это TCP или UDP.`,
          sources: [SRC.scopeProtocols],
        });
        ctx.questions.push(Q.dataProtocol(f.id, ctxLabel));
        continue;
      }
    } else if (f.protocol === null && !f.isTimeSync) {
      ctx.questions.push(Q.dataProtocol(f.id, ctxLabel));
    } else if (f.protocol === UNKNOWN || f.isTimeSync) {
      if (!f.isTimeSync) {
        unknowns.push('протокол');
        ctx.unknowns.push({ path: `flow:${f.id}:protocol`, text: `«${f.description}»: протокол неизвестен.`, affectsResult: true });
      } else {
        unknowns.push('протокол');
        ctx.unknowns.push({ path: `flow:${f.id}:protocol`, text: `«${f.description}»: транспорт NTP не указан.`, affectsResult: false });
      }
    }

    // --- порт (никогда не угадываем и не спрашиваем: на число правил не влияет)
    const port = isKnown(f.port) ? f.port : null;
    if (!isKnown(f.port)) {
      unknowns.push('порт');
      ctx.unknowns.push({ path: `flow:${f.id}:port`, text: `«${f.description}»: порт не указан.`, affectsResult: false });
    }

    // --- получатели
    let recvList: string[] = receivers;
    if (f.isTimeSync) {
      // Время: одно правило независимо от числа синхронизируемых устройств.
    } else if (f.receivers === null || (isKnown(f.receivers) && f.receivers.length === 0 && !f.toNetwork)) {
      ctx.questions.push(Q.dataReceivers(f.id, ctxLabel));
    } else if (f.receivers === UNKNOWN || recvList.length === 0) {
      unknowns.push('получатель');
      ctx.unknowns.push({
        path: `flow:${f.id}:receivers`,
        text: `«${f.description}»: число получателей неизвестно; на каждого получателя нужно своё правило — посчитан минимум (1).`,
        affectsResult: true,
      });
    }

    // --- режим
    let mode: RuleMode | null = null;
    if (f.isTimeSync) {
      mode = 'one-way';
      ctx.sources.push(SRC.modes);
    } else if (isIndustrial(protocol)) {
      mode = 'two-way';
      ctx.sources.push(SRC.scopeProtocols);
      if (f.reverse === false) {
        notes.push(
          `Полезные сообщения идут в одну сторону, но для ${protocol} однонаправленного режима нет — правило двунаправленное; что можно передавать, ограничивает политика фильтрации (${industrialPolicy(protocol)}).`,
        );
      }
    } else if (f.reverse === true) {
      mode = 'two-way';
    } else if (f.reverse === false) {
      if (protocol && !supportsOneWay(protocol)) mode = 'two-way';
      else mode = 'one-way';
    } else if (f.reverse === null) {
      ctx.questions.push(Q.dataReverse(f.id, ctxLabel));
    } else {
      unknowns.push('режим');
      ctx.unknowns.push({
        path: `flow:${f.id}:reverse`,
        text: `«${f.description}»: неизвестно, нужна ли обратная передача — режим правила не определён.`,
        affectsResult: true,
      });
    }

    // --- группировка: одно правило = (сеть-отправитель, получатель, протокол, порт)
    const recvKeys = f.isTimeSync ? ['*time*'] : recvList.length ? recvList : [`?${f.id}`];
    for (const r of recvKeys) {
      const mergeable = f.isTimeSync || (protocol !== null && port !== null && !r.startsWith('?'));
      const key = f.isTimeSync ? `time|${from}>${to}` : mergeable ? `${from}>${r}|${protocol}|${port}` : `flow:${f.id}|${r}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          from,
          to,
          protocol,
          port,
          modes: [],
          senders: new Set(),
          receivers: new Set(),
          flows: [],
          timeSync: !!f.isTimeSync,
          unknowns: [],
          notes: [],
        };
        groups.set(key, g);
      }
      g.modes.push(mode);
      f.senders.forEach((s) => g!.senders.add(s));
      if (f.isTimeSync) recvList.forEach((x) => g!.receivers.add(x));
      else if (!r.startsWith('?')) g.receivers.add(r);
      if (!g.flows.includes(f)) g.flows.push(f);
      g.unknowns.push(...unknowns.filter((u) => !g!.unknowns.includes(u)));
      g.notes.push(...notes.filter((n) => !g!.notes.includes(n)));
      if (g.port === null && port !== null) g.port = port;
      if (g.protocol === null && protocol !== null) g.protocol = protocol;
    }
  }

  // Сколько правил у одного отправителя — для пояснения «другой получатель — другое правило».
  const rules: Omit<Rule, 'id'>[] = [];
  for (const g of groups.values()) {
    const mode: RuleMode | null = g.modes.includes('two-way') ? 'two-way' : g.modes.every((m) => m === 'one-way') ? 'one-way' : null;
    const senders = [...g.senders];
    const receivers = [...g.receivers];
    const just: string[] = [];
    const src: SourceRef[] = [SRC.dataRules];

    if (g.timeSync) {
      just.push('Синхронизация времени по методике — одно однонаправленное правило от источника времени к защищаемой сети; число синхронизируемых устройств на расчёт не влияет.');
      src.push(SRC.modes);
    } else if (isIndustrial(g.protocol)) {
      just.push(`Для ${g.protocol} однонаправленного режима нет — правило всегда двунаправленное; запрос и ответ идут в одном правиле.`);
      src.push(SRC.scopeProtocols);
    } else if (mode === 'two-way') {
      just.push('Получатель отвечает отправителю в том же соединении — одно двунаправленное правило, а не два.');
      src.push(SRC.modes);
    } else if (mode === 'one-way') {
      just.push('Обратная передача не нужна — однонаправленное правило (программный диод): обратно не проходит ни один пакет.');
      src.push(SRC.modes, SRC.scopeProtocols);
    }
    if (senders.length > 1 || g.flows.length > 1 || g.flows.some((f) => senderCount(ctx, f) > 1)) {
      just.push('Несколько отправителей шлют одному получателю на один порт по одному протоколу — это одно правило (collect на стороне отправителей).');
    }
    if (!g.timeSync) {
      const sameSenderOther = [...groups.values()].filter(
        (o) => o !== g && !o.timeSync && [...o.senders].some((s) => g.senders.has(s)),
      );
      if (sameSenderOther.length > 0)
        just.push('Другой получатель, порт или протокол — отдельное правило: у правила один конечный получатель.');
    }
    just.push(...g.notes);
    const unknownsText = g.unknowns.length ? g.unknowns : [];

    rules.push({
      type: 'data',
      from: g.from,
      to: g.to,
      mode,
      protocol: g.protocol,
      port: g.port,
      description: g.flows.map((f) => f.description).join('; '),
      justification: just.join(' '),
      senders,
      receivers,
      flowIds: g.flows.map((f) => f.id),
      timeSync: g.timeSync || undefined,
      ends: {
        [g.from]: { devices: senders, sends: true, receives: mode === 'two-way' },
        [g.to]: { devices: receivers, sends: mode === 'two-way', receives: true },
      },
      collectNetwork: g.from,
      exchangeNetwork: g.to,
      unknowns: unknownsText,
      sources: uniqSources(src),
    });
  }
  return rules;
}

function senderCount(ctx: Ctx, f: DataFlow): number {
  return f.senders.reduce((n, s) => n + (ctx.state.devices.find((d) => d.id === s)?.count ?? 1), 0);
}

function industrialPolicy(p: string): string {
  if (p === 'MQTT') return 'топики';
  if (p === 'Modbus TCP') return 'регистры';
  return 'типы данных и команд';
}

function otherNet(ctx: Ctx, id: string): string | undefined {
  return ctx.nets.find((n) => n.id !== id)?.id;
}

// ====================================================================== file rules

interface Automation {
  node: string;
  kind: 'pull' | 'push';
  key: string;
}

function automations(transfers: FileTransfer[]): Automation[] {
  const out: Automation[] = [];
  for (const t of transfers) {
    if (isKnown(t.send) && t.send.method === 'pull')
      out.push({ node: t.from, kind: 'pull', key: `pull|${t.from}|${t.send.storage ?? ''}|${t.send.protocol ?? ''}` });
    if (isKnown(t.receive) && t.receive.method === 'push')
      out.push({ node: t.to, kind: 'push', key: `push|${t.to}|${t.receive.storage ?? ''}|${t.receive.protocol ?? ''}` });
  }
  return out;
}

/** Можно ли уложить набор направлений в одно правило (ограничения PULL/PUSH). */
function fitsOneRule(transfers: FileTransfer[]): { ok: boolean; reason?: string } {
  const autos = automations(transfers);
  const pullNodes = new Set(autos.filter((a) => a.kind === 'pull').map((a) => a.node));
  if (pullNodes.size > 1)
    return {
      ok: false,
      reason: 'Автоматический забор (PULL) нужен с обеих сторон, а в одном правиле PULL может быть только на одном Узле — нужны два правила, по одному на направление.',
    };
  const byNode = new Map<string, Set<string>>();
  for (const a of autos) {
    if (!byNode.has(a.node)) byNode.set(a.node, new Set());
    byNode.get(a.node)!.add(a.key);
  }
  for (const [, keys] of byNode) {
    if (keys.size > 1) {
      const kinds = new Set([...keys].map((k) => k.split('|')[0]));
      return {
        ok: false,
        reason:
          kinds.size > 1
            ? 'На одном Узле нужны и автоматическая доставка (PUSH), и автоматический забор (PULL), а у правила на Узле допускается только одна автоматическая настройка — нужны два правила.'
            : 'На одном Узле нужны две разные автоматические настройки, а каждая настройка PULL/PUSH привязывается к одному правилу — нужны отдельные правила.',
      };
    }
  }
  return { ok: true };
}

interface FileBucket {
  flows: FileFlow[];
  transfers: FileTransfer[];
  checksKey: string;
}

function checksKey(f: FileFlow): string {
  const common = isKnown(f.checks) ? [...f.checks].sort().join(',') : String(f.checks);
  const byNode = f.checksByNode
    ? Object.keys(f.checksByNode)
        .sort()
        .map((k) => `${k}:${[...f.checksByNode![k]].sort().join(',')}`)
        .join(';')
    : '';
  return `${common}|${byNode}`;
}

function hasHumans(f: FileFlow): boolean {
  if (!isKnown(f.transfers)) return true;
  return f.transfers.some(
    (t) =>
      !isKnown(t.send) ||
      !isKnown(t.receive) ||
      t.send.method === 'manual' ||
      t.send.method === 'usb' ||
      t.receive.method === 'manual' ||
      t.receive.method === 'usb',
  );
}

function exactlyOneUser(f: FileFlow): boolean {
  return isKnown(f.users) && f.users.exact === 1;
}

function buildFileRules(ctx: Ctx, flows: FileFlow[]): { rules: Omit<Rule, 'id'>[]; minExtra: number } {
  if (flows.length === 0) return { rules: [], minExtra: 0 };
  ctx.sources.push(SRC.fileRules, SRC.scopeFileSetup);
  const rules: Omit<Rule, 'id'>[] = [];
  let minExtra = 0;
  const buckets: FileBucket[] = [];

  for (const f of flows) {
    const c = f.description;
    // --- направления
    if (f.transfers === null) {
      ctx.questions.push(Q.fileDirection(f.id, c, ctx.nets));
    } else if (f.transfers === UNKNOWN) {
      ctx.unknowns.push({ path: `ff:${f.id}:direction`, text: `«${c}»: направление передачи файлов неизвестно.`, affectsResult: true });
    }
    const transfers = isKnown(f.transfers) ? f.transfers : [];
    let methodUnknown = false;

    for (const t of transfers) {
      const fromNet = net(ctx, t.from);
      const toNet = net(ctx, t.to);
      if (!fromNet || !toNet || t.from === t.to) {
        ctx.issues.push({ severity: 'error', text: `«${c}»: не удалось определить стороны передачи файлов.` });
        continue;
      }
      const usbOnFrom = t.from === ctx.open; // USB есть только на Узле А, а он обращён к открытой сети
      const usbOnTo = t.to === ctx.open;

      if (t.send === null) ctx.questions.push(Q.fileSend(f.id, c, fromNet, usbOnFrom));
      else if (t.send === UNKNOWN) {
        methodUnknown = true;
        ctx.unknowns.push({ path: `ff:${f.id}:send:${t.from}`, text: `«${c}»: неизвестно, как файлы отправляются из «${fromNet.name}».`, affectsResult: true });
      } else {
        if (t.send.method === 'usb' && !usbOnFrom) usbError(ctx, c);
        if (t.send.method === 'pull' && t.send.protocol == null) ctx.questions.push(Q.fileAutoProtocol(f.id, c, fromNet, 'send'));
        if (t.send.method === 'pull' && t.send.protocol === UNKNOWN)
          ctx.unknowns.push({ path: `ff:${f.id}:proto:send:${t.from}`, text: `«${c}»: протокол забора файлов (PULL) не указан.`, affectsResult: false });
      }

      if (t.receive === null) ctx.questions.push(Q.fileReceive(f.id, c, toNet, usbOnTo));
      else if (t.receive === UNKNOWN) {
        methodUnknown = true;
        ctx.unknowns.push({ path: `ff:${f.id}:recv:${t.to}`, text: `«${c}»: неизвестно, как файлы получают в «${toNet.name}».`, affectsResult: true });
      } else {
        if (t.receive.method === 'usb' && !usbOnTo) usbError(ctx, c);
        if (t.receive.method === 'push' && t.receive.protocol == null) ctx.questions.push(Q.fileAutoProtocol(f.id, c, toNet, 'recv'));
        if (t.receive.method === 'push' && t.receive.protocol === UNKNOWN)
          ctx.unknowns.push({ path: `ff:${f.id}:proto:recv:${t.to}`, text: `«${c}»: протокол доставки файлов (PUSH) не указан.`, affectsResult: false });
      }
    }

    // --- проверки
    if (f.checks === null && !f.checksByNode) ctx.questions.push(Q.fileChecks(f.id, c));
    else if (f.checks === UNKNOWN)
      ctx.unknowns.push({ path: `ff:${f.id}:checks`, text: `«${c}»: требования к проверкам файлов неизвестны.`, affectsResult: true });

    const humans = hasHumans(f);
    const single = exactlyOneUser(f);

    // --- пользователи (доп. задание; на число правил не влияет)
    if (humans && f.users === null) ctx.questions.push(Q.fileUsers(f.id, c));
    else if (humans && f.users === UNKNOWN)
      ctx.unknowns.push({ path: `ff:${f.id}:users`, text: `«${c}»: число пользователей передачи файлов неизвестно.`, affectsResult: false });

    // --- разделение по проверкам
    let profiles = 1;
    let profilesUnknown = false;
    if (f.differentChecks === true) {
      if (isKnown(f.checkProfiles ?? null)) profiles = Math.max(1, f.checkProfiles as number);
      else {
        profiles = 2;
        profilesUnknown = true;
      }
    } else if (f.differentChecks === null && !single) {
      ctx.questions.push(Q.fileDifferentChecks(f.id, c));
    } else if (f.differentChecks === UNKNOWN) {
      profilesUnknown = true;
    }

    // --- разделение по видимости
    let isolated = 1;
    let isolatedUnknown = false;
    if (f.isolation === true) {
      if (isKnown(f.isolatedGroups ?? null)) isolated = Math.max(1, f.isolatedGroups as number);
      else {
        isolated = 2;
        isolatedUnknown = true;
      }
    } else if (f.isolation === null && humans && !single) {
      ctx.questions.push(Q.fileIsolation(f.id, c));
    } else if (f.isolation === UNKNOWN && humans && !single) {
      isolatedUnknown = true;
    }

    let groups = f.combinedGroups ?? Math.max(profiles, isolated);
    let combinationUnknown = false;
    if (!f.combinedGroups && profiles > 1 && isolated > 1) combinationUnknown = true;
    if (profilesUnknown || isolatedUnknown || combinationUnknown) {
      // Неизвестные способы передачи уже перечислены выше отдельными пунктами.
      const what = [
        profilesUnknown && 'нужны ли разные наборы проверок (и сколько)',
        isolatedUnknown && 'нужно ли разделять полученные файлы между группами (и сколько групп)',
        combinationUnknown && 'совпадают ли группы по проверкам с группами по доступу',
      ].filter(Boolean);
      ctx.unknowns.push({
        path: `ff:${f.id}:split`,
        text: `«${c}»: неизвестно, ${what.join('; ')}. Посчитан минимум.`,
        affectsResult: true,
      });
    }

    if (transfers.length === 0) {
      // Направление ещё не известно — минимум одно правило.
      groups = Math.max(groups, 1);
    }
    const fit = fitsOneRule(transfers);
    const perGroup = fit.ok ? [transfers] : transfers.map((t) => [t]);

    // Простой случай: одна группа, одно правило, всё известно — пробуем объединить с другим совместимым потоком.
    if (groups === 1 && perGroup.length === 1 && f.isolation !== true && isKnown(f.checks) && f.differentChecks !== true) {
      const key = checksKey(f);
      const bucket = buckets.find((b) => b.checksKey === key && fitsOneRule(mergeTransfers(b.transfers, transfers)).ok);
      if (bucket) {
        bucket.flows.push(f);
        bucket.transfers = mergeTransfers(bucket.transfers, transfers);
        continue;
      }
      buckets.push({ flows: [f], transfers, checksKey: key });
      continue;
    }

    for (let gi = 0; gi < groups; gi++) {
      for (const ts of perGroup) {
        rules.push(
          makeFileRule(ctx, [f], ts, {
            groupLabel: groups > 1 ? `группа ${gi + 1} из ${groups}` : undefined,
            splitReason: !fit.ok ? fit.reason : undefined,
            groupReason: groups > 1 ? groupReason(profiles, isolated) : undefined,
          }),
        );
      }
    }
  }

  for (const b of buckets) rules.push(makeFileRule(ctx, b.flows, b.transfers, {}));
  return { rules, minExtra };
}

function groupReason(profiles: number, isolated: number): string {
  const parts: string[] = [];
  if (profiles > 1) parts.push(`на одной стороне нужны ${profiles} разных набора проверок`);
  if (isolated > 1) parts.push(`${isolated} группы пользователей не должны видеть принятые файлы друг друга`);
  return `Правила разделены: ${parts.join(' и ')} — у одного правила один профиль проверок и общая видимость принятых файлов.`;
}

function usbError(ctx: Ctx, c: string) {
  ctx.issues.push({
    severity: 'error',
    text: `«${c}»: USB-порт для носителей есть только на Узле А, который обращён к открытой сети. С флешки файлы можно передать в закрытый сегмент или выгрузить на неё файлы из закрытого сегмента; подключить носитель к Узлу В или к сервисным портам Ядра нельзя.`,
    sources: [SRC.scopeFileMethods, SRC.scopeLimits],
  });
}

function mergeTransfers(a: FileTransfer[], b: FileTransfer[]): FileTransfer[] {
  const out = [...a];
  for (const t of b) {
    const same = out.find((x) => x.from === t.from && x.to === t.to);
    if (!same) out.push(t);
  }
  return out;
}

function makeFileRule(
  ctx: Ctx,
  flows: FileFlow[],
  transfers: FileTransfer[],
  opts: { groupLabel?: string; splitReason?: string; groupReason?: string },
): Omit<Rule, 'id'> {
  const first = transfers[0];
  const from = first?.from ?? ctx.open ?? ctx.nets[0].id;
  const to = first?.to ?? ctx.closed ?? ctx.nets[1].id;
  const twoWay = transfers.length > 1;

  const methods: Record<string, string[]> = {};
  const add = (n: string, s: string) => {
    methods[n] = methods[n] ?? [];
    if (!methods[n].includes(s)) methods[n].push(s);
  };
  let pull = false;
  let usb = false;
  const unknowns: string[] = [];
  for (const t of transfers) {
    if (isKnown(t.send)) {
      add(t.from, sendLabel(t.send));
      if (t.send.method === 'pull') pull = true;
      if (t.send.method === 'usb') usb = true;
    } else {
      add(t.from, 'способ отправки не определён');
      unknowns.push('способ отправки');
    }
    if (isKnown(t.receive)) {
      add(t.to, receiveLabel(t.receive));
      if (t.receive.method === 'usb') usb = true;
    } else {
      add(t.to, 'способ получения не определён');
      unknowns.push('способ получения');
    }
  }
  const protocol: Record<string, string> = {};
  for (const [n, list] of Object.entries(methods)) protocol[n] = list.join('; ');

  const allChecks = new Set<FileCheck>();
  let checksUnknown = false;
  const byNode: Record<string, string[]> = {};
  for (const f of flows) {
    if (isKnown(f.checks)) f.checks.forEach((c) => allChecks.add(c));
    else if (!f.checksByNode) checksUnknown = true;
    if (f.checksByNode)
      for (const [n, cs] of Object.entries(f.checksByNode)) {
        byNode[n] = [...new Set([...(byNode[n] ?? []), ...cs.map(checkLabel)])];
        cs.forEach((c) => allChecks.add(c));
      }
  }
  if (checksUnknown) unknowns.push('проверки');

  const just: string[] = [];
  const src: SourceRef[] = [SRC.fileRules];
  if (opts.groupReason) just.push(opts.groupReason);
  else if (flows.length > 1)
    just.push('Потоки файлов объединены: на каждой стороне один набор проверок и общая видимость принятых файлов — одно правило.');
  else just.push('Один набор проверок на каждой стороне и общая видимость принятых файлов — одно правило.');
  if (opts.splitReason) just.push(opts.splitReason);
  else if (twoWay) just.push('Обмен в обе стороны настраивается одним правилом: на каждом Узле не больше одной автоматической настройки (PULL или PUSH).');
  const sideMethods = Object.values(methods);
  if (sideMethods.length === 2 && sideMethods[0].join() !== sideMethods[1].join())
    just.push('Способы и протоколы на двух сторонах выбираются независимо и на число правил не влияют.');
  if (Object.keys(byNode).length > 1) just.push('Проверки на отправляющем и принимающем Узлах различаются — второе правило для этого не нужно.');
  if (usb) {
    just.push('Флешка подключается к USB-порту Узла А, поток с неё идёт прямо на Узел А, минуя межсетевой экран.');
    src.push(SRC.scopeFileMethods);
  }
  if ([...allChecks].some((c) => c.startsWith('icap'))) {
    just.push('Антивирус, песочница и DLP — внешние системы, подключаемые по ICAP; встроенного антивируса в «Синониксе» нет.');
    src.push(SRC.scopeChecks);
  }

  const description = flows.map((f) => f.description).join('; ') + (opts.groupLabel ? ` (${opts.groupLabel})` : '');
  const senders: string[] = [];
  const receivers: string[] = [];
  const ends: Rule['ends'] = {};
  const end = (n: string) => (ends[n] = ends[n] ?? { devices: [], sends: false, receives: false });
  const addDev = (n: string, id: string | undefined) => {
    if (id && !end(n).devices.includes(id)) end(n).devices.push(id);
  };
  for (const t of transfers) {
    const s = end(t.from);
    const r = end(t.to);
    s.sends = true;
    r.receives = true;
    if (isKnown(t.send)) {
      const dev = t.send.storage ?? t.send.actor;
      if (dev) senders.push(dev);
      addDev(t.from, dev);
      if (t.send.method === 'manual' && !t.send.actor) s.manual = true;
      if (t.send.method === 'usb') s.usb = s.usb === 'out' ? 'both' : 'in';
      s.method = joinMethod(s.method, methodShort(t.send.method, t.send.protocol));
    }
    if (isKnown(t.receive)) {
      const dev = t.receive.storage ?? t.receive.actor;
      if (dev) receivers.push(dev);
      addDev(t.to, dev);
      if (t.receive.method === 'manual' && !t.receive.actor) r.manual = true;
      if (t.receive.method === 'usb') r.usb = r.usb === 'in' ? 'both' : 'out';
      r.method = joinMethod(r.method, methodShort(t.receive.method, t.receive.protocol));
    }
  }

  return {
    type: 'file',
    from,
    to,
    mode: twoWay ? 'two-way' : transfers.length === 1 ? 'one-way' : null,
    protocol,
    description,
    justification: just.join(' '),
    senders,
    receivers,
    flowIds: flows.map((f) => f.id),
    ends,
    methods,
    checks: [...allChecks].map(checkLabel),
    checksByNode: Object.keys(byNode).length ? byNode : undefined,
    pull,
    usb,
    unknowns,
    sources: uniqSources(src),
  };
}

function methodShort(method: string, protocol: unknown): string {
  const p = typeof protocol === 'string' && protocol !== UNKNOWN ? protocol : '';
  switch (method) {
    case 'manual':
      return 'SFTP вручную';
    case 'usb':
      return 'с флешки';
    case 'pull':
      return [p, 'PULL'].filter(Boolean).join(', ');
    case 'push':
      return [p, 'PUSH'].filter(Boolean).join(', ');
  }
  return method;
}

function joinMethod(a: string | undefined, b: string): string {
  if (!a) return b;
  return a.split(' / ').includes(b) ? a : `${a} / ${b}`;
}

// ====================================================================== file users

function countFileUsers(ctx: Ctx, flows: FileFlow[], rules: Rule[]): EngineResult['fileUsers'] {
  if (flows.length === 0) return { count: 0, range: null, breakdown: [] };
  ctx.sources.push(SRC.fileUsers);
  const breakdown: string[] = [];
  let min = 0;
  let max: number | null = 0;
  let unknown = false;
  const names = new Set<string>();
  let namedCounted = false;

  for (const f of flows) {
    if (!hasHumans(f)) continue;
    const u = f.users;
    if (!isKnown(u)) {
      unknown = true;
      breakdown.push(`«${f.description}»: число людей неизвестно`);
      continue;
    }
    if (u.exact !== undefined && f.userNames && f.userNames.length === u.exact) {
      // Явно названные люди не считаются повторно в разных потоках.
      const before = names.size;
      f.userNames.forEach((n) => names.add(n.trim().toLowerCase()));
      const added = names.size - before;
      min += added;
      if (max !== null) max += added;
      namedCounted = true;
      breakdown.push(`«${f.description}»: ${u.exact} чел. (${f.userNames.join(', ')})${added < u.exact ? ', часть уже учтена' : ''}`);
    } else if (u.exact !== undefined) {
      min += u.exact;
      if (max !== null) max += u.exact;
      breakdown.push(`«${f.description}»: ${u.exact} чел.`);
    } else {
      min += u.min ?? 0;
      max = max === null || u.max === null || u.max === undefined ? null : max + u.max;
      breakdown.push(`«${f.description}»: от ${u.min ?? 0} до ${u.max ?? '…'} чел.`);
    }
  }
  void namedCounted;

  const pullRules = rules.filter((r) => r.type === 'file' && r.pull).length;
  if (pullRules > 0) {
    min += pullRules;
    if (max !== null) max += pullRules;
    breakdown.push(`Технические пользователи для автоматического забора (PULL): ${pullRules} (по одному на правило с PULL)`);
  }
  if (rules.some((r) => r.type === 'file' && Object.values(r.methods ?? {}).some((m) => m.some((s) => s.includes('PUSH')))))
    breakdown.push('Автоматическая доставка (PUSH) пользователя не требует.');

  if (unknown) return { count: null, range: min > 0 ? { min, max: null } : null, breakdown };
  if (max !== null && min === max) return { count: min, range: null, breakdown };
  return { count: null, range: { min, max }, breakdown };
}

// ====================================================================== utils

function dedupeQuestions(qs: Question[]): Question[] {
  const seen = new Set<string>();
  return qs.filter((q) => (seen.has(q.id) ? false : (seen.add(q.id), true)));
}
