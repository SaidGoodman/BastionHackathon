/** Служебный JSON для экспертной проверки (совместим с result.example.json и 04_benchmarks.json). */
import type { EngineResult, Rule, SessionState } from './types.js';

export interface ResultJsonExtras {
  sessionId: string;
  usage?: unknown;
  timing?: unknown;
}

export function toResultJson(state: SessionState, res: EngineResult, extras: ResultJsonExtras) {
  const idMap = new Map<string, string>();
  if (res.closedNetwork) idMap.set(res.closedNetwork, 'closed');
  if (res.openNetwork) idMap.set(res.openNetwork, 'open');
  const mid = (id: string) => idMap.get(id) ?? id;

  const networks = state.networks.map((n) => ({
    id: mid(n.id),
    name: n.name,
    trust: n.id === res.closedNetwork ? 'closed' : n.id === res.openNetwork ? 'open' : n.trust,
    declared_trust: n.trust,
  }));

  const rules = res.rules.map((r) => ruleJson(r, mid, state));

  return {
    schema_version: '1.1',
    session_id: extras.sessionId,
    status: res.status,
    networks,
    firewall: { side: res.firewall.side, existing: res.firewall.existing, name: res.firewall.name ?? null },
    synonyx: { location: 'closed', node_a_faces: 'open', node_b_faces: 'closed' },
    rules,
    rules_count: rules.length,
    min_rules: res.status === 'preliminary' ? res.minRules : undefined,
    file_users_count: res.fileUsers.count,
    file_users_range: res.fileUsers.range,
    file_users_breakdown: res.fileUsers.breakdown,
    requests_for_vendor: state.requestsForVendor.map((r) => r.text),
    requests_for_vendor_details: state.requestsForVendor,
    unknowns: res.unknowns.map((u) => ({ ...u, path: remapPath(u.path, mid) })),
    assumptions: res.assumptions.map((a) => a.text),
    devices: state.devices.map((d) => ({ id: d.id, network_id: mid(d.networkId), name: d.name, ...(d.count ? { count: d.count } : {}) })),
    issues: res.issues.map((i) => ({ severity: i.severity, text: i.text })),
    sources: res.sources,
    usage: extras.usage ?? { status: 'not_measured' },
    timing: extras.timing ?? { turns: [], mean_turn_seconds: null },
  };
}

function remapPath(p: string, mid: (id: string) => string): string {
  return p.split(':').map((x) => (x.startsWith('n') && /^n\d+$/.test(x) ? mid(x) : x)).join(':');
}

function ruleJson(r: Rule, mid: (id: string) => string, state: SessionState) {
  const dev = (id: string) => state.devices.find((d) => d.id === id)?.name ?? id;
  const base = {
    id: r.id,
    type: r.type,
    from: mid(r.from),
    to: mid(r.to),
    mode: r.mode,
    description: r.description,
    justification: r.justification,
    senders: r.senders.map(dev),
    receivers: r.receivers.map(dev),
    unknowns: r.unknowns,
    sources: r.sources,
  };
  if (r.type === 'data') {
    return {
      ...base,
      protocol: r.protocol,
      port: r.port ?? null,
      ...(r.timeSync ? { time_sync: true } : {}),
      collect_side: r.collectNetwork ? mid(r.collectNetwork) : undefined,
      exchange_side: r.exchangeNetwork ? mid(r.exchangeNetwork) : undefined,
    };
  }
  const protocol = Object.fromEntries(Object.entries((r.protocol as Record<string, string>) ?? {}).map(([k, v]) => [mid(k), v]));
  return {
    ...base,
    protocol,
    checks: r.checks ?? [],
    ...(r.checksByNode ? { checks_by_node: Object.fromEntries(Object.entries(r.checksByNode).map(([k, v]) => [mid(k), v])) } : {}),
    methods: Object.fromEntries(Object.entries(r.methods ?? {}).map(([k, v]) => [mid(k), v])),
    pull: !!r.pull,
    usb: !!r.usb,
  };
}
