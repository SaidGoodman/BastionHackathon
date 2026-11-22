import type { AnswerValue, SessionView } from '@synonyx/core';

export type StepResponse = SessionView & { turnId: string };

export interface AppConfig {
  llm: { configured: boolean; models: string[] };
  dev: boolean;
  fixtures: string[];
}

/** Описание задачи начато: есть хотя бы одна сеть, система или поток. До этого возможны только вопросы о продукте. */
export function projectStarted(view: SessionView): boolean {
  const s = view.state;
  return s.networks.length > 0 || s.devices.length > 0 || s.flows.length > 0;
}

export interface KbSection {
  file: string;
  section: string;
  chunks: { id: string; file: string; section: string; text: string }[];
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Сервер недоступен. Проверьте, что он запущен, и повторите.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Ошибка ${res.status}`);
  return json as T;
}

export const api = {
  config: () => req<AppConfig>('GET', '/api/config'),
  create: () => req<SessionView>('POST', '/api/sessions'),
  get: (id: string) => req<SessionView>('GET', `/api/sessions/${id}`),
  message: (id: string, text: string) => req<StepResponse>('POST', `/api/sessions/${id}/messages`, { text }),
  answers: (id: string, answers: { questionId: string; value: AnswerValue }[]) =>
    req<StepResponse>('POST', `/api/sessions/${id}/answers`, { answers }),
  undo: (id: string, expectedVersion: number) => req<SessionView>('POST', `/api/sessions/${id}/undo`, { expectedVersion }),
  timing: (id: string, turnId: string, clientMs: number) =>
    req<{ ok: true }>('POST', `/api/sessions/${id}/timing`, { turnId, clientMs }).catch(() => undefined),
  scenario: (id: string, name: string) => req<SessionView>('POST', `/api/sessions/${id}/dev/scenario/${name}`),
  kbSection: (file: string, section: string) =>
    req<KbSection>('GET', `/api/kb/section?file=${encodeURIComponent(file)}&section=${encodeURIComponent(section)}`),
  drawioUrl: (id: string) => `/api/sessions/${id}/diagram.drawio`,
  jsonUrl: (id: string) => `/api/sessions/${id}/result.json`,
  logUrl: (id: string) => `/api/sessions/${id}/log.jsonl`,
};
