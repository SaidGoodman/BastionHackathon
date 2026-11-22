/** Обозначение МЭ: кирпичная стена, высота подстраивается под схему. */
export function firewallSvg(height: number): string {
  const h = Math.max(120, Math.round(height));
  const parts: string[] = [];
  parts.push(`<rect x="1" y="1" width="46" height="${h - 2}" rx="6" fill="#FFFFFF" stroke="#111111" stroke-width="2"/>`);
  let row = 0;
  for (let y = 18; y < h - 2; y += 18, row++) {
    const y2 = Math.min(y + 18, h - 2);
    parts.push(`<line x1="2" y1="${y}" x2="46" y2="${y}" stroke="#111111" stroke-width="1.5"/>`);
    const xs = row % 2 === 0 ? [24] : [12, 36];
    for (const x of xs) parts.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${y2}" stroke="#111111" stroke-width="1.5"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="${h}" viewBox="0 0 48 ${h}">${parts.join('')}</svg>`;
}

/** data-URI в формате draw.io: без «;base64», потому что «;» разделяет ключи стиля. */
export function firewallImage(height: number): string {
  const svg = firewallSvg(height);
  const b64 = typeof btoa === 'function' ? btoa(svg) : Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml,${b64}`;
}
