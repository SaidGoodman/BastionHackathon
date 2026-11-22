/** Контракт HTTP API между сервером и интерфейсом. */
import type { AnswerValue } from './ops.js';
import type { EngineResult, Question, SessionState, SourceRef } from './types.js';
import type { UsageSummary } from './usage.js';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  at: string;
  kind: 'message' | 'answers' | 'reply' | 'error';
  text: string;
  /** Вопросы, заданные в этом ответе ассистента. */
  questions?: Question[];
  /** Ответы пользователя на карточки (для истории). */
  answers?: { questionId: string; label: string }[];
  /** Версия результата, к которой относится ответ. */
  resultVersion?: number;
  sources?: SourceRef[];
  /** Снимок схемы, приложенный к ответу. */
  diagramXml?: string;
}

export interface TurnTiming {
  turn_id: string;
  kind: 'message' | 'answers';
  started_at: string;
  server_ms: number;
  /** Полное время на клиенте: от отправки до завершённой отрисовки (присылает интерфейс). */
  client_ms: number | null;
  llm_calls: number;
  status: 'ok' | 'error';
}

export interface SessionView {
  id: string;
  createdAt: string;
  /** Растёт при каждом изменении конфигурации. */
  version: number;
  state: SessionState;
  result: EngineResult;
  explanation: string;
  drawio: string;
  /** Вопросы, на которые ждём ответа. */
  pendingQuestions: Question[];
  history: ChatTurn[];
  usage: UsageSummary;
  timing: { turns: TurnTiming[]; mean_seconds: number | null };
  llm: { configured: boolean; models: string[] };
}

export interface MessageRequest {
  text: string;
  clientTurnId?: string;
}

export interface AnswersRequest {
  answers: { questionId: string; value: AnswerValue }[];
  clientTurnId?: string;
}

export interface TimingReport {
  turnId: string;
  clientMs: number;
}
