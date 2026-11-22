import { useEffect, useState } from 'react';
import type { SessionView } from '@synonyx/core';
import { projectStarted } from '../api';
import { CostPanel } from './CostPanel';
import { DiagramView } from './DiagramView';
import { RulesTable } from './RulesTable';

type Tab = 'explain' | 'rules' | 'diagram' | 'cost';

export function ResultPanel({ view, onRendered }: { view: SessionView; onRendered: (version: number) => void }) {
  const [tab, setTab] = useState<Tab>('diagram');
  const r = view.result;
  const hasProject = r.rules.length > 0 || r.status !== 'needs_clarification';

  return (
    <section className="result" aria-label="Результат">
      <StatusBanner view={view} />
      <nav className="tabs" role="tablist">
        {(
          [
            ['diagram', 'Схема'],
            ['rules', `Правила${r.rules.length ? ` (${r.rules.length})` : ''}`],
            ['explain', 'Объяснение'],
            ['cost', 'Расходы'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
        <span className="version">версия {view.version}</span>
      </nav>
      <div className="tab-body">
        {/* Схема монтируется всегда, чтобы отрисовка завершалась и при открытой другой вкладке. */}
        <div hidden={tab !== 'diagram'} className="fill">
          {hasProject ? (
            <DiagramView xml={view.drawio} version={view.version} onRendered={onRendered} />
          ) : (
            <Empty text="Схема появится, когда станут понятны две сети и хотя бы один поток." onRendered={() => onRendered(view.version)} />
          )}
        </div>
        {tab === 'rules' && <RulesTable view={view} />}
        {tab === 'explain' && (
          <div className="explain">
            <Markdownish text={view.explanation} />
            {view.state.requestsForVendor.length > 0 && (
              <div className="vendor">
                <div className="vendor-head">Эти пожелания можно передать разработчику продукта</div>
                <ul>
                  {view.state.requestsForVendor.map((v) => (
                    <li key={v.text}>
                      {v.text} <span className="muted">({v.source === 'unsupported' ? 'нет в продукте' : 'ответ «другое»'})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {tab === 'cost' && <CostPanel view={view} />}
      </div>
    </section>
  );
}

function StatusBanner({ view }: { view: SessionView }) {
  const r = view.result;
  // Вопросы о продукте до описания задачи проект не начинают.
  if (!projectStarted(view)) return <div className="status idle">Ожидаю описание задачи</div>;
  const users =
    r.fileUsers.count !== null
      ? `пользователей передачи файлов: ${r.fileUsers.count}`
      : r.fileUsers.range
        ? `пользователей передачи файлов: ${r.fileUsers.range.min}–${r.fileUsers.range.max ?? '…'}`
        : 'пользователей передачи файлов: неизвестно';
  switch (r.status) {
    case 'completed':
      return (
        <div className="status ok">
          <b>Готово:</b> правил «Синоникса» — {r.rulesCount} · {users}
        </div>
      );
    case 'preliminary':
      return (
        <div className="status warn">
          <b>Предварительная оценка: минимум {r.minRules} правил.</b> Не хватает сведений — см. «Объяснение».
        </div>
      );
    case 'unsupported':
      return <div className="status err">Требуемый набор не помещается в рамки одного «Синоникса».</div>;
    default:
      return (
        <div className="status info">
          <b>Требуются уточнения.</b> {r.rules.length ? 'Показан черновик — это ещё не готовый проект.' : 'Ответьте на вопросы в диалоге.'}
        </div>
      );
  }
}

function Empty({ text, onRendered }: { text: string; onRendered: () => void }) {
  // Шаг без схемы считается завершённым, когда отрисован этот текст.
  useEffect(() => {
    requestAnimationFrame(onRendered);
  });
  return <div className="empty">{text}</div>;
}

/** Минимальная разметка: **жирный**, списки «- », абзацы. */
function Markdownish({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        const items = lines.filter((l) => l.startsWith('- '));
        const head = lines.filter((l) => !l.startsWith('- '));
        return (
          <div key={i} className="md-block">
            {head.map((l, j) => (
              <p key={j}>{bold(l)}</p>
            ))}
            {items.length > 0 && (
              <ul>
                {items.map((l, j) => (
                  <li key={j}>{bold(l.slice(2))}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </>
  );
}

function bold(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>));
}
