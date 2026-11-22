import { useState } from 'react';
import type { AnswerValue, Question } from '@synonyx/core';

type Draft = { selected: string[]; unknown: boolean; other: boolean; otherText: string };

const empty = (): Draft => ({ selected: [], unknown: false, other: false, otherText: '' });

/** Карточки уточняющих вопросов: варианты, «не знаю», «другое» с полем. Связанные вопросы — одним шагом. */
export function Questions({
  questions,
  onSubmit,
  disabled,
}: {
  questions: Question[];
  onSubmit: (a: { questionId: string; value: AnswerValue }[]) => Promise<boolean>;
  disabled: boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const d = (id: string) => drafts[id] ?? empty();
  const set = (id: string, patch: Partial<Draft>) => setDrafts((s) => ({ ...s, [id]: { ...d(id), ...patch } }));

  const toggle = (q: Question, value: string) => {
    const cur = d(q.id);
    const has = cur.selected.includes(value);
    const selected = q.multi ? (has ? cur.selected.filter((v) => v !== value) : [...cur.selected, value]) : has ? [] : [value];
    set(q.id, { selected, unknown: false, other: q.multi ? cur.other : false });
  };

  const answers = questions.flatMap((q) => {
    const x = d(q.id);
    if (x.unknown) return [{ questionId: q.id, value: 'unknown' as AnswerValue }];
    if (x.other && x.otherText.trim()) return [{ questionId: q.id, value: { other: x.otherText.trim() } as AnswerValue }];
    if (x.selected.length) return [{ questionId: q.id, value: (q.multi ? x.selected : x.selected[0]) as AnswerValue }];
    return [];
  });

  // Группируем по потоку — один понятный шаг на поток.
  const groups = new Map<string, Question[]>();
  for (const q of questions) groups.set(q.group, [...(groups.get(q.group) ?? []), q]);

  return (
    <div className="questions">
      <div className="questions-head">Уточнения ({questions.length})</div>
      {[...groups.values()].map((qs) => (
        <div className="q-group" key={qs[0].group}>
          {qs[0].context && <div className="q-context">{qs[0].context}</div>}
          {qs.map((q) => {
            const x = d(q.id);
            return (
              <fieldset className="q" key={q.id}>
                <legend>{q.text}</legend>
                <div className="q-options">
                  {q.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      className={`opt ${x.selected.includes(o.value) ? 'on' : ''}`}
                      aria-pressed={x.selected.includes(o.value)}
                      onClick={() => toggle(q, o.value)}
                    >
                      {q.multi && <span className="box" aria-hidden>{x.selected.includes(o.value) ? '●' : ''}</span>}
                      {o.label}
                    </button>
                  ))}
                  {q.allowUnknown && (
                    <button
                      type="button"
                      className={`opt muted ${x.unknown ? 'on' : ''}`}
                      aria-pressed={x.unknown}
                      onClick={() => set(q.id, { unknown: !x.unknown, selected: [], other: false })}
                    >
                      не знаю
                    </button>
                  )}
                  {q.allowOther && (
                    <button
                      type="button"
                      className={`opt muted ${x.other ? 'on' : ''}`}
                      aria-pressed={x.other}
                      onClick={() => set(q.id, { other: !x.other, unknown: false, selected: q.multi ? x.selected : [] })}
                    >
                      другое…
                    </button>
                  )}
                </div>
                {x.other && (
                  <input
                    className="other-input"
                    autoFocus
                    placeholder="Опишите своими словами"
                    value={x.otherText}
                    onChange={(e) => set(q.id, { otherText: e.target.value })}
                  />
                )}
              </fieldset>
            );
          })}
        </div>
      ))}
      <div className="questions-foot">
        <span className="muted">
          Отвечено {answers.length} из {questions.length}
        </span>
        <button className="btn primary" disabled={disabled || answers.length === 0} onClick={() => void onSubmit(answers).then((ok) => ok && setDrafts({}))}>
          Ответить
        </button>
      </div>
    </div>
  );
}
