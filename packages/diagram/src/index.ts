/**
 * Генератор .drawio: несжатый XML mxfile → diagram → mxGraphModel (ТЗ §5).
 * Все блоки, подписи и связи — отдельные редактируемые ячейки; растровых «снимков» схемы нет.
 */
import type { EngineResult, SessionState } from '@synonyx/core';
import { buildDiagram, type Cell, type Diagram } from './layout.js';
import { BG } from './styles.js';

export { buildDiagram, type Cell, type Diagram } from './layout.js';
export { RULE_COLORS } from './styles.js';

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number) => String(Math.round(n * 100) / 100);

function cellXml(c: Cell): string {
  if (c.kind === 'vertex') {
    const b = c.box;
    return (
      `<mxCell id="${attr(c.id)}" value="${attr(c.value)}" style="${attr(c.style)}" vertex="1" parent="1">` +
      `<mxGeometry x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" as="geometry"/></mxCell>`
    );
  }
  const pts = c.points.length
    ? `<Array as="points">${c.points.map(([x, y]) => `<mxPoint x="${num(x)}" y="${num(y)}"/>`).join('')}</Array>`
    : '';
  return (
    `<mxCell id="${attr(c.id)}" value="" style="${attr(c.style)}" edge="1" parent="1" source="${attr(c.source)}" target="${attr(c.target)}">` +
    `<mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`
  );
}

export function diagramToXml(d: Diagram, name = 'Синоникс'): string {
  // Порядок слоёв как в образцах: рамки, МЭ и корпус «Синоникса» под линиями (линии проходят через МЭ,
  // наконечники у узлов видны), затем линии, затем карточки и узлы, сверху — подписи потоков.
  const under = new Set(['seg_open', 'seg_closed', 'fw', 'fw2', 'sx_box', 'sx_label']);
  const bottom = d.cells.filter((c) => c.kind === 'vertex' && under.has(c.id));
  const edges = d.cells.filter((c) => c.kind === 'edge');
  const rest = d.cells.filter((c) => c.kind === 'vertex' && !under.has(c.id));
  const pills = rest.filter((c) => c.kind === 'vertex' && c.role === 'pill');
  const others = rest.filter((c) => !(c.kind === 'vertex' && c.role === 'pill'));
  const body = [...bottom, ...edges, ...others, ...pills].map(cellXml).join('');
  return (
    `<mxfile host="synonyx-assistant" type="device">` +
    `<diagram id="synonyx" name="${attr(name)}">` +
    `<mxGraphModel dx="${num(d.width)}" dy="${num(d.height)}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" ` +
    `pageWidth="${num(d.width)}" pageHeight="${num(d.height)}" math="0" shadow="0" background="${BG}">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`
  );
}

/** Главная функция: состояние + результат движка → содержимое файла .drawio. */
export function toDrawio(state: SessionState, res: EngineResult): string {
  return diagramToXml(buildDiagram(state, res));
}
