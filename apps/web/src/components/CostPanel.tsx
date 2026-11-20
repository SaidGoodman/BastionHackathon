import { formatUsd, type SessionView } from '@synonyx/core';

const n = (x: number) => x.toLocaleString('ru-RU');

export function CostPanel({ view }: { view: SessionView }) {
  const u = view.usage;
  const t = view.timing;
  return (
    <div className="cost">
      <div className="kpis">
        <Kpi label="Стоимость сессии" value={formatUsd(u.cost_total_usd)} />
        <Kpi label="Вызовов моделей" value={n(u.calls)} />
        <Kpi label="Входные токены" value={n(u.input_tokens)} />
        <Kpi label="Выходные токены" value={n(u.output_tokens)} />
        <Kpi label="Среднее время шага" value={t.mean_seconds === null ? '—' : `${t.mean_seconds.toFixed(2).replace('.', ',')} с`} />
      </div>
      {u.unconfirmed_calls > 0 && (
        <div className="status warn small">Вызовов без подтверждённого usage: {u.unconfirmed_calls}. Их стоимость не подставлена нулём — см. журнал.</div>
      )}
      <h3>По моделям</h3>
      {u.by_model.length === 0 ? (
        <p className="muted">В этой сессии модели не вызывались (ответы на карточки обрабатываются без модели).</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Модель</th>
                <th>Вызовов</th>
                <th>Вход, ток.</th>
                <th>Выход, ток.</th>
                <th>Тариф вход/выход, $/млн</th>
                <th>Стоимость входа</th>
                <th>Стоимость выхода</th>
                <th>Итого</th>
              </tr>
            </thead>
            <tbody>
              {u.by_model.map((m) => (
                <tr key={m.model_id}>
                  <td>
                    <code>{m.model_id}</code>
                  </td>
                  <td>{m.calls}</td>
                  <td>{n(m.input_tokens)}</td>
                  <td>{n(m.output_tokens)}</td>
                  <td>{m.prices ? `${m.prices.input} / ${m.prices.output}` : '—'}</td>
                  <td>{formatUsd(m.cost_input_usd)}</td>
                  <td>{formatUsd(m.cost_output_usd)}</td>
                  <td>
                    <b>{formatUsd(m.cost_total_usd)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Всего</td>
                <td>{u.calls}</td>
                <td>{n(u.input_tokens)}</td>
                <td>{n(u.output_tokens)}</td>
                <td />
                <td>{formatUsd(u.cost_input_usd)}</td>
                <td>{formatUsd(u.cost_output_usd)}</td>
                <td>
                  <b>{formatUsd(u.cost_total_usd)}</b>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {u.actual_cost_usd !== null && Math.abs(u.actual_cost_usd - u.cost_total_usd) > 1e-12 && (
        <p className="muted">Фактическая стоимость по usage.cost провайдера: {formatUsd(u.actual_cost_usd)} (оценочная считается по единому снимку тарифов).</p>
      )}
      <h3>Шаги</h3>
      {t.turns.length === 0 ? (
        <p className="muted">Шагов пока не было.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Тип</th>
                <th>Сервер, мс</th>
                <th>Полное время, мс</th>
                <th>Вызовов</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {t.turns.map((x, i) => (
                <tr key={x.turn_id}>
                  <td>{i + 1}</td>
                  <td>{x.kind === 'message' ? 'сообщение' : 'ответы на вопросы'}</td>
                  <td>{n(x.server_ms)}</td>
                  <td>{x.client_ms === null ? '—' : n(x.client_ms)}</td>
                  <td>{x.llm_calls}</td>
                  <td>{x.status === 'ok' ? 'ок' : 'ошибка'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="kpi-v">{value}</div>
      <div className="kpi-l">{label}</div>
    </div>
  );
}
