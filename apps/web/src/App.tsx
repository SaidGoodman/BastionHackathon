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

  if (!view) return <div className="boot">Загрузка…</div>;

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
          <a className="btn" href={api.drawioUrl(view.id)} download>
            Скачать .drawio
          </a>
          <a className="btn ghost" href={api.jsonUrl(view.id)} target="_blank" rel="noreferrer" title="Служебный JSON для экспертной проверки">
            JSON для эксперта
          </a>
          <a className="btn ghost" href={api.logUrl(view.id)} download title="Журнал вызовов моделей и времени шагов">
            Журнал
          </a>
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
          config={config}
          onSend={(text) => runStep(() => api.message(view.id, text))}
          onAnswers={(answers: { questionId: string; value: AnswerValue }[]) => runStep(() => api.answers(view.id, answers))}
          onScenario={async (name) => setView(await api.scenario(view.id, name))}
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
