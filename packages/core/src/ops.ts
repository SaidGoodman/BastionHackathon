/**
 * Операции над состоянием. Это же формат ответа LLM-извлечения:
 * модель не пересказывает состояние целиком, а возвращает список изменений.
 * Ответы на карточки вопросов превращаются в те же операции без вызова модели (answerToOps).
 */
import {
  isKnown,
  UNKNOWN,
  type DataFlow,
  type Device,
  type FileCheck,
  type FileFlow,
  type FileProtocol,
  type FileTransfer,
  type Maybe,
  type Network,
  type SessionState,
  type UsersCount,
} from './types.js';

export type Op =
  | { op: 'set_network'; id: string; name?: string; trust?: Maybe<'open' | 'closed'> }
  | { op: 'remove_network'; id: string }
  | { op: 'upsert_device'; id: string; name?: string; networkId?: string; note?: string; count?: number }
  | { op: 'remove_device'; id: string }
  | ({ op: 'upsert_data_flow'; id: string } & Partial<Omit<DataFlow, 'id' | 'kind'>>)
  | ({ op: 'upsert_file_flow'; id: string } & Partial<Omit<FileFlow, 'id' | 'kind'>>)
  | { op: 'remove_flow'; id: string }
  | { op: 'set_protected'; networkId: Maybe<string>; agreed?: boolean }
  | { op: 'set_firewall'; existing: Maybe<boolean>; name?: string }
  | { op: 'add_vendor_request'; text: string; source: 'unsupported' | 'other_answer'; quote?: string }
  | { op: 'add_assumption'; text: string; agreed: boolean }
  | { op: 'placement_request'; text: string }
  | { op: 'reject'; text: string; reason: string }
  | { op: 'mark_asked'; questionId: string };

export interface ApplyResult {
  state: SessionState;
  errors: string[];
}

const clone = <T>(x: T): T => structuredClone(x);

export function applyOps(prev: SessionState, ops: Op[]): ApplyResult {
  const s = clone(prev);
  s.rejected = [];
  const errors: string[] = [];

  for (const o of ops) {
    switch (o.op) {
      case 'set_network': {
        const n = s.networks.find((x) => x.id === o.id);
        if (n) {
          if (o.name !== undefined) n.name = o.name;
          if (o.trust !== undefined) n.trust = o.trust;
        } else {
          s.networks.push({ id: o.id, name: o.name ?? o.id, trust: o.trust ?? null } satisfies Network);
        }
        break;
      }
      case 'remove_network': {
        s.networks = s.networks.filter((n) => n.id !== o.id);
        const gone = new Set(s.devices.filter((d) => d.networkId === o.id).map((d) => d.id));
        s.devices = s.devices.filter((d) => !gone.has(d.id));
        for (const id of gone) detachDevice(s, id);
        if (s.protectedNetwork === o.id) s.protectedNetwork = null;
        break;
      }
      case 'upsert_device': {
        const d = s.devices.find((x) => x.id === o.id);
        if (d) {
          if (o.name !== undefined) d.name = o.name;
          if (o.networkId !== undefined) d.networkId = o.networkId;
          if (o.note !== undefined) d.note = o.note;
          if (o.count !== undefined) d.count = o.count;
        } else {
          if (!o.networkId) {
            errors.push(`Устройство ${o.id}: не указана сеть`);
            break;
          }
          s.devices.push({ id: o.id, name: o.name ?? o.id, networkId: o.networkId, note: o.note, count: o.count } satisfies Device);
        }
        break;
      }
      case 'remove_device': {
        s.devices = s.devices.filter((d) => d.id !== o.id);
        detachDevice(s, o.id);
        break;
      }
      case 'upsert_data_flow': {
        const { op: _op, id, ...patch } = o;
        const f = s.flows.find((x) => x.id === id);
        if (f && f.kind !== 'data') {
          errors.push(`Поток ${id} — файловый, а не поток данных`);
          break;
        }
        if (f) Object.assign(f, stripUndefined(patch));
        else
          s.flows.push({
            id,
            kind: 'data',
            description: patch.description ?? '',
            senders: patch.senders ?? [],
            receivers: patch.receivers ?? null,
            protocol: patch.protocol ?? null,
            port: patch.port ?? null,
            reverse: patch.reverse ?? null,
            ...stripUndefined(patch),
          } as DataFlow);
        break;
      }
      case 'upsert_file_flow': {
        const { op: _op, id, ...patch } = o;
        const f = s.flows.find((x) => x.id === id);
        if (f && f.kind !== 'file') {
          errors.push(`Поток ${id} — поток данных, а не файловый`);
          break;
        }
        if (f) Object.assign(f, stripUndefined(patch));
        else
          s.flows.push({
            id,
            kind: 'file',
            description: patch.description ?? '',
            transfers: patch.transfers ?? null,
            checks: patch.checks ?? null,
            differentChecks: patch.differentChecks ?? null,
            isolation: patch.isolation ?? null,
            users: patch.users ?? null,
            ...stripUndefined(patch),
          } as FileFlow);
        break;
      }
      case 'remove_flow':
        s.flows = s.flows.filter((f) => f.id !== o.id);
        break;
      case 'set_protected':
        s.protectedNetwork = o.networkId;
        if (isKnown(o.networkId)) {
          const n = s.networks.find((x) => x.id === o.networkId);
          s.assumptions = s.assumptions.filter((a) => !a.text.startsWith('Защищаемая сторона'));
          s.assumptions.push({
            text: `Защищаемая сторона в проекте — «${n?.name ?? o.networkId}» (проектное решение; в исходном описании обе сети не были названы закрытыми).`,
            agreed: o.agreed ?? true,
          });
        }
        break;
      case 'set_firewall':
        s.existingFirewall = o.existing;
        if (o.name) s.firewallName = o.name;
        break;
      case 'add_vendor_request':
        if (!s.requestsForVendor.some((r) => r.text === o.text))
          s.requestsForVendor.push({ text: o.text, source: o.source, quote: o.quote });
        break;
      case 'add_assumption':
        s.assumptions.push({ text: o.text, agreed: o.agreed });
        break;
      case 'placement_request':
        s.placementRequest = o.text;
        break;
      case 'reject':
        s.rejected!.push({ text: o.text, reason: o.reason });
        break;
      case 'mark_asked':
        s.asked[o.questionId] = (s.asked[o.questionId] ?? 0) + 1;
        break;
    }
  }
  return { state: s, errors };
}

/** Удаляет устройство из потоков. Поток без получателей удаляется. */
function detachDevice(s: SessionState, id: string) {
  s.flows = s.flows.filter((f) => {
    if (f.kind === 'data') {
      f.senders = f.senders.filter((x) => x !== id);
      if (isKnown(f.receivers)) {
        const had = f.receivers.includes(id);
        f.receivers = f.receivers.filter((x) => x !== id);
        if (had && f.receivers.length === 0) return false;
      }
      if (f.senders.length === 0 && !f.fromNetwork) return false;
      return true;
    }
    if (isKnown(f.transfers))
      for (const t of f.transfers) {
        if (isKnown(t.send) && t.send.storage === id) delete t.send.storage;
        if (isKnown(t.receive) && t.receive.storage === id) delete t.receive.storage;
      }
    return true;
  });
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ====================================================================== ответы на карточки

export type AnswerValue = string | string[] | 'unknown' | { other: string };

export interface AnswerResult {
  ops: Op[];
  /** Текст, который нужно передать модели (ответ «другое» или требующий разбора). */
  forLlm?: string;
}

/**
 * Превращает ответ на карточку вопроса в операции. Без вызова модели.
 * «Другое» сохраняется в requests_for_vendor и уходит модели как текст.
 */
export function answerToOps(state: SessionState, questionId: string, value: AnswerValue): AnswerResult {
  const ops: Op[] = [{ op: 'mark_asked', questionId }];
  if (typeof value === 'object' && !Array.isArray(value)) {
    ops.push({ op: 'add_vendor_request', text: value.other, source: 'other_answer', quote: `${questionId}: ${value.other}` });
    return { ops, forLlm: value.other };
  }
  const parts = questionId.split(':');
  const unknown = value === UNKNOWN;

  // --- сети
  if (questionId === 'net:protected' || questionId === 'net:protected_choice') {
    if (unknown) ops.push({ op: 'set_protected', networkId: UNKNOWN });
    else if (value === 'both_open') {
      for (const n of state.networks) ops.push({ op: 'set_network', id: n.id, trust: 'open' });
    } else if (typeof value === 'string') {
      const bothOpen = state.networks.every((n) => n.trust === 'open');
      if (bothOpen || questionId === 'net:protected_choice') ops.push({ op: 'set_protected', networkId: value, agreed: true });
      else {
        ops.push({ op: 'set_network', id: value, trust: 'closed' });
        for (const n of state.networks) if (n.id !== value) ops.push({ op: 'set_network', id: n.id, trust: 'open' });
      }
    }
    return { ops };
  }
  if (questionId === 'net:pair' && typeof value === 'string') {
    const keep = new Set(value.split('+'));
    for (const n of state.networks) if (!keep.has(n.id)) ops.push({ op: 'remove_network', id: n.id });
    return { ops };
  }
  if (questionId === 'flows:none' || questionId === 'net:second') {
    const text = Array.isArray(value) ? value.join(', ') : String(value);
    return { ops, forLlm: text };
  }

  // --- данные
  if (parts[0] === 'flow') {
    const id = parts[1];
    const f = state.flows.find((x) => x.id === id) as DataFlow | undefined;
    if (!f) return { ops };
    switch (parts[2]) {
      case 'direction': {
        if (unknown) ops.push({ op: 'upsert_data_flow', id, fromNetwork: UNKNOWN, toNetwork: UNKNOWN });
        else {
          const [from, to] = String(value).split('>');
          ops.push({ op: 'upsert_data_flow', id, fromNetwork: from, toNetwork: to });
        }
        break;
      }
      case 'protocol':
        ops.push({ op: 'upsert_data_flow', id, protocol: unknown ? UNKNOWN : String(value) });
        break;
      case 'reverse':
        ops.push({ op: 'upsert_data_flow', id, reverse: unknown ? UNKNOWN : value === 'yes' });
        break;
      case 'receivers': {
        if (unknown) ops.push({ op: 'upsert_data_flow', id, receivers: UNKNOWN });
        else if (value === 'one') {
          const toNet = isKnown(f.toNetwork ?? null) ? (f.toNetwork as string) : otherNetwork(state, f);
          if (toNet) {
            const devId = `${id}-recv`;
            ops.push({ op: 'upsert_device', id: devId, name: 'Система-получатель', networkId: toNet });
            ops.push({ op: 'upsert_data_flow', id, receivers: [devId] });
          }
        } else return { ops, forLlm: 'Получателей несколько' };
        break;
      }
    }
    return { ops };
  }

  // --- файлы
  if (parts[0] === 'ff') {
    const id = parts[1];
    const f = state.flows.find((x) => x.id === id) as FileFlow | undefined;
    if (!f) return { ops };
    const transfers: FileTransfer[] = isKnown(f.transfers) ? structuredClone(f.transfers) : [];
    switch (parts[2]) {
      case 'direction': {
        if (unknown) ops.push({ op: 'upsert_file_flow', id, transfers: UNKNOWN });
        else {
          const [a, b] = state.networks.map((n) => n.id);
          const dirs: [string, string][] = value === 'both' ? [[a, b], [b, a]] : [String(value).split('>') as [string, string]];
          ops.push({
            op: 'upsert_file_flow',
            id,
            transfers: dirs.map(([from, to]) => transfers.find((t) => t.from === from && t.to === to) ?? { from, to, send: null, receive: null }),
          });
        }
        break;
      }
      case 'send':
      case 'recv': {
        const netId = parts[3];
        // 'push:SMB' — способ и протокол одним ответом; 'push' без протокола — протокол неизвестен, не переспрашиваем.
        const [method, proto] = String(value).split(':');
        const protocol: Maybe<FileProtocol> = method === 'manual' ? 'SFTP' : proto ? (proto as FileProtocol) : UNKNOWN;
        for (const t of transfers) {
          if (parts[2] === 'send' && t.from === netId)
            t.send = unknown ? UNKNOWN : { method: method as 'manual' | 'pull' | 'usb', protocol };
          if (parts[2] === 'recv' && t.to === netId)
            t.receive = unknown ? UNKNOWN : { method: method as 'manual' | 'push' | 'usb', protocol };
          if (!unknown && value === 'usb') {
            if (parts[2] === 'send' && t.from === netId && isKnown(t.send)) delete t.send.protocol;
            if (parts[2] === 'recv' && t.to === netId && isKnown(t.receive)) delete t.receive.protocol;
          }
        }
        ops.push({ op: 'upsert_file_flow', id, transfers });
        break;
      }
      case 'proto': {
        const dir = parts[3];
        const netId = parts[4];
        const p: Maybe<FileProtocol> = unknown ? UNKNOWN : (value as FileProtocol);
        for (const t of transfers) {
          if (dir === 'send' && t.from === netId && isKnown(t.send)) t.send.protocol = p;
          if (dir === 'recv' && t.to === netId && isKnown(t.receive)) t.receive.protocol = p;
        }
        ops.push({ op: 'upsert_file_flow', id, transfers });
        break;
      }
      case 'checks': {
        if (unknown) ops.push({ op: 'upsert_file_flow', id, checks: UNKNOWN });
        else {
          const list = (Array.isArray(value) ? value : [value]).filter((v) => v !== 'none') as FileCheck[];
          ops.push({ op: 'upsert_file_flow', id, checks: list });
        }
        break;
      }
      case 'differentChecks': {
        if (unknown) ops.push({ op: 'upsert_file_flow', id, differentChecks: UNKNOWN });
        else if (value === 'no') ops.push({ op: 'upsert_file_flow', id, differentChecks: false });
        else if (value === 'yes') ops.push({ op: 'upsert_file_flow', id, differentChecks: true, checkProfiles: UNKNOWN });
        else ops.push({ op: 'upsert_file_flow', id, differentChecks: true, checkProfiles: Number(value) });
        break;
      }
      case 'isolation': {
        if (unknown) ops.push({ op: 'upsert_file_flow', id, isolation: UNKNOWN });
        else if (value === 'shared') ops.push({ op: 'upsert_file_flow', id, isolation: false });
        else if (value === 'yes') ops.push({ op: 'upsert_file_flow', id, isolation: true, isolatedGroups: UNKNOWN });
        else ops.push({ op: 'upsert_file_flow', id, isolation: true, isolatedGroups: Number(value) });
        break;
      }
      case 'users': {
        let users: Maybe<UsersCount> = UNKNOWN;
        if (!unknown) {
          const [lo, hi] = String(value).split('-');
          users = hi === undefined ? { exact: Number(lo) } : { min: Number(lo), max: hi === '' ? null : Number(hi) };
        }
        ops.push({ op: 'upsert_file_flow', id, users });
        break;
      }
    }
    return { ops };
  }
  return { ops };
}

function otherNetwork(state: SessionState, f: DataFlow): string | undefined {
  const senderNet = state.devices.find((d) => d.id === f.senders[0])?.networkId ?? (isKnown(f.fromNetwork ?? null) ? (f.fromNetwork as string) : undefined);
  return state.networks.find((n) => n.id !== senderNet)?.id;
}
