import {
  DATA_PROTOCOLS,
  FILE_CHECKS,
  type Op,
  type SessionState,
  type SourceRef,
} from '@synonyx/core';
import type { ExtractOutput, Intent, KbSnippet } from './extractor.js';

const INTENTS: readonly Intent[] = [
  'describe',
  'modify',
  'question_about_solution',
  'product_question',
  'ambiguous',
  'off_topic',
];
const FILE_PROTOCOLS = ['SFTP', 'FTP', 'SMB'] as const;
const SEND_METHODS = ['manual', 'pull', 'usb'] as const;
const RECEIVE_METHODS = ['manual', 'push', 'usb'] as const;
const TRUST = ['open', 'closed', null, 'unknown'] as const;

export class InvalidModelOutputError extends Error {
  constructor(message: string) {
    super(`Ответ модели отклонён: ${message}`);
    this.name = 'InvalidModelOutputError';
  }
}

const fail = (message: string): never => {
  throw new InvalidModelOutputError(message);
};
const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown, field: string, required = true): string | undefined => {
  if (v === undefined && !required) return undefined;
  if (typeof v !== 'string' || !v.trim()) fail(`${field} должен быть непустой строкой`);
  return v as string;
};
const maybeString = (v: unknown, field: string) => {
  if (v !== null && v !== 'unknown' && typeof v !== 'string') fail(`${field} должен быть строкой, null или unknown`);
};
const finiteNumber = (v: unknown, field: string, integer = false) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (integer && !Number.isInteger(v))) fail(`${field} должен быть неотрицательным числом`);
};
const stringArray = (v: unknown, field: string) => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) fail(`${field} должен быть массивом строк`);
};
const maybeStringArray = (v: unknown, field: string) => {
  if (v !== null && v !== 'unknown') stringArray(v, field);
};

export function validateExtractOutput(out: ExtractOutput, state: SessionState, kb: KbSnippet[] = []): void {
  if (!isObject(out)) fail('результат должен быть объектом');
  if (!INTENTS.includes(out.intent)) fail(`неизвестное намерение «${String(out.intent)}»`);
  if (!Array.isArray(out.ops)) fail('поле ops должно быть массивом');
  if (out.reply !== undefined && typeof out.reply !== 'string') fail('reply должен быть строкой');
  if (out.sources !== undefined) validateSources(out.sources, kb);

  const networks = new Set(state.networks.map((x) => x.id));
  const devices = new Set(state.devices.map((x) => x.id));
  const flows = new Set(state.flows.map((x) => x.id));
  const flowKinds = new Map(state.flows.map((x) => [x.id, x.kind]));

  out.ops.forEach((raw, index) => {
    if (!isObject(raw) || typeof raw.op !== 'string') fail(`ops[${index}] должен содержать поле op`);
    const op = raw as Op;
    switch (op.op) {
      case 'set_network':
        string(op.id, `ops[${index}].id`); if (op.name !== undefined) string(op.name, `ops[${index}].name`);
        if (op.trust !== undefined && !TRUST.includes(op.trust as any)) fail(`ops[${index}].trust имеет недопустимое значение`);
        networks.add(op.id); break;
      case 'remove_network':
        string(op.id, `ops[${index}].id`); requireRef(networks, op.id, 'сеть'); networks.delete(op.id); break;
      case 'upsert_device':
        string(op.id, `ops[${index}].id`);
        if (op.name !== undefined) string(op.name, `ops[${index}].name`);
        if (op.note !== undefined) string(op.note, `ops[${index}].note`);
        if (op.count !== undefined) finiteNumber(op.count, `ops[${index}].count`, true);
        if (op.networkId !== undefined) { string(op.networkId, `ops[${index}].networkId`); requireRef(networks, op.networkId, 'сеть'); }
        if (!devices.has(op.id) && !op.networkId) fail(`ops[${index}]: для нового устройства нужна networkId`);
        devices.add(op.id); break;
      case 'remove_device':
        string(op.id, `ops[${index}].id`); requireRef(devices, op.id, 'устройство'); devices.delete(op.id); break;
      case 'upsert_data_flow':
        string(op.id, `ops[${index}].id`); requireFlowKind(flowKinds, op.id, 'data', index);
        validateDataPatch(op, index, networks, devices);
        flows.add(op.id); flowKinds.set(op.id, 'data'); break;
      case 'upsert_file_flow':
        string(op.id, `ops[${index}].id`); requireFlowKind(flowKinds, op.id, 'file', index);
        validateFilePatch(op, index, networks, devices);
        flows.add(op.id); flowKinds.set(op.id, 'file'); break;
      case 'remove_flow':
        string(op.id, `ops[${index}].id`); requireRef(flows, op.id, 'поток'); flows.delete(op.id); flowKinds.delete(op.id); break;
      case 'set_protected':
        if (op.networkId !== null && op.networkId !== 'unknown') { string(op.networkId, `ops[${index}].networkId`); requireRef(networks, op.networkId, 'сеть'); }
        if (op.agreed !== undefined && typeof op.agreed !== 'boolean') fail(`ops[${index}].agreed должен быть boolean`); break;
      case 'set_firewall':
        if (op.existing !== null && op.existing !== 'unknown' && typeof op.existing !== 'boolean') fail(`ops[${index}].existing имеет недопустимое значение`);
        if (op.name !== undefined) string(op.name, `ops[${index}].name`); break;
      case 'add_vendor_request':
        string(op.text, `ops[${index}].text`); if (op.quote !== undefined) string(op.quote, `ops[${index}].quote`);
        if (op.source !== 'unsupported' && op.source !== 'other_answer') fail(`ops[${index}].source имеет недопустимое значение`); break;
      case 'add_assumption':
        string(op.text, `ops[${index}].text`); if (typeof op.agreed !== 'boolean') fail(`ops[${index}].agreed должен быть boolean`); break;
      case 'placement_request': string(op.text, `ops[${index}].text`); break;
      case 'reject': string(op.text, `ops[${index}].text`); string(op.reason, `ops[${index}].reason`); break;
      case 'mark_asked': string(op.questionId, `ops[${index}].questionId`); break;
      default: fail(`ops[${index}].op «${String((raw as any).op)}» не поддерживается`);
    }
  });
}

function requireRef(set: Set<string>, id: string, kind: string) {
  if (!set.has(id)) fail(`ссылка на неизвестную ${kind} «${id}»`);
}
function requireFlowKind(kinds: Map<string, string>, id: string, expected: string, index: number) {
  const actual = kinds.get(id);
  if (actual && actual !== expected) fail(`ops[${index}]: поток «${id}» уже имеет тип ${actual}`);
}
function validateSources(sources: SourceRef[], kb: KbSnippet[]) {
  if (!Array.isArray(sources) || sources.some((s) => !isObject(s) || typeof s.file !== 'string' || typeof s.section !== 'string')) fail('sources должен быть массивом ссылок');
  if (kb.length && sources.some((s) => !kb.some((k) => k.file === s.file && k.section === s.section))) fail('указан источник, которого нет среди переданных фрагментов базы знаний');
}
function validateDataPatch(op: any, index: number, networks: Set<string>, devices: Set<string>) {
  if (op.description !== undefined) string(op.description, `ops[${index}].description`);
  if (op.purpose !== undefined && !['logs', 'telemetry', 'time', 'backup', 'polling', 'database', 'video', 'other'].includes(op.purpose)) fail(`ops[${index}].purpose имеет недопустимое значение`);
  if (op.senders !== undefined) { stringArray(op.senders, `ops[${index}].senders`); op.senders.forEach((id: string) => requireRef(devices, id, 'устройство')); }
  if (op.receivers !== undefined) { maybeStringArray(op.receivers, `ops[${index}].receivers`); if (Array.isArray(op.receivers)) op.receivers.forEach((id: string) => requireRef(devices, id, 'устройство')); }
  for (const f of ['fromNetwork', 'toNetwork']) if (op[f] !== undefined) { maybeString(op[f], `ops[${index}].${f}`); if (typeof op[f] === 'string') requireRef(networks, op[f], 'сеть'); }
  if (op.protocol !== undefined) { maybeString(op.protocol, `ops[${index}].protocol`); if (typeof op.protocol === 'string' && op.protocol !== 'unknown' && !DATA_PROTOCOLS.includes(op.protocol as any)) fail(`ops[${index}].protocol «${op.protocol}» не поддерживается`); }
  if (op.port !== undefined) { if (op.port !== null && op.port !== 'unknown') finiteNumber(op.port, `ops[${index}].port`, true); if (typeof op.port === 'number' && op.port > 65535) fail(`ops[${index}].port вне диапазона 0..65535`); }
  if (op.reverse !== undefined && op.reverse !== null && op.reverse !== 'unknown' && typeof op.reverse !== 'boolean') fail(`ops[${index}].reverse имеет недопустимое значение`);
  if (op.isTimeSync !== undefined && typeof op.isTimeSync !== 'boolean') fail(`ops[${index}].isTimeSync должен быть boolean`);
}
function validateFilePatch(op: any, index: number, networks: Set<string>, devices: Set<string>) {
  if (op.description !== undefined) string(op.description, `ops[${index}].description`);
  if (op.transfers !== undefined && op.transfers !== null && op.transfers !== 'unknown') {
    if (!Array.isArray(op.transfers)) fail(`ops[${index}].transfers должен быть массивом`);
    op.transfers.forEach((t: any, ti: number) => {
      if (!isObject(t)) fail(`ops[${index}].transfers[${ti}] должен быть объектом`);
      string(t.from, `ops[${index}].transfers[${ti}].from`); requireRef(networks, t.from, 'сеть');
      string(t.to, `ops[${index}].transfers[${ti}].to`); requireRef(networks, t.to, 'сеть');
      validateSpec(t.send, SEND_METHODS, `ops[${index}].transfers[${ti}].send`, devices);
      validateSpec(t.receive, RECEIVE_METHODS, `ops[${index}].transfers[${ti}].receive`, devices);
    });
  }
  if (op.checks !== undefined && op.checks !== null && op.checks !== 'unknown') { stringArray(op.checks, `ops[${index}].checks`); op.checks.forEach((x: string) => { if (!FILE_CHECKS.includes(x as any)) fail(`ops[${index}].checks содержит неизвестную проверку «${x}»`); }); }
  if (op.differentChecks !== undefined && op.differentChecks !== null && op.differentChecks !== 'unknown' && typeof op.differentChecks !== 'boolean') fail(`ops[${index}].differentChecks имеет недопустимое значение`);
  if (op.isolation !== undefined && op.isolation !== null && op.isolation !== 'unknown' && typeof op.isolation !== 'boolean') fail(`ops[${index}].isolation имеет недопустимое значение`);
  if (op.users !== undefined && op.users !== null && op.users !== 'unknown') {
    if (!isObject(op.users)) fail(`ops[${index}].users должен быть объектом`);
    for (const f of ['exact', 'min']) if (op.users[f] !== undefined) finiteNumber(op.users[f], `ops[${index}].users.${f}`, true);
    if (op.users.max !== undefined && op.users.max !== null) finiteNumber(op.users.max, `ops[${index}].users.max`, true);
  }
}
function validateSpec(spec: any, methods: readonly string[], field: string, devices: Set<string>) {
  if (spec === null || spec === 'unknown') return;
  if (!isObject(spec)) fail(`${field} должен быть объектом, null или unknown`);
  if (!methods.includes(spec.method)) fail(`${field}.method имеет недопустимое значение`);
  if (spec.protocol !== undefined && spec.protocol !== null && spec.protocol !== 'unknown' && !FILE_PROTOCOLS.includes(spec.protocol)) fail(`${field}.protocol имеет недопустимое значение`);
  for (const f of ['storage', 'actor']) if (spec[f] !== undefined) { string(spec[f], `${field}.${f}`); if (f === 'storage') requireRef(devices, spec[f], 'устройство'); }
}
