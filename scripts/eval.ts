/**
 * Сравнение моделей на открытых сценариях: npm run eval [-- --only label1,label2] [--runs 2] [--scenarios F02,N01]
 *
 * Один шаг = первое сообщение сценария → модель → операции → движок. Сравнивается с эталоном из fixtures:
 * число правил, сигнатуры правил (тип, направление закрытая/открытая, режим, протокол, порт, PULL/USB), статус,
 * вопросы движка (лишние — модель упустила сведения, недостающие — модель что-то подставила без основания).
 * Для вопросов о продукте — обязательные и запрещённые фразы в ответе и наличие источников.
 * Отчёт: examples/eval-<время>.json и таблица в консоли. Стоимость — по тарифам снимка из eval-candidates.json.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyOps, callCost, emptyState, evaluate, fixtures, type CallLog, type EngineResult, type Op, type SessionState } from '../packages/core/src/index.js';
import { KbIndex } from '../packages/kb/src/index.js';
import { LlmExtractor, loadDotEnv, OpenRouterClient, type ExtractOutput, type ModelEntry, type ModelsConfig } from '../packages/llm/src/index.js';
import { SCENARIOS, type EvalScenario } from './eval-scenarios.js';

const root = fileURLToPath(new URL('../', import.meta.url));
loadDotEnv(root + '.env');

interface Candidate extends ModelEntry {
  label: string;
}
const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = arg('only')?.split(',');
const onlyScenarios = arg('scenarios')?.split(',');
const runs = Number(arg('runs') ?? 1);

const ORACLE: Candidate = { label: 'oracle', id: 'oracle', provider: null, card: null, purpose: 'self-test', input_per_m: 0, output_per_m: 0, api: { base_url: '-', key_env: 'PATH' } };
const all: Candidate[] = args.includes('--oracle') ? [ORACLE] : JSON.parse(readFileSync(root + 'config/eval-candidates.json', 'utf8')).candidates;
const candidates = all.filter((c) => !only || only.includes(c.label));
const scenarios = SCENARIOS.filter((s) => !onlyScenarios || onlyScenarios.includes(s.name));
const kb = KbIndex.fromDir(root + 'kb');
const CHANGING = new Set(['describe', 'modify']);

// ------------------------------------------------------------------ нормализация для сравнения

function side(net: string | undefined, res: EngineResult) {
  return net === res.closedNetwork ? 'C' : net === res.openNetwork ? 'O' : '?';
}
function ruleSigs(res: EngineResult): string[] {
  return res.rules
    .map((r) =>
      r.type === 'data'
        ? `data ${side(r.from, res)}→${side(r.to, res)} ${r.mode} ${r.protocol ?? '?'} ${r.port ?? '-'}`
        : `file ${side(r.from, res)}→${side(r.to, res)} ${r.mode}${r.pull ? ' pull' : ''}${r.usb ? ' usb' : ''}`,
    )
    .sort();
}
/** id вопроса без id потока и с сетями C/O: «ff:f1:send:n1» → «ff:send:O». */
function questionKinds(res: EngineResult): string[] {
  return res.questions
    .map((q) => {
      const p = q.id.split(':');
      if (p[0] === 'ff' || p[0] === 'df') p.splice(1, 1);
      return p.map((x) => (x === res.closedNetwork ? 'C' : x === res.openNetwork ? 'O' : x)).join(':');
    })
    .sort();
}
function diff(a: string[], b: string[]) {
  const rest = [...b];
  const missing: string[] = [];
  for (const x of a) {
    const i = rest.indexOf(x);
    if (i >= 0) rest.splice(i, 1);
    else missing.push(x);
  }
  return { missing, extra: rest };
}

// ------------------------------------------------------------------ один шаг

interface StepReport {
  scenario: string;
  run: number;
  ok: boolean;
  score: number;
  max: number;
  notes: string[];
  ms: number;
  calls: CallLog[];
  intent?: string;
  reply?: string;
  ops?: Op[];
  error?: string;
}

async function runStep(c: Candidate, sc: EvalScenario, run: number): Promise<StepReport> {
  const calls: CallLog[] = [];
  const client = new OpenRouterClient(process.env[c.api!.key_env]!, (l) => calls.push(l), c.api!.base_url);
  const cfg: ModelsConfig = {
    snapshot: { taken_at: null, source: 'eval' },
    max_input_price_per_m: 0.1,
    models: { extract: c, answer: c },
    fallbacks: [],
  };
  const ex = new LlmExtractor(client, cfg);
  const empty = emptyState();
  const t0 = Date.now();
  let out: ExtractOutput;
  try {
    // --oracle: эталонные операции вместо модели — проверка самого скрипта сравнения.
    if (c.label === 'oracle') out = { intent: sc.fixture ? 'describe' : 'product_question', ops: sc.fixture ? (fixtures as Record<string, Op[]>)[sc.fixture] : [] };
    else out = await ex.extract({
      sessionId: `eval-${c.label}`,
      turnId: `${sc.name}-${run}`,
      state: empty,
      result: evaluate(empty),
      history: [],
      text: sc.text,
      kb: kb.search(sc.text, 4).map((h) => ({ id: h.chunk.id, file: h.chunk.file, section: h.chunk.section, text: h.chunk.text, excerpt: h.excerpt, score: h.score })),
    });
  } catch (e: any) {
    return { scenario: sc.name, run, ok: false, score: 0, max: 1, notes: ['ошибка вызова'], ms: Date.now() - t0, calls, error: String(e?.message ?? e) };
  }
  const ms = Date.now() - t0;
  const ops = CHANGING.has(out.intent) ? out.ops : out.ops.filter((o) => o.op === 'add_vendor_request');
  const { state, errors } = applyOps(empty, ops);
  const res = evaluate(state);
  const notes: string[] = [];
  if (errors.length) notes.push(`ошибки операций: ${errors.join('; ')}`);
  let score = 0;
  let max = 0;
  const check = (cond: boolean, label: string, weight = 1) => {
    max += weight;
    if (cond) score += weight;
    else notes.push(label);
  };

  if (sc.fixture) {
    const exp = evaluate(applyOps(emptyState(), (fixtures as Record<string, Op[]>)[sc.fixture]).state);
    check(CHANGING.has(out.intent), `intent=${out.intent}, ожидалось describe`);
    check(res.rulesCount === exp.rulesCount, `правил ${res.rulesCount}, ожидалось ${exp.rulesCount}`, 2);
    const r = diff(ruleSigs(exp), ruleSigs(res));
    check(!r.missing.length && !r.extra.length, `правила: нет [${r.missing.join(' | ')}], лишние [${r.extra.join(' | ')}]`, 3);
    const q = diff(questionKinds(exp), questionKinds(res));
    // Вопросы, на которые в тексте нет ответа, допустимы — тогда допустим и статус «нужны уточнения».
    const allowed = q.extra.filter((k) => sc.allow?.includes(k));
    q.extra = q.extra.filter((k) => !sc.allow?.includes(k));
    const statusOk = res.status === exp.status || (allowed.length > 0 && !q.extra.length && res.status === 'needs_clarification');
    check(statusOk, `статус ${res.status}, ожидался ${exp.status}`);
    // Не задан ожидаемый вопрос = модель подставила значение без основания (самая дорогая ошибка).
    check(!q.missing.length, `подставлено без основания (нет вопросов): ${q.missing.join(', ')}`, 2);
    check(!q.extra.length, `упущены сведения (лишние вопросы): ${q.extra.join(', ')}`);
  }
  if (sc.product) {
    const text = out.reply ?? '';
    for (const re of sc.product.must) check(re.test(text), `в ответе нет ${re}`);
    for (const re of sc.product.mustNot ?? []) check(!re.test(text), `в ответе запрещённое ${re}`);
    check(!!out.sources?.length, 'нет источников');
    if (sc.product.vendorRequest) check(state.requestsForVendor.length > 0, 'не сохранено пожелание для разработчика');
  }
  return { scenario: sc.name, run, ok: score === max, score, max, notes, ms, calls, intent: out.intent, reply: out.reply, ops: out.ops };
}

// ------------------------------------------------------------------ прогон

const reports: Record<string, StepReport[]> = {};
for (const c of candidates) {
  if (!c.api || !process.env[c.api.key_env]) {
    console.log(`\n${c.label}: пропущен — нет ключа ${c.api?.key_env} в окружении/.env`);
    continue;
  }
  console.log(`\n=== ${c.label} (${c.id}${c.provider ? ' @ ' + c.provider : ''}, $${c.input_per_m}/$${c.output_per_m} за млн)`);
  reports[c.label] = [];
  for (let run = 1; run <= runs; run++)
    for (const sc of scenarios) {
      const r = await runStep(c, sc, run);
      reports[c.label].push(r);
      const tok = r.calls.map((x) => `${x.input_tokens ?? '?'}/${x.output_tokens ?? '?'}`).join(' ');
      console.log(`  ${r.ok ? '✓' : '✗'} ${sc.name.padEnd(5)} ${String(r.score).padStart(2)}/${r.max} ${(r.ms / 1000).toFixed(1).padStart(5)}s  ток ${tok}${r.error ? '  ОШИБКА ' + r.error.slice(0, 160) : ''}`);
      for (const n of r.notes) console.log(`        · ${n}`);
    }
}

// ------------------------------------------------------------------ сводка

console.log('\nМодель                    сценарии  баллы     ср.время  макс.время  вход/выход ток.  стоимость прогона  на шаг');
const summary: Record<string, unknown> = {};
for (const [label, rs] of Object.entries(reports)) {
  const c = candidates.find((x) => x.label === label)!;
  const calls = rs.flatMap((r) => r.calls);
  const tin = calls.reduce((s, x) => s + (x.input_tokens ?? 0), 0);
  const tout = calls.reduce((s, x) => s + (x.output_tokens ?? 0), 0);
  const unknown = calls.filter((x) => x.input_tokens === null).length;
  const cost = callCost(tin, tout, { input: c.input_per_m!, output: c.output_per_m! }).total!;
  const ok = rs.filter((r) => r.ok).length;
  const pts = rs.reduce((s, r) => s + r.score, 0);
  const maxPts = rs.reduce((s, r) => s + r.max, 0);
  const times = rs.map((r) => r.ms / 1000);
  const mean = times.reduce((s, x) => s + x, 0) / times.length;
  summary[label] = { id: c.id, provider: c.provider, ok, total: rs.length, points: pts, max_points: maxPts, mean_s: mean, max_s: Math.max(...times), input_tokens: tin, output_tokens: tout, unknown_usage_calls: unknown, cost_usd: cost, cost_per_step_usd: cost / rs.length };
  console.log(
    `${label.padEnd(25)} ${`${ok}/${rs.length}`.padStart(8)}  ${`${pts}/${maxPts}`.padStart(7)}  ${mean.toFixed(1).padStart(7)}s  ${Math.max(...times).toFixed(1).padStart(9)}s  ${`${tin}/${tout}`.padStart(15)}  ${('$' + cost.toFixed(6)).padStart(17)}  $${(cost / rs.length).toFixed(6)}${unknown ? `  (usage не подтверждён: ${unknown})` : ''}`,
  );
}

mkdirSync(root + 'examples', { recursive: true });
const file = `examples/eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(root + file, JSON.stringify({ at: new Date().toISOString(), runs, summary, reports }, null, 2));
console.log(`\nПодробности: ${file}`);

export type { SessionState };
