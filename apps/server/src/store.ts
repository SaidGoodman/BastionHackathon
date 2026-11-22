/** Хранение сессий и журналов на диске: data/sessions/*.json, data/logs/*.jsonl. */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CallLog, ChatTurn, SessionState, TurnTiming, VendorRequest } from '@synonyx/core';

export interface SessionRecord {
  id: string;
  createdAt: string;
  version: number;
  state: SessionState;
  /** Последнее корректное состояние (без ошибок движка). */
  lastGood: SessionState | null;
  history: ChatTurn[];
  calls: CallLog[];
  timings: TurnTiming[];
  previousState?: { state: SessionState; lastGood: SessionState | null };
}

export class Store {
  private sessions = new Map<string, SessionRecord>();
  private sessDir: string;
  private logDir: string;

  constructor(dataDir: string | null) {
    this.sessDir = dataDir ? join(dataDir, 'sessions') : '';
    this.logDir = dataDir ? join(dataDir, 'logs') : '';
    if (!dataDir) return;
    mkdirSync(this.sessDir, { recursive: true });
    mkdirSync(this.logDir, { recursive: true });
    for (const f of readdirSync(this.sessDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const rec = JSON.parse(readFileSync(join(this.sessDir, f), 'utf8')) as SessionRecord;
        this.sessions.set(rec.id, rec);
      } catch {
        /* повреждённый файл пропускаем */
      }
    }
  }

  get(id: string): SessionRecord | undefined {
    return this.sessions.get(id);
  }

  all(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  save(rec: SessionRecord) {
    this.sessions.set(rec.id, rec);
    if (this.sessDir) writeFileSync(join(this.sessDir, `${rec.id}.json`), JSON.stringify(rec, null, 1));
  }

  /** Вызов модели: в сессию (с защитой от повторной записи call_id) и в общий журнал. */
  addCall(log: CallLog) {
    const rec = this.sessions.get(log.session_id);
    if (rec && !rec.calls.some((c) => c.call_id === log.call_id)) rec.calls.push(log);
    this.append('calls.jsonl', log);
  }

  addTiming(sessionId: string, t: TurnTiming) {
    const rec = this.sessions.get(sessionId);
    if (rec) {
      const i = rec.timings.findIndex((x) => x.turn_id === t.turn_id);
      if (i >= 0) rec.timings[i] = t;
      else rec.timings.push(t);
    }
    this.append('turns.jsonl', { session_id: sessionId, ...t });
  }

  addVendorRequests(sessionId: string, reqs: VendorRequest[]) {
    for (const r of reqs) this.append('requests_for_vendor.jsonl', { session_id: sessionId, at: new Date().toISOString(), ...r });
  }

  private append(file: string, obj: unknown) {
    if (!this.logDir) return;
    appendFileSync(join(this.logDir, file), JSON.stringify(obj) + '\n');
  }

  readLog(file: string): string {
    const p = join(this.logDir, file);
    return this.logDir && existsSync(p) ? readFileSync(p, 'utf8') : '';
  }
}
