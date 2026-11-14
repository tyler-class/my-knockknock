// Renders the app icons in public/ from the Knock Knock asterisk: six square-ended bars,
// turned 14° off true so it reads a little off-kilter. White on ink.
// Run: npm run icons
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const BG = '#0b0b0b';
const bar = '<rect x="27" y="8" width="10" height="48"/>';
// The glyph on a 64-unit grid, without the tile.
const glyph = `<g fill="#ffffff" transform="rotate(14 32 32)">${bar}<g transform="rotate(60 32 32)">${bar}</g><g transform="rotate(120 32 32)">${bar}</g></g>`;

/** Full-bleed square with the glyph scaled into the middle `scale` of the tile. */
function svg(scale: number, rx = 0): string {
  const offset = (64 - 64 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${rx}" fill="${BG}"/><g transform="translate(${offset} ${offset}) scale(${scale})">${glyph}</g></svg>`;
}

const out = new URL('../public/', import.meta.url);
writeFileSync(new URL('favicon.svg', out), svg(1, 14));
const jobs: [string, number, number][] = [
  ['pwa-192x192.png', 192, 1],
  ['pwa-512x512.png', 512, 1],
  ['maskable-512x512.png', 512, 0.72], // keeps the glyph inside the maskable safe zone
  ['apple-touch-icon.png', 180, 0.92],
];
for (const [name, size, scale] of jobs) {
  const png = await sharp(Buffer.from(svg(scale)))
    .resize(size, size)
    .png()
    .toBuffer();
  writeFileSync(new URL(name, out), png);
  console.log(`public/${name}`);
}
