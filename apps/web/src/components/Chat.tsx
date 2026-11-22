import { useEffect, useRef, useState } from 'react';
import type { AnswerValue, ChatTurn, SessionView } from '@synonyx/core';
import { projectStarted, type AppConfig } from '../api';
import { Questions } from './Questions';
import { Sources } from './Sources';
import { loadViewer } from './DiagramView';

const EXAMPLE =
  'Есть закрытая сеть цеха и офисная сеть. Два сервера цеха отправляют журналы на сервер в офисе по UDP 514. ' +
  'Сервер в офисе опрашивает контроллер по Modbus TCP. Инженер из офиса передаёт в цех файлы программ для станков, их нужно проверять антивирусом.';

interface Props {
  view: SessionView;
  busy: boolean;
  error: { message: string; retry: () => void } | null;
  config: AppConfig | null;
  onSend: (text: string) => Promise<boolean>;
  onAnswers: (a: { questionId: string; value: AnswerValue }[]) => Promise<boolean>;
  onScenario: (name: string) => void;
}

export function Chat({ view, busy, error, config, onSend, onAnswers, onScenario }: Props) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const empty = view.history.length === 0;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [view.history.length, busy]);

  const send = async () => {
    if (!text.trim() || busy) return;
    // Текст очищается только после успешного ответа — при ошибке ничего не теряется.
    if (await onSend(text)) setText('');
  };

  const lastAssistant = [...view.history].reverse().find((t) => t.role === 'assistant');

  return (
    <section className="chat" aria-label="Диалог">
      <div className="chat-list" ref={listRef}>
        {empty && <StartScreen onExample={() => setText(EXAMPLE)} config={config} onScenario={onScenario} />}
        {view.history.map((t) => (
          <Turn key={t.id} turn={t} />
        ))}
        {!busy && lastAssistant && projectStarted(view) && view.pendingQuestions.length > 0 && (
          <Questions key={lastAssistant.id} questions={view.pendingQuestions} onSubmit={onAnswers} disabled={busy} />
        )}
        {busy && (
          <div className="turn assistant pending">
            <span className="spinner" aria-hidden /> Обрабатываю запрос…
          </div>
        )}
        {error && (
          <div className="error-box" role="alert">
            <div>{error.message}</div>
            <button className="btn" onClick={error.retry} disabled={busy}>
              Повторить
            </button>
          </div>
        )}
      </div>
      <div className="composer">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={empty ? 'Опишите две сети и что между ними нужно передавать…' : 'Уточнение, вопрос о схеме или правка…'}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
          }}
        />
        <div className="composer-actions">
          {empty && (
            <button className="btn ghost" onClick={() => setText(EXAMPLE)} disabled={busy}>
              Подставить пример
            </button>
          )}
          <span className="hint">Ctrl+Enter — отправить</span>
          <button className="btn primary" onClick={send} disabled={busy || !text.trim()}>
            Отправить
          </button>
        </div>
      </div>
    </section>
  );
}

function StartScreen({ onExample, config, onScenario }: { onExample: () => void; config: AppConfig | null; onScenario: (n: string) => void }) {
  return (
    <div className="start">
      <h1>Где поставить «Синоникс» и сколько правил понадобится</h1>
      <p>
        Опишите своими словами две сети и что между ними нужно передавать: журналы, телеметрию, время, файлы. Ассистент выделит сети, системы и
        потоки, задаст вопросы только о том, что влияет на решение, и подготовит:
      </p>
      <ul>
        <li>объяснение размещения межсетевого экрана и «Синоникса»;</li>
        <li>таблицу минимального набора правил с обоснованием;</li>
        <li>схему в стиле «АйТи Бастион» и редактируемый файл .drawio.</li>
      </ul>
      <div className="example">
        <div className="example-label">Пример описания</div>
        <p>{EXAMPLE}</p>
        <button className="btn" onClick={onExample}>
          Подставить в поле ввода
        </button>
      </div>
      <p className="muted">Если чего-то не знаете — не страшно: я задам уточняющие вопросы с вариантами ответа.</p>
      {config?.dev && config.fixtures.length > 0 && (
        <div className="dev">
          <span>Режим разработки — загрузить сценарий без модели:</span>
          {config.fixtures.map((f) => (
            <button key={f} className="chip" onClick={() => onScenario(f)}>
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Turn({ turn }: { turn: ChatTurn }) {
  return (
    <div className={`turn ${turn.role} ${turn.kind}`}>
      {turn.kind === 'answers' && turn.answers ? (
        <ul className="answers">
          {turn.answers.map((a) => (
            <li key={a.questionId}>{a.label}</li>
          ))}
        </ul>
      ) : (
        <div className="text">{turn.text}</div>
      )}
      {turn.diagramXml && <ChatDiagram xml={turn.diagramXml} />}
      {turn.role === 'assistant' && turn.sources && turn.sources.length > 0 && <Sources sources={turn.sources} compact />}
    </div>
  );
}

/** Снимок в истории не меняется при последующих изменениях проекта. */
function ChatDiagram({ xml }: { xml: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadViewer().then(() => {
      if (cancelled || !host.current) return;
      const el = document.createElement('div');
      el.className = 'mxgraph';
      el.setAttribute('data-mxgraph', JSON.stringify({ xml, toolbar: '', nav: false, resize: true, lightbox: true }));
      host.current.replaceChildren(el);
      window.GraphViewer.createViewerForElement(el);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [xml]);
  return <div className="chat-diagram" aria-label="Схема в сообщении">{error ? 'Не удалось загрузить схему. Откройте вкладку «Схема».' : <div ref={host} />}</div>;
}
