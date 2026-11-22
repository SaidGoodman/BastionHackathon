import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnswerValue, SessionView } from '@synonyx/core';
import { api, type AppConfig, type StepResponse } from './api';
import { Chat } from './components/Chat';
import { ResultPanel } from './components/ResultPanel';

const SESSION_KEY = 'synonyx.session';

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [view, setView] = useState<SessionView | null>(null);
  const [busy, setBusy] = useState(false);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
  /** Шаг, для которого ждём завершения отрисовки схемы, чтобы отправить полное время. */
  const pendingTiming = useRef<{ turnId: string; t0: number; version: number } | null>(null);

  useEffect(() => {
    api.config().then(setConfig).catch(() => setConfig({ llm: { configured: false, models: [] }, dev: false, fixtures: [] }));
    const saved = safeGet(SESSION_KEY);
    (saved ? api.get(saved).catch(() => api.create()) : api.create()).then((v) => {
      setView(v);
      safeSet(SESSION_KEY, v.id);
    });
  }, []);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!exportMenu.current?.contains(event.target as Node)) exportMenu.current?.removeAttribute('open');
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const newSession = async () => {
    const v = await api.create();
    safeSet(SESSION_KEY, v.id);
    setError(null);
    setView(v);
  };

  /** Выполняет шаг; при ошибке ничего из введённого не теряется, а кнопка «Повторить» повторяет тот же запрос. */
  const runStep = useCallback(
    async (call: () => Promise<StepResponse>): Promise<boolean> => {
      if (!view) return false;
      setBusy(true);
      setError(null);
      const t0 = performance.now();
      try {
        const res = await call();
        const changedDiagram = res.version !== view.version;
        pendingTiming.current = { turnId: res.turnId, t0, version: res.version };
        setView(res);
        if (!changedDiagram) {
          // Схема не менялась: шаг завершён, как только ответ отрисован.
          requestAnimationFrame(() => reportTiming(res.id, res.version));
        }
        return true;
      } catch (e: any) {
        const retry = () => void runStep(call);
        setError({ message: e.message, retry });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [view],
  );

  const reportTiming = (sessionId: string, version: number) => {
    const p = pendingTiming.current;
    if (!p || p.version !== version) return;
    pendingTiming.current = null;
    void api.timing(sessionId, p.turnId, performance.now() - p.t0);
  };

  const undo = async () => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      setView(await api.undo(view.id, view.version));
    } catch (e: any) {
      setError({ message: e.message, retry: () => void undo() });
    } finally {
      setBusy(false);
    }
  };

  if (!view) return <div className="boot">Загрузка…</div>;

  const downloadDiagram = () => {
    const url = URL.createObjectURL(new Blob([view.drawio], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'synonyx.drawio'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <div className="brand-title">Ассистент размещения «Синоникса»</div>
            <div className="brand-sub">
              предварительное проектирование · версия продукта 1.9
              {config && !config.llm.configured && <span className="warn-chip">модель не подключена</span>}
            </div>
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={undo} disabled={busy || !view.canUndo}>Отменить изменение</button>
          <details className="export-menu" ref={exportMenu} onKeyDown={(event) => {
            if (event.key === 'Escape') { exportMenu.current?.removeAttribute('open'); exportMenu.current?.querySelector('summary')?.focus(); }
          }}>
            <summary className="btn">Экспорт файлов <span aria-hidden="true">▾</span></summary>
            <div className="export-options" onClick={() => exportMenu.current?.removeAttribute('open')}>
              <button onClick={downloadDiagram}>Скачать схему</button>
              <a href={api.jsonUrl(view.id)} download>Экспорт в JSON</a>
              <a href={api.logUrl(view.id)} download>Экспорт журнала</a>
            </div>
          </details>
          <button className="btn primary" onClick={newSession} disabled={busy}>
            Новая сессия
          </button>
        </div>
      </header>
      <main className="layout">
        <Chat
          view={view}
          busy={busy}
          error={error}
          onSend={(text) => runStep(() => api.message(view.id, text))}
          onAnswers={(answers: { questionId: string; value: AnswerValue }[]) => runStep(() => api.answers(view.id, answers))}
        />
        <ResultPanel view={view} onRendered={(version) => reportTiming(view.id, version)} />
      </main>
    </div>
  );
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
