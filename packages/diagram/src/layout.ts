/**
 * Раскладка схемы по правилам 02_methodology.md, раздел 6:
 * открытая сеть слева, закрытый сегмент справа, МЭ на левой границе закрытого сегмента,
 * «Синоникс» у левого края закрытого сегмента, USB под Узлом А.
 * Каждое правило — два участка одного цвета по обе стороны устройства, у каждого участка свой вертикальный канал.
 */
import { placementLine, ruleLine, type EngineResult, type Rule, type RuleEnd, type SessionState } from '@synonyx/core';
import { firewallImage } from './firewall.js';
import { RULE_COLORS, S } from './styles.js';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Cell =
  | { kind: 'vertex'; id: string; value: string; style: string; box: Box; role?: string }
  | { kind: 'edge'; id: string; style: string; source: string; target: string; points: [number, number][]; ruleId: number; color: string };

export interface Diagram {
  cells: Cell[];
  width: number;
  height: number;
}

type Side = 'open' | 'closed';

interface Attach {
  rule: Rule;
  color: string;
  side: Side;
  card: Card;
  end: RuleEnd;
  label: string;
  yCard: number;
  yNode: number;
  fracCard: number;
  fracNode: number;
  channel: number;
}

interface Card {
  id: string;
  name: string;
  note: string;
  placeholder: boolean;
  attaches: Attach[];
  box: Box;
}

const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pillWidth = (text: string) => Math.round(6.5 * text.length + 12);
const CARD_W = 240;
const CARD_GAP = 31;
const CHANNEL = 14;

export function buildDiagram(state: SessionState, res: EngineResult): Diagram {
  const openId = res.openNetwork;
  const closedId = res.closedNetwork;
  if (!openId || !closedId) return placeholderDiagram(res);

  const cells: Cell[] = [];
  const cards: Record<Side, Map<string, Card>> = { open: new Map(), closed: new Map() };
  const usb: { rule: Rule; color: string; dir: 'in' | 'out' | 'both'; label: string }[] = [];

  // ---------------------------------------------------------------- 1. концы правил → карточки
  res.rules.forEach((r, i) => {
    const color = RULE_COLORS[i % RULE_COLORS.length];
    for (const side of ['open', 'closed'] as Side[]) {
      const netId = side === 'open' ? openId : closedId;
      const end: RuleEnd = r.ends[netId] ?? { devices: [], sends: false, receives: false };
      const targets = [...end.devices];
      if (end.manual) targets.push('@users');
      if (side === 'open' && end.usb) usb.push({ rule: r, color, dir: end.usb, label: usbLabel(r, end.usb) });
      if (targets.length === 0 && !(side === 'open' && end.usb)) targets.push(`@ph-${r.id}`);
      for (const t of targets) {
        const card = getCard(state, cards[side], t, r, end, side);
        card.attaches.push({
          rule: r, color, side, card, end, label: sideLabel(r, end),
          yCard: 0, yNode: 0, fracCard: 0, fracNode: 0, channel: -1,
        });
      }
    }
  });

  const all = (s: Side) => [...cards[s].values()].flatMap((c) => c.attaches);
  const nA = all('open').length;
  const nB = all('closed').length;

  // ---------------------------------------------------------------- 2. вертикаль
  const TOP = 90;
  const contentTop = TOP + 60;
  for (const s of ['open', 'closed'] as Side[])
    for (const c of cards[s].values()) {
      const k = c.attaches.length;
      c.box.h = k <= 1 ? 56 : Math.max(56, 30 * k + 10);
    }
  const colH = (s: Side) => {
    const list = [...cards[s].values()];
    return list.reduce((h, c) => h + c.box.h, 0) + CARD_GAP * Math.max(0, list.length - 1);
  };
  const nodeH = Math.max(80, 24 * Math.max(nA, nB) + 16);
  const boxH = nodeH + 40;
  const usbBlockH = usb.length ? 40 + 34 + Math.max(0, usb.length - 1) * 22 : 0;
  const midH = 30 + boxH + usbBlockH;
  const contentH = Math.max(colH('open'), colH('closed'), midH, 120);

  for (const s of ['open', 'closed'] as Side[]) {
    let y = contentTop + (contentH - colH(s)) / 2;
    for (const c of cards[s].values()) {
      c.box.y = y;
      y += c.box.h + CARD_GAP;
      c.attaches.forEach((a, j) => {
        a.fracCard = (j + 1) / (c.attaches.length + 1);
        a.yCard = c.box.y + c.box.h * a.fracCard;
      });
    }
  }
  const sxLabelY = contentTop + (contentH - midH) / 2;
  const boxY = sxLabelY + 30;
  const nodeY = boxY + 20;
  const usbY = boxY + boxH + 40;

  // Слоты на узлах — в том же порядке, что и концы у карточек: так участки не пересекаются.
  for (const s of ['open', 'closed'] as Side[]) {
    const list = all(s).sort((a, b) => a.yCard - b.yCard || a.rule.id - b.rule.id);
    list.forEach((a, j) => {
      a.fracNode = (j + 1) / (list.length + 1);
      a.yNode = nodeY + nodeH * a.fracNode;
    });
    assignChannels(list);
  }
  const chans = (s: Side) => Math.max(1, ...all(s).map((a) => a.channel + 1));

  // ---------------------------------------------------------------- 3. горизонталь
  const OPEN_X = 30;
  const openCardX = 70;
  const pillLx = openCardX + CARD_W + 22;
  const maxPillL = Math.max(0, ...all('open').map((a) => pillWidth(a.label)));
  const leftZone = Math.max(470, pillLx + maxPillL + 18);
  const leftZoneEnd = leftZone + (chans('open') - 1) * CHANNEL;
  const fwX = leftZoneEnd + 20;
  const closedX = fwX + 24;
  const sxX = closedX + 60;
  const nodeAX = sxX + 12;
  const coreX = sxX + 88;
  const nodeBX = sxX + 164;
  const sxRight = sxX + 240;
  const rightZone = sxRight + 16;
  const rightZoneEnd = rightZone + (chans('closed') - 1) * CHANNEL;
  const bothFw = res.firewall.side === 'both';
  const fw2X = rightZoneEnd + 20;
  const afterRight = bothFw ? fw2X + 48 : rightZoneEnd;
  const maxPillR = Math.max(0, ...all('closed').map((a) => pillWidth(a.label)));
  const closedCardX = Math.max(1150, afterRight + 20 + maxPillR + 22);
  const closedRight = closedCardX + CARD_W + 30;
  const width = closedRight + 30;

  for (const c of cards.open.values()) Object.assign(c.box, { x: openCardX, w: CARD_W });
  for (const c of cards.closed.values()) Object.assign(c.box, { x: closedCardX, w: CARD_W });

  const segBottom = contentTop + contentH + 40;
  const allCardBoxes = [...cards.open.values(), ...cards.closed.values()].map((c) => c.box);
  const fwTop = Math.min(nodeY, ...allCardBoxes.map((b) => b.y)) - 25;
  const fwBottom = Math.max(nodeY + nodeH, ...allCardBoxes.map((b) => b.y + b.h)) + 25;

  // ---------------------------------------------------------------- 4. ячейки
  const openName = netName(state, openId);
  const closedName = netName(state, closedId);
  const fileUsers =
    res.fileUsers.count !== null
      ? String(res.fileUsers.count)
      : res.fileUsers.range
        ? `${res.fileUsers.range.min}–${res.fileUsers.range.max ?? '…'}`
        : 'неизвестно';
  const countText =
    res.status === 'preliminary'
      ? `предварительно: минимум ${res.minRules}`
      : res.status === 'needs_clarification'
        ? `черновик: ${res.rulesCount}`
        : String(res.rulesCount);

  cells.push(vertex('t1', html('СХЕМА РАЗМЕЩЕНИЯ «СИНОНИКСА»'), S.title, { x: 40, y: 16, w: 700, h: 30 }));
  cells.push(
    vertex(
      't2',
      html(`${openName} ↔ ${closedName} · правил Синоникса: ${countText}` + (res.fileUsers.count === 0 && !res.fileUsers.range ? '' : ` · пользователей передачи файлов: ${fileUsers}`)),
      S.subtitle,
      { x: 40, y: 46, w: width - 80, h: 20 },
    ),
  );
  if (res.status !== 'completed') {
    const t = res.status === 'preliminary' ? 'ПРЕДВАРИТЕЛЬНЫЙ РЕЗУЛЬТАТ' : res.status === 'unsupported' ? 'НЕ ПОМЕЩАЕТСЯ В ОДИН ПАК' : 'ТРЕБУЮТСЯ УТОЧНЕНИЯ';
    cells.push(vertex('status', html(t), S.status, { x: width - 40 - 230, y: 22, w: 230, h: 24 }));
  }

  const protectedByDecision = state.networks.every((n) => n.trust === 'open') || state.networks.every((n) => n.trust !== 'closed');
  cells.push(
    vertex(
      'seg_open',
      `<b>ОТКРЫТАЯ СЕТЬ</b><br><span style="font-weight:normal;font-size:11px">${html(openName)}</span>`,
      S.segment('#E06733'),
      { x: OPEN_X, y: TOP, w: 320, h: segBottom - TOP },
    ),
  );
  cells.push(
    vertex(
      'seg_closed',
      `<b>ЗАКРЫТЫЙ СЕГМЕНТ</b><br><span style="font-weight:normal;font-size:11px">${html(closedName)}${protectedByDecision && res.assumptions.length ? ' · защищаемая сторона по проектному решению' : ''}</span>`,
      S.segment('#35C4AF'),
      { x: closedX, y: TOP, w: closedRight - closedX, h: segBottom - TOP },
    ),
  );

  for (const s of ['open', 'closed'] as Side[])
    for (const c of cards[s].values())
      cells.push(
        vertex(
          c.id,
          `<b>${html(c.name)}</b>` + (c.note ? `<br><font color="#35C4AF" style="font-size:11px">${html(c.note)}</font>` : ''),
          c.placeholder ? S.placeholderCard : S.card,
          c.box,
          s === 'open' ? 'card_open' : 'card_closed',
        ),
      );

  const fwLabel = res.firewall.existing === true && res.firewall.name ? `МЭ (${res.firewall.name})` : 'МЭ';
  cells.push(vertex('fw', html(fwLabel), S.firewall(firewallImage(fwBottom - fwTop)), { x: fwX, y: fwTop, w: 48, h: fwBottom - fwTop }, 'firewall'));
  if (bothFw)
    cells.push(vertex('fw2', 'МЭ', S.firewall(firewallImage(fwBottom - fwTop)), { x: fw2X, y: fwTop, w: 48, h: fwBottom - fwTop }, 'firewall'));

  cells.push(vertex('sx_label', 'СИНОНИКС', S.sxLabel, { x: sxX, y: sxLabelY, w: 240, h: 24 }));
  cells.push(vertex('sx_box', '', S.sxBox, { x: sxX, y: boxY, w: 240, h: boxH }));
  cells.push(vertex('node_left', 'УЗЕЛ А', S.node, { x: nodeAX, y: nodeY, w: 64, h: nodeH }, 'node_a'));
  cells.push(vertex('core', 'ЯДРО', S.core, { x: coreX, y: nodeY, w: 64, h: nodeH }, 'core'));
  cells.push(vertex('node_right', 'УЗЕЛ В', S.node, { x: nodeBX, y: nodeY, w: 64, h: nodeH }, 'node_b'));

  // --- участки правил
  let eid = 0;
  for (const s of ['open', 'closed'] as Side[]) {
    const m = chans(s);
    for (const a of all(s)) {
      const cx = s === 'open' ? leftZone + a.channel * CHANNEL : rightZone + (m - 1 - a.channel) * CHANNEL;
      const node = s === 'open' ? 'node_left' : 'node_right';
      const cardX = s === 'open' ? 1 : 0;
      const nodeX = s === 'open' ? 0 : 1;
      const fromCard = a.end.sends || !a.end.receives;
      const arrowsKnown = a.end.sends || a.end.receives;
      const start = arrowsKnown && a.end.sends && a.end.receives;
      const endArrow = arrowsKnown;
      const vx = a.channel < 0 ? (s === 'open' ? leftZone : rightZone) : cx;
      const ptsCardFirst: [number, number][] = [
        [vx, a.yCard],
        [vx, a.yNode],
      ];
      const style = fromCard
        ? S.edge(a.color, start, endArrow, [cardX, round(a.fracCard)], [nodeX, round(a.fracNode)])
        : S.edge(a.color, false, endArrow, [nodeX, round(a.fracNode)], [cardX, round(a.fracCard)]);
      cells.push({
        kind: 'edge',
        id: `e${++eid}`,
        style,
        source: fromCard ? a.card.id : node,
        target: fromCard ? node : a.card.id,
        points: fromCard ? ptsCardFirst : [...ptsCardFirst].reverse(),
        ruleId: a.rule.id,
        color: a.color,
      });
      const pw = pillWidth(a.label);
      const px = s === 'open' ? pillLx : closedCardX - 22 - pw;
      cells.push(vertex(`p${eid}`, html(a.label), S.pill, { x: px, y: a.yCard - 9, w: pw, h: 18 }, 'pill'));
    }
  }

  // --- USB: только к Узлу А, мимо МЭ
  if (usb.length) {
    const usbBox = { x: nodeAX + 32 - 55, y: usbY, w: 110, h: 34 };
    cells.push(vertex('usb', 'USB-носитель', S.usb, usbBox, 'usb'));
    usb.forEach((u, k) => {
      const frac = round((k + 1) / (usb.length + 1));
      const inbound = u.dir !== 'out';
      cells.push({
        kind: 'edge',
        id: `e${++eid}`,
        style: S.edge(u.color, u.dir === 'both', true, inbound ? [frac, 0] : [frac, 1], inbound ? [frac, 1] : [frac, 0]),
        source: inbound ? 'usb' : 'node_left',
        target: inbound ? 'node_left' : 'usb',
        points: [],
        ruleId: u.rule.id,
        color: u.color,
      });
      const pw = pillWidth(u.label);
      cells.push(vertex(`p${eid}`, html(u.label), S.pill, { x: usbBox.x + usbBox.w + 8, y: usbY + 8 + k * 22, w: pw, h: 18 }, 'pill'));
    });
  }

  // ---------------------------------------------------------------- 5. легенда под схемой
  let y = segBottom + 16;
  const textW = width - 62 - 40;
  const head =
    res.status === 'preliminary'
      ? `Предварительная оценка: минимум ${res.minRules} ${plural(res.minRules)} Синоникса`
      : res.status === 'needs_clarification'
        ? `Черновик: ${res.rulesCount} ${plural(res.rulesCount)} Синоникса, требуются уточнения`
        : `Правил Синоникса: ${res.rulesCount}`;
  cells.push(vertex('lg_head', html(head), S.legendHead, { x: 40, y, w: width - 80, h: 30 }));
  y += 34;
  res.rules.forEach((r, i) => {
    const text = ruleLine(state, r);
    const h = textHeight(text, textW);
    cells.push(vertex(`lg_m${r.id}`, '', S.legendMark(RULE_COLORS[i % RULE_COLORS.length]), { x: 40, y: y + h / 2 - 6, w: 12, h: 12 }));
    cells.push(vertex(`lg_l${r.id}`, html(text), S.legendLine, { x: 62, y, w: textW, h }));
    y += h;
  });
  const notes = [placementLine(state, res)];
  if (res.status !== 'completed') for (const u of res.unknowns.filter((x) => x.affectsResult)) notes.push(`Не определено: ${u.text}`);
  for (const a of res.assumptions) notes.push(`Проектное решение: ${a.text}`);
  notes.forEach((t, k) => {
    const h = textHeight(t, textW);
    cells.push(vertex(`lg_n${k}`, html(t), S.legendNote, { x: 62, y, w: textW, h }));
    y += h;
  });

  return { cells, width, height: Math.ceil(y + 20) };
}

// ====================================================================== helpers

function assignChannels(list: Attach[]) {
  // Участок «вниз» (слот узла ниже карточки): чем ниже карточка, тем дальше канал от узла.
  // Участок «вверх»: чем ниже карточка, тем ближе канал к узлу. Так вертикали не пересекают горизонтали.
  const down = list.filter((a) => a.yNode > a.yCard + 0.5).sort((a, b) => b.yCard - a.yCard);
  const up = list.filter((a) => a.yNode < a.yCard - 0.5).sort((a, b) => a.yCard - b.yCard);
  down.forEach((a, i) => (a.channel = i));
  up.forEach((a, i) => (a.channel = down.length + i));
  // Прямые участки вертикали не имеют — им достаточно любого канала.
  for (const a of list) if (a.channel < 0) a.channel = 0;
}

function getCard(state: SessionState, map: Map<string, Card>, key: string, r: Rule, end: RuleEnd, side: Side): Card {
  const existing = map.get(key);
  if (existing) return existing;
  let name: string;
  let note = '';
  let placeholder = false;
  if (key === '@users') {
    name = 'Пользователи передачи файлов';
    note = 'вручную по SFTP';
  } else if (key.startsWith('@ph-')) {
    placeholder = true;
    name = r.type === 'data' ? (end.sends && !end.receives ? 'Отправитель не указан' : 'Получатель не указан') : /PUSH|PULL/.test(end.method ?? '') ? 'Хранилище (не названо)' : 'Система не указана';
    note = short(r.description);
  } else {
    const d = state.devices.find((x) => x.id === key);
    name = (d?.name ?? key) + (d?.count && d.count > 1 ? ` ×${d.count}` : '');
    // Короткое пояснение в одну строку; полное описание правила — в легенде под схемой.
    note = d?.note ?? short(r.description.charAt(0).toLowerCase() + r.description.slice(1), 34);
  }
  const card: Card = { id: `card_${side}_${map.size + 1}`, name, note, placeholder, attaches: [], box: { x: 0, y: 0, w: CARD_W, h: 56 } };
  map.set(key, card);
  return card;
}

function sideLabel(r: Rule, end: RuleEnd): string {
  if (r.type === 'data') {
    const proto = typeof r.protocol === 'string' ? r.protocol : null;
    const p = r.timeSync ? (proto ? `NTP, ${proto}` : 'NTP') : (proto ?? 'протокол ?');
    return `${r.id} · ${p}${r.port != null ? ' ' + r.port : ''}`;
  }
  const method = end.method?.replace(/ \/ ?с флешки|с флешки ?\/ /g, '').replace(/^с флешки$/, '');
  return `${r.id} · файлы${method ? ', ' + method : ''}`;
}

function usbLabel(r: Rule, dir: 'in' | 'out' | 'both'): string {
  return `${r.id} · ${dir === 'out' ? 'выгрузка на флешку' : dir === 'both' ? 'флешка ⇄' : 'файлы с флешки'}`;
}

function vertex(id: string, value: string, style: string, box: Box, role?: string): Cell {
  return { kind: 'vertex', id, value, style, box: { ...box }, role };
}

function placeholderDiagram(res: EngineResult): Diagram {
  const text =
    res.questions.length > 0
      ? 'Схема появится после уточнения: нужно определить две сети и защищаемую сторону.'
      : 'Недостаточно данных для схемы.';
  return {
    width: 900,
    height: 160,
    cells: [
      vertex('t1', html('СХЕМА РАЗМЕЩЕНИЯ «СИНОНИКСА»'), S.title, { x: 40, y: 16, w: 700, h: 30 }),
      vertex('t2', html(text), S.subtitle, { x: 40, y: 60, w: 820, h: 40 }),
    ],
  };
}

function netName(state: SessionState, id: string): string {
  return state.networks.find((n) => n.id === id)?.name ?? id;
}

function short(s: string, n = 42): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

function textHeight(text: string, width: number): number {
  const perLine = Math.max(20, Math.floor(width / 6.2));
  const lines = Math.ceil(text.length / perLine);
  return Math.max(26, lines * 15 + 10);
}

function round(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function plural(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'правило';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'правила';
  return 'правил';
}

