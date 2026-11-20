import { useEffect, useRef, useState } from 'react';
import type { SourceRef } from '@synonyx/core';
import { api, type KbSection } from '../api';

/** Ссылки на источники. Клик открывает текст раздела базы знаний — видно, на чём основан ответ. */
export function Sources({ sources, compact }: { sources: SourceRef[]; compact?: boolean }) {
  const [open, setOpen] = useState<SourceRef | null>(null);
  if (!sources.length) return null;
  const modal = open && <SourceModal source={open} onClose={() => setOpen(null)} />;
  if (compact)
    return (
      <details className="sources">
        <summary>Источники ({sources.length})</summary>
        <ul>
          {sources.map((s) => (
            <li key={s.file + s.section}>
              <button className="link" onClick={() => setOpen(s)}>
                <code>{s.file}</code> — {s.section}
              </button>
            </li>
          ))}
        </ul>
        {modal}
      </details>
    );
  return (
    <span className="src-inline">
      {sources.map((s) => (
        <button key={s.file + s.section} className="src" title={`${s.file} — ${s.section}`} onClick={() => setOpen(s)}>
          {s.file.replace(/\.md$/, '')} § {s.section.split(' ')[0]}
        </button>
      ))}
      {modal}
    </span>
  );
}

function SourceModal({ source, onClose }: { source: SourceRef; onClose: () => void }) {
  const [data, setData] = useState<KbSection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let alive = true;
    api
      .kbSection(source.file, source.section)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [source.file, source.section]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Источник" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-file">{source.file}</div>
            <div className="modal-title">{source.section}</div>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="error-box">{error}</div>}
          {!data && !error && <div className="muted">Загрузка…</div>}
          {data?.chunks.map((c) => (
            <div key={c.id} className="kb-chunk">
              {data.chunks.length > 1 && c.section !== source.section && <div className="kb-sub">{c.section.split(' — ').pop()}</div>}
              <KbText text={c.text} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Минимальный показ markdown базы знаний: абзацы, списки, таблицы, жирный шрифт. */
function KbText({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split('\n').filter((l) => l.trim());
        if (lines.every((l) => l.trim().startsWith('|'))) {
          const rows = lines.filter((l) => !/^\|?[\s|:-]*-{3,}/.test(l.trim())).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
          return (
            <div key={i} className="table-wrap kb-table">
              <table>
                <thead>
                  <tr>{rows[0].map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(1).map((r, k) => (
                    <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l)))
          return (
            <ul key={i} className={/^\s*\d+\.\s/.test(lines[0]) ? 'numbered' : undefined}>
              {lines.map((l, k) => (
                <li key={k} className={/^\s{2,}/.test(l) ? 'sub' : undefined}>
                  {inline(l.replace(/^\s*[-*]\s/, ''))}
                </li>
              ))}
            </ul>
          );
        if (b.trim().startsWith('```')) return <pre key={i}>{b.replace(/```/g, '').trim()}</pre>;
        return <p key={i}>{inline(lines.join(' '))}</p>;
      })}
    </>
  );
}

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}
