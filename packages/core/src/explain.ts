/** Текст объяснения и строки легенды под схемой — без модели, из результата движка. */
import type { EngineResult, Rule, SessionState } from './types.js';

export function netName(state: SessionState, id: string | null | undefined): string {
  return state.networks.find((n) => n.id === id)?.name ?? '—';
}

function names(state: SessionState, ids: string[]): string {
  return ids.map((id) => state.devices.find((d) => d.id === id)?.name ?? id).join(', ');
}

export function modeLabel(mode: Rule['mode']): string {
  return mode === 'one-way' ? 'однонаправленное' : mode === 'two-way' ? 'двунаправленное' : 'режим не определён';
}

/** Подпись потока на схеме: «2 · UDP 514». */
export function flowLabel(r: Rule): string {
  if (r.type === 'file') return `${r.id} · файлы${r.usb ? ' (USB)' : ''}`;
  const proto = typeof r.protocol === 'string' ? (r.timeSync ? `NTP/${r.protocol}` : r.protocol) : r.timeSync ? 'NTP' : 'протокол ?';
  return `${r.id} · ${proto}${r.port != null ? ' ' + r.port : ''}`;
}

/** Одна строка правила для легенды и объяснения (02_methodology.md, разд. 6, п. 5). */
export function ruleLine(state: SessionState, r: Rule): string {
  const fromN = netName(state, r.from);
  const toN = netName(state, r.to);
  if (r.type === 'data') {
    const who = r.senders.length ? names(state, r.senders) : `системы сети «${fromN}»`;
    const whom = r.receivers.length ? names(state, r.receivers) : `получатель в сети «${toN}» (не указан)`;
    const proto = typeof r.protocol === 'string' ? r.protocol : 'протокол не указан';
    const port = r.port != null ? ` ${r.port}` : ', порт не указан';
    return `${r.id}. ${r.description}: ${who} → ${whom} (из «${fromN}» в «${toN}»): ${proto}${port}, ${modeLabel(r.mode)} правило.`;
  }
  const methods = Object.entries(r.methods ?? {})
    .map(([n, m]) => `${netName(state, n)}: ${m.join('; ')}`)
    .join(' / ');
  const checks = r.checksByNode
    ? Object.entries(r.checksByNode)
        .map(([n, c]) => `${netName(state, n)} — ${c.join(', ')}`)
        .join('; ')
    : r.checks?.length
      ? r.checks.join(', ')
      : r.unknowns.includes('проверки')
        ? 'проверки не определены'
        : 'без проверок';
  const dir = r.mode === 'two-way' ? `между «${fromN}» и «${toN}»` : `из «${fromN}» в «${toN}»`;
  return `${r.id}. ${r.description}: файлы ${dir}; ${methods}; проверки: ${checks}; ${modeLabel(r.mode)} правило.`;
}

export function placementLine(state: SessionState, res: EngineResult): string {
  const closed = netName(state, res.closedNetwork);
  const open = netName(state, res.openNetwork);
  const fw = res.firewall.existing === true ? `существующий межсетевой экран${state.firewallName ? ` (${state.firewallName})` : ''}` : 'межсетевой экран (рекомендуем, даже если его нет в описании)';
  const both = res.firewall.side === 'both' ? ' Так как обе сети открытые, межсетевые экраны допускаются с обеих сторон «Синоникса».' : '';
  return (
    `Размещение: на границе сегмента «${closed}» со стороны сети «${open}» стоит ${fw}; ` +
    `«Синоникс» — внутри «${closed}» сразу за ним. Узел А обращён к сети «${open}», Узел В — к системам «${closed}». ` +
    `Прямого соединения сетей в обход «Синоникса» нет.${both}`
  );
}

export function explain(state: SessionState, res: EngineResult): string {
  const out: string[] = [];
  if (res.status === 'needs_clarification') {
    out.push(res.rules.length ? `Черновик: ${res.rules.length} ${plural(res.rules.length)}, ещё не окончательный. Чтобы спроектировать схему корректно, нужно уточнить несколько параметров.` : 'Чтобы спроектировать схему корректно, нужно уточнить несколько параметров.');
  } else if (res.status === 'preliminary') {
    out.push(`**Предварительная оценка: минимум ${res.minRules} ${plural(res.minRules)}.**`);
    out.push('Не хватает сведений:');
    for (const u of res.unknowns.filter((x) => x.affectsResult)) out.push(`- ${u.text}`);
  } else if (res.status === 'unsupported') {
    out.push('Требуемый набор не помещается в рамки одного «Синоникса».');
  } else {
    out.push(`**Правил «Синоникса»: ${res.rulesCount}.**`);
  }

  if (res.rules.length && res.closedNetwork) {
    out.push('');
    for (const r of res.rules) out.push(ruleLine(state, r));
    out.push('');
    out.push(placementLine(state, res));
  }

  const minor = res.unknowns.filter((u) => !u.affectsResult);
  if (minor.length && res.status !== 'needs_clarification') {
    out.push('');
    out.push('Не указано (на число правил не влияет, в схеме оставлено пустым):');
    for (const u of minor) out.push(`- ${u.text}`);
  }

  if (res.fileUsers.count !== 0 || res.fileUsers.range) {
    out.push('');
    if (res.fileUsers.count !== null) out.push(`Пользователей передачи файлов (лицензия): ${res.fileUsers.count}.`);
    else if (res.fileUsers.range) out.push(`Пользователей передачи файлов (лицензия): от ${res.fileUsers.range.min} до ${res.fileUsers.range.max ?? '…'}.`);
    else out.push('Пользователей передачи файлов: неизвестно.');
    for (const b of res.fileUsers.breakdown) out.push(`- ${b}`);
  }

  for (const a of res.assumptions) out.push('', `Проектное решение: ${a.text}`);
  for (const i of res.issues) out.push('', (i.severity === 'error' ? '⚠ ' : '') + i.text);

  if (state.requestsForVendor.length) {
    out.push('', 'Эти пожелания можно передать разработчику продукта:');
    for (const r of state.requestsForVendor) out.push(`- ${r.text}`);
  }
  return out.join('\n');
}

function plural(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'правило';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'правила';
  return 'правил';
}
