/** Генерирует .drawio, служебный JSON и страницу предпросмотра для открытых сценариев: npm run examples */
import { mkdirSync, writeFileSync } from 'node:fs';
import { applyOps, emptyState, evaluate, explain, toResultJson } from '@synonyx/core';
import { toDrawio } from '@synonyx/diagram';
import { fixtures as S } from '@synonyx/core';

const out = new URL('../examples/', import.meta.url);
mkdirSync(out, { recursive: true });
const list: Record<string, any> = { F02: S.F02, F07: S.F07, F01: S.F01, F04: S.F04, U01: S.U01, U02a: S.U02a, U02b: S.U02b, BOTH_OPEN: S.BOTH_OPEN };
const previews: string[] = [];
for (const [name, ops] of Object.entries(list)) {
  const state = applyOps(emptyState(), ops).state;
  const res = evaluate(state);
  const xml = toDrawio(state, res);
  writeFileSync(new URL(`${name}.drawio`, out), xml);
  writeFileSync(new URL(`${name}.json`, out), JSON.stringify(toResultJson(state, res, { sessionId: `example-${name}` }), null, 2));
  writeFileSync(new URL(`${name}.txt`, out), explain(state, res));
  previews.push(`<h2>${name} — ${res.status}, правил: ${res.rulesCount}</h2><div class="mxgraph" data-mxgraph='${JSON.stringify({ xml, toolbar: 'zoom layers', nav: true, resize: true, lightbox: false }).replace(/&/g, '&amp;').replace(/'/g, '&#39;')}'></div>`);
}
writeFileSync(
  new URL('preview.html', out),
  `<!doctype html><meta charset="utf-8"><title>Примеры схем</title><style>body{font-family:sans-serif;background:#1d262d;color:#fff;margin:16px}.mxgraph{background:#303E48;margin-bottom:32px;border:1px solid #4A5D6A}</style>${previews.join('')}<script src="https://viewer.diagrams.net/js/viewer-static.min.js"></script>`,
);
console.log('examples →', out.pathname);

// Отдельные страницы по одной схеме в натуральную величину — для визуальной проверки.
for (const name of Object.keys(list)) {
  const state = applyOps(emptyState(), list[name]).state;
  const xml = toDrawio(state, evaluate(state));
  const cfg = JSON.stringify({ xml, zoom: 1, resize: false, toolbar: '', nav: false }).replace(/&/g, '&amp;').replace(/'/g, '&#39;');
  writeFileSync(
    new URL(`view-${name}.html`, out),
    `<!doctype html><meta charset="utf-8"><title>${name}</title><style>body{margin:0;background:#303E48}</style><div class="mxgraph" data-mxgraph='${cfg}'></div><script src="https://viewer.diagrams.net/js/viewer-static.min.js"></script>`,
  );
}
