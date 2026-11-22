import { modeLabel, type Rule, type SessionView } from '@synonyx/core';

export function RulesTable({ view }: { view: SessionView }) {
  const { result: r, state } = view;
  const net = (id: string) => state.networks.find((n) => n.id === id)?.name ?? id;
  const dev = (ids: string[]) => ids.map((id) => state.devices.find((d) => d.id === id)?.name ?? id).join(', ');
  if (!r.rules.length) return <div className="empty">Правил пока нет.</div>;

  return (
    <div className="rules">
      {r.status !== 'completed' && (
        <div className="status warn small">
          {r.status === 'preliminary' ? `Предварительная оценка: минимум ${r.minRules} правил.` : 'Черновик: параметры ещё уточняются.'} Неизвестные значения отмечены.
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>№</th>
              <th>Источник</th>
              <th>Получатель</th>
              <th>Тип</th>
              <th>Режим</th>
              <th>Протокол / порт или способы</th>
              <th>Проверки</th>
              <th>Обоснование</th>
            </tr>
          </thead>
          <tbody>
            {r.rules.map((rule) => (
              <tr key={rule.id}>
                <td className="num">{rule.id}</td>
                <td>
                  <div className="net">{net(rule.from)}</div>
                  <div>{rule.type === 'data' ? dev(rule.senders) || unknown('не указан') : sideText(rule, rule.from, dev)}</div>
                </td>
                <td>
                  <div className="net">{net(rule.to)}</div>
                  <div>{rule.type === 'data' ? dev(rule.receivers) || unknown('не указан') : sideText(rule, rule.to, dev)}</div>
                </td>
                <td>{rule.type === 'data' ? 'данные' : 'файлы'}</td>
                <td>{rule.mode ? modeLabel(rule.mode) : unknown('не определён')}</td>
                <td>{protocolCell(rule, net)}</td>
                <td>{checksCell(rule, net)}</td>
                <td className="just">
                  {rule.justification}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Считаются логические правила «Синоникса» (настройки collect/exchange на Узлах А и В — одно правило), правила межсетевого экрана не учитываются.
      </p>
    </div>
  );
}

const unknown = (t: string) => <span className="unknown">{t}</span>;

function sideText(rule: Rule, netId: string, dev: (ids: string[]) => string) {
  const e = rule.ends[netId];
  if (!e) return unknown('не определено');
  const parts = [dev(e.devices), e.manual ? 'пользователи (вручную)' : '', e.usb ? 'USB-носитель на Узле А' : ''].filter(Boolean);
  return parts.join(', ') || unknown('не указано');
}

function protocolCell(rule: Rule, net: (id: string) => string) {
  if (rule.type === 'data') {
    const proto = typeof rule.protocol === 'string' ? rule.protocol : null;
    return (
      <>
        {rule.timeSync && 'NTP · '}
        {proto ?? unknown('протокол не указан')} {rule.port != null ? rule.port : unknown('порт не указан')}
      </>
    );
  }
  return (
    <ul className="plain">
      {Object.entries(rule.methods ?? {}).map(([n, m]) => (
        <li key={n}>
          <b>{net(n)}:</b> {m.map((x) => (x.includes('не определён') ? unknown(x) : x)).reduce<React.ReactNode[]>((a, x, i) => (i ? [...a, '; ', x] : [x]), [])}
        </li>
      ))}
    </ul>
  );
}

function checksCell(rule: Rule, net: (id: string) => string) {
  if (rule.type === 'data') return <span className="muted">—</span>;
  if (rule.checksByNode)
    return (
      <ul className="plain">
        {Object.entries(rule.checksByNode).map(([n, c]) => (
          <li key={n}>
            <b>{net(n)}:</b> {c.join(', ')}
          </li>
        ))}
      </ul>
    );
  if (rule.unknowns.includes('проверки')) return unknown('не определены');
  return rule.checks?.length ? rule.checks.join(', ') : 'без проверок';
}
