// Reading a pay range as typed: "150000", "$150,000" or "150k"; empty is none. Min and max
// entered the wrong way round are swapped rather than refused.

/** One amount as typed; null when empty or unreadable. */
export function parsePay(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const v = Number(t.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(v) || t.replace(/[^0-9]/g, '') === '') return null;
  return /k\s*$/i.test(t) ? v * 1000 : v;
}

/** Min and max as typed, low first. */
export function payRange(lo: string, hi: string): [number | null, number | null] {
  const a = parsePay(lo);
  const b = parsePay(hi);
  return a != null && b != null && a > b ? [b, a] : [a, b];
}
