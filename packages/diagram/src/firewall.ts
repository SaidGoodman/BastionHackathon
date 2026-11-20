/** Значок МЭ из 06_template.drawio: кирпичная стена с огоньком, высота подстраивается под схему. */
export function firewallSvg(height: number): string {
  const h = Math.max(120, Math.round(height));
  const parts: string[] = [];
  parts.push(`<rect x="1" y="1" width="46" height="${h - 2}" rx="6" fill="#354552" stroke="#FFAB4D" stroke-width="2"/>`);
  let row = 0;
  for (let y = 58; y < h - 2; y += 18, row++) {
    const y2 = Math.min(y + 18, h - 2);
    parts.push(`<line x1="2" y1="${y}" x2="46" y2="${y}" stroke="#FFAB4D" stroke-width="1.5"/>`);
    const xs = row % 2 === 0 ? [24] : [12, 36];
    for (const x of xs) parts.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${y2}" stroke="#FFAB4D" stroke-width="1.5"/>`);
  }
  parts.push(
    '<path transform="translate(24,30)" d="M0,-20 C7,-10 13,-4 13,5 C13,13 7,19 0,19 C-7,19 -13,13 -13,5 C-13,0 -10,-4 -7,-8 C-6,-4 -4,-2 -2,-2 C-4,-8 -3,-14 0,-20 Z" fill="#E06733"/>',
    '<path transform="translate(24,35)" d="M0,-9 C4,-4 6,-1 6,3 C6,8 3,11 0,11 C-3,11 -6,8 -6,3 C-6,0 -3,-4 0,-9 Z" fill="#FFAB4D"/>',
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="${h}" viewBox="0 0 48 ${h}">${parts.join('')}</svg>`;
}

/** data-URI в формате draw.io: без «;base64», потому что «;» разделяет ключи стиля. */
export function firewallImage(height: number): string {
  const svg = firewallSvg(height);
  const b64 = typeof btoa === 'function' ? btoa(svg) : Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml,${b64}`;
}
