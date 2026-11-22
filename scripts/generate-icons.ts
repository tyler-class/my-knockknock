// Renders the app icons in public/ from the Knock Knock 1.0 mark: the white asterisk (three
// square-ended bars, turned 14° off true) on an ultramarine tile tilted -8°, as in the sidebar.
// The favicon is the tile alone on transparency; the installed-app icons set it on the page grey.
// Run: npm run icons
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const ACCENT = '#2b3fd0';
const PAGE = '#ebedf1';
// The asterisk on a 100-unit grid: bars 24 wide, 92 long (as the in-app Asterisk draws it).
const bar = '<rect x="38" y="4" width="24" height="92"/>';
const asterisk = `<g fill="#ffffff" transform="rotate(14 50 50)">${bar}<g transform="rotate(60 50 50)">${bar}</g><g transform="rotate(120 50 50)">${bar}</g></g>`;

/**
 * The tilted tile, `tile` units wide, centred on a 100-unit canvas, with the asterisk at about
 * 56% of the tile. `bg` fills the canvas behind it (none for the favicon).
 */
function svg(tile: number, bg: string | null): string {
  const o = (100 - tile) / 2;
  const glyph = tile * 0.56;
  const g = (100 - glyph) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${
    bg ? `<rect width="100" height="100" fill="${bg}"/>` : ''
  }<g transform="rotate(-8 50 50)"><rect x="${o}" y="${o}" width="${tile}" height="${tile}" rx="${
    tile * 0.3
  }" fill="${ACCENT}"/><g transform="translate(${g} ${g}) scale(${glyph / 100})">${asterisk}</g></g></svg>`;
}

const out = new URL('../public/', import.meta.url);
writeFileSync(new URL('favicon.svg', out), svg(88, null));
const jobs: [string, number, number][] = [
  ['pwa-192x192.png', 192, 70],
  ['pwa-512x512.png', 512, 70],
  ['maskable-512x512.png', 512, 56], // keeps the tile inside the maskable safe zone
  ['apple-touch-icon.png', 180, 68],
];
for (const [name, size, tile] of jobs) {
  const png = await sharp(Buffer.from(svg(tile, PAGE)))
    .resize(size, size)
    .png()
    .toBuffer();
  writeFileSync(new URL(name, out), png);
  console.log(`public/${name}`);
}
