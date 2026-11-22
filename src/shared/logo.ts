// A company without an uploaded logo shows a monogram: the first letter of its name's first
// meaningful word, white on a tile. The tile is the app's ultramarine unless the owner picks one
// of a few other colors (each dark enough for white text).

export const LOGO_COLORS = [
  { key: 'ultramarine', label: 'Ultramarine', hex: '#2b3fd0' },
  { key: 'violet', label: 'Violet', hex: '#5b3cc4' },
  { key: 'plum', label: 'Plum', hex: '#8a2f86' },
  { key: 'rose', label: 'Rose', hex: '#b4235a' },
  { key: 'red', label: 'Red', hex: '#b42318' },
  { key: 'orange', label: 'Orange', hex: '#b54708' },
  { key: 'gold', label: 'Gold', hex: '#8a6100' },
  { key: 'green', label: 'Green', hex: '#1f7a4d' },
  { key: 'teal', label: 'Teal', hex: '#0e7171' },
  { key: 'slate', label: 'Slate', hex: '#3f4756' },
] as const;
export type LogoColor = (typeof LOGO_COLORS)[number]['key'];
export const LOGO_COLOR_KEYS = LOGO_COLORS.map((c) => c.key) as [LogoColor, ...LogoColor[]];
export const DEFAULT_LOGO_COLOR: LogoColor = 'ultramarine';

/** The tile color for a stored key; unknown or unset keys are the default. */
export function logoColor(key: string | null | undefined) {
  return LOGO_COLORS.find((c) => c.key === key) ?? LOGO_COLORS[0];
}

/** Articles a name can start with that don't say which company it is ("The", "A", "Le", "Die"…). */
const ARTICLES = new Set([
  'the',
  'a',
  'an',
  'le',
  'la',
  'les',
  'el',
  'los',
  'las',
  'il',
  'lo',
  'gli',
  'die',
  'der',
  'das',
]);

/**
 * The letter on a company's monogram: the first letter or digit of its first word that isn't an
 * article ("The Copperleaf Group" → C, "A16z" → A, "l'Atelier" → A). A name made only of
 * articles keeps its own first letter.
 */
export function monogram(name: string): string {
  const words = name
    .trim()
    .split(/[\s\-–—/&+.,:;()]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean);
  const meaningful = words.find((w, i) => !(ARTICLES.has(w.toLowerCase()) && i < words.length - 1));
  const word = (meaningful ?? words[0] ?? '').replace(/^(l|d)['’](?=\p{L})/iu, '');
  const ch = word.match(/[\p{L}\p{N}]/u)?.[0];
  return ch ? ch.toLocaleUpperCase() : '?';
}
