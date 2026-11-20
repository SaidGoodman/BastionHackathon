import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { applyOps, emptyState, evaluate, type Op } from '@synonyx/core';
import { fixtures as S } from '@synonyx/core';
import { buildDiagram, diagramToXml, type Cell } from '../src/index.js';

type V = Extract<Cell, { kind: 'vertex' }>;
type E = Extract<Cell, { kind: 'edge' }>;

function make(ops: Op[]) {
  const state = applyOps(emptyState(), ops).state;
  const res = evaluate(state);
  const d = buildDiagram(state, res);
  return { state, res, d, xml: diagramToXml(d) };
}

function parse(xml: string) {
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (_l: string, m: string) => errors.push(m) } as any).parseFromString(xml, 'text/xml');
  expect(errors).toEqual([]);
  return doc;
}

const vertices = (cells: Cell[]) => cells.filter((c): c is V => c.kind === 'vertex');
const edges = (cells: Cell[]) => cells.filter((c): c is E => c.kind === 'edge');
const byId = (cells: Cell[], id: string) => vertices(cells).find((c) => c.id === id)!;
const inside = (a: V['box'], b: V['box']) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const overlap = (a: V['box'], b: V['box']) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Полилиния ребра: точка выхода → точки излома → точка входа. */
function polyline(cells: Cell[], e: E): [number, number][] {
  const f = (k: string) => Number(new RegExp(`${k}=([0-9.]+)`).exec(e.style)![1]);
  const src = byId(cells, e.source).box;
  const dst = byId(cells, e.target).box;
  return [
    [src.x + src.w * f('exitX'), src.y + src.h * f('exitY')],
    ...e.points,
    [dst.x + dst.w * f('entryX'), dst.y + dst.h * f('entryY')],
  ];
}

function segments(p: [number, number][]) {
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i + 1 < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[i + 1];
    if (Math.abs(x1 - x2) < 0.01 && Math.abs(y1 - y2) < 0.01) continue;
    out.push({ x1, y1, x2, y2 });
  }
  return out;
}

function crosses(a: ReturnType<typeof segments>[number], b: ReturnType<typeof segments>[number]): boolean {
  const aH = Math.abs(a.y1 - a.y2) < 0.01;
  const bH = Math.abs(b.y1 - b.y2) < 0.01;
  if (aH === bH) return false;
  const h = aH ? a : b;
  const v = aH ? b : a;
  const [hx1, hx2] = [Math.min(h.x1, h.x2), Math.max(h.x1, h.x2)];
  const [vy1, vy2] = [Math.min(v.y1, v.y2), Math.max(v.y1, v.y2)];
  return v.x1 > hx1 + 0.5 && v.x1 < hx2 - 0.5 && h.y1 > vy1 + 0.5 && h.y1 < vy2 - 0.5;
}

const SCENARIOS: Record<string, Op[]> = { F02: S.F02, F07: S.F07, F01: S.F01, F04: S.F04, U01: S.U01, U02a: S.U02a, U02b: S.U02b };

describe.each(Object.entries(SCENARIOS))('%s', (_name, ops) => {
  const { res, d, xml } = make(ops);

  it('несжатый mxfile/diagram/mxGraphModel, корректный XML', () => {
    const doc = parse(xml);
    const root = doc.documentElement;
    expect(root.nodeName).toBe('mxfile');
    const diagram = root.getElementsByTagName('diagram')[0];
    expect(diagram).toBeDefined();
    expect(diagram.getElementsByTagName('mxGraphModel').length).toBe(1);
    expect(root.getElementsByTagName('mxCell').length).toBeGreaterThan(10);
  });

  it('обязательные элементы и подписи узлов', () => {
    for (const id of ['seg_open', 'seg_closed', 'fw', 'sx_box', 'node_left', 'core', 'node_right']) expect(byId(d.cells, id)).toBeDefined();
    expect(byId(d.cells, 'node_left').value).toBe('УЗЕЛ А');
    expect(byId(d.cells, 'core').value).toBe('ЯДРО');
    expect(byId(d.cells, 'node_right').value).toBe('УЗЕЛ В');
    expect(byId(d.cells, 'fw').value).toContain('МЭ');
  });

  it('размещение: МЭ на границе закрытого сегмента, Синоникс внутри него, открытая сеть слева', () => {
    const fw = byId(d.cells, 'fw').box;
    const closed = byId(d.cells, 'seg_closed').box;
    const open = byId(d.cells, 'seg_open').box;
    expect(fw.x + fw.w / 2).toBe(closed.x);
    expect(inside(byId(d.cells, 'sx_box').box, closed)).toBe(true);
    expect(open.x).toBeLessThan(closed.x);
    for (const c of vertices(d.cells).filter((c) => c.role === 'card_closed')) expect(inside(c.box, closed)).toBe(true);
    for (const c of vertices(d.cells).filter((c) => c.role === 'card_open')) expect(inside(c.box, open)).toBe(true);
  });

  it('каждое правило — участки одного цвета по обе стороны устройства, цвета чередуются', () => {
    for (const r of res.rules) {
      const es = edges(d.cells).filter((e) => e.ruleId === r.id);
      const touchesA = es.some((e) => e.source === 'node_left' || e.target === 'node_left');
      const touchesB = es.some((e) => e.source === 'node_right' || e.target === 'node_right');
      expect(touchesA && touchesB).toBe(true);
      expect(new Set(es.map((e) => e.color)).size).toBe(1);
    }
    const colors = res.rules.map((r) => edges(d.cells).find((e) => e.ruleId === r.id)!.color);
    for (let i = 1; i < colors.length; i++) expect(colors[i]).not.toBe(colors[i - 1]);
  });

  it('все связи ссылаются на существующие блоки', () => {
    const ids = new Set(vertices(d.cells).map((v) => v.id));
    for (const e of edges(d.cells)) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it('подписи не перекрывают блоки и друг друга', () => {
    const pills = vertices(d.cells).filter((c) => c.role === 'pill');
    const blocks = vertices(d.cells).filter((c) => ['card_open', 'card_closed', 'node_a', 'node_b', 'core', 'usb', 'firewall'].includes(c.role ?? ''));
    for (let i = 0; i < pills.length; i++) {
      for (let j = i + 1; j < pills.length; j++) expect(overlap(pills[i].box, pills[j].box), `${pills[i].value} / ${pills[j].value}`).toBe(false);
      for (const b of blocks) expect(overlap(pills[i].box, b.box), `${pills[i].value} / ${b.id}`).toBe(false);
    }
  });

  it('линии не пересекаются и не сливаются', () => {
    const es = edges(d.cells).filter((e) => e.points.length);
    const segs = es.map((e) => ({ e, s: segments(polyline(d.cells, e)) }));
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++) {
        if (segs[i].e.ruleId === segs[j].e.ruleId) continue;
        for (const a of segs[i].s) for (const b of segs[j].s) expect(crosses(a, b), `${segs[i].e.id} × ${segs[j].e.id}`).toBe(false);
      }
    // Свои вертикальные участки: у разных рёбер одной стороны с изломом — разные x.
    const verticalX = (e: E) => (Math.abs(e.points[0][1] - e.points[1][1]) > 0.5 ? e.points[0][0] : null);
    const xs = es.map(verticalX).filter((x): x is number => x !== null);
    expect(new Set(xs).size).toBe(xs.length);
  });
});

describe('USB', () => {
  it('F07: флешка подключена только к Узлу А и не проходит через МЭ', () => {
    const { d } = make(S.F07);
    const usbEdges = edges(d.cells).filter((e) => e.source === 'usb' || e.target === 'usb');
    expect(usbEdges).toHaveLength(1);
    expect(usbEdges[0].source).toBe('usb');
    expect(usbEdges[0].target).toBe('node_left');
    const usb = byId(d.cells, 'usb').box;
    const fw = byId(d.cells, 'fw').box;
    expect(usb.x).toBeGreaterThan(fw.x + fw.w);
    expect(inside(usb, byId(d.cells, 'seg_closed').box)).toBe(true);
  });
});

describe('стрелки по режиму', () => {
  it('F02: двунаправленное — стрелки с двух концов, однонаправленное — только к получателю', () => {
    const { d, res } = make(S.F02);
    const modbus = res.rules.find((r) => r.protocol === 'Modbus TCP')!;
    for (const e of edges(d.cells).filter((e) => e.ruleId === modbus.id)) {
      expect(e.style).toContain('startArrow=block');
      expect(e.style).toContain('endArrow=block');
    }
    const logs = res.rules.find((r) => r.port === 514)!;
    const logEdges = edges(d.cells).filter((e) => e.ruleId === logs.id);
    for (const e of logEdges) expect(e.style).toContain('startArrow=none');
    // Журналы идут из закрытой сети: справа от карточки к Узлу В, слева от Узла А к серверу.
    expect(logEdges.find((e) => e.target === 'node_right')).toBeDefined();
    expect(logEdges.find((e) => e.source === 'node_left')).toBeDefined();
  });
});

describe('много потоков к одному получателю', () => {
  it('несколько правил на одну систему — карточка выше, концы расходятся', () => {
    const ops: Op[] = [
      ...S.F01.slice(0, 4),
      { op: 'upsert_data_flow', id: 'a', description: 'Журналы', senders: ['machines'], receivers: ['logsrv'], protocol: 'UDP', port: 514, reverse: false },
      { op: 'upsert_data_flow', id: 'b', description: 'Метрики', senders: ['machines'], receivers: ['logsrv'], protocol: 'TCP', port: 9100, reverse: false },
      { op: 'upsert_data_flow', id: 'c', description: 'Трапы', senders: ['machines'], receivers: ['logsrv'], protocol: 'UDP', port: 162, reverse: false },
    ];
    const { d, xml } = make(ops);
    parse(xml);
    const cards = vertices(d.cells).filter((c) => c.role === 'card_open');
    expect(cards).toHaveLength(1);
    expect(cards[0].box.h).toBeGreaterThan(56);
  });
});
