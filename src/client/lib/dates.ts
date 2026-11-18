// Plain-date helpers for the date and time pickers. Dates are 'YYYY-MM-DD' keys and times
// 'HH:MM', both in this device's time; nothing here goes through UTC, so a date never slips a day.

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for a year, a 0-based month and a day (any overflow rolls over). */
export function dateKey(y: number, m: number, d: number): string {
  const t = new Date(y, m, d);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/** A 'YYYY-MM-DD' key as year, 0-based month and day; null if it isn't one. */
export function parseKey(k: string | null | undefined): { y: number; m: number; d: number } | null {
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k ?? '');
  if (!hit) return null;
  const [y, m, d] = [Number(hit[1]), Number(hit[2]) - 1, Number(hit[3])];
  const t = new Date(y, m, d);
  return t.getMonth() === m && t.getDate() === d ? { y, m, d } : null;
}

export const todayKey = (now = new Date()) =>
  dateKey(now.getFullYear(), now.getMonth(), now.getDate());

/** The key `n` days later (or earlier). */
export function addDays(k: string, n: number): string {
  const p = parseKey(k)!;
  return dateKey(p.y, p.m, p.d + n);
}

/** The same day `n` months on, kept inside the month (Jan 31 + 1 → Feb 28). */
export function addMonths(k: string, n: number): string {
  const p = parseKey(k)!;
  const last = new Date(p.y, p.m + n + 1, 0).getDate();
  return dateKey(p.y, p.m + n, Math.min(p.d, last));
}

/** A month's calendar cells, Sunday first: null for the blanks before the 1st. */
export function monthCells(y: number, m: number): (number | null)[] {
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  return [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
}

/** 'YYYY-MM-DDTHH:MM' as its date and time ('' for either part that's missing). */
export function splitLocal(v: string): { date: string; time: string } {
  const [date = '', time = ''] = v.split('T');
  return {
    date: parseKey(date) ? date : '',
    time: /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : '',
  };
}

/** A date and time back as 'YYYY-MM-DDTHH:MM'; '' without a date. */
export const joinLocal = (date: string, time: string) => (date ? `${date}T${time || '00:00'}` : '');

/** "Tue, Nov 18" (with the year when it isn't this year). */
export function dateKeyLabel(k: string, now = new Date()): string {
  const p = parseKey(k);
  if (!p) return k;
  return new Date(p.y, p.m, p.d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(p.y !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** "Nov 18" (with the year when it isn't this year), for a stored 'YYYY-MM-DD'. */
export function shortDateLabel(k: string, now = new Date()): string {
  const p = parseKey(k);
  if (!p) return k;
  return new Date(p.y, p.m, p.d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(p.y !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** "14:30" → "2:30 PM". */
export function clockLabel(t: string): string {
  const [h = 0, m = 0] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Every quarter hour of the day, 'HH:MM'. */
export const QUARTER_HOURS = Array.from(
  { length: 96 },
  (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`,
);

/** The time list for a value: the quarter hours, plus the value itself if it falls between. */
export const timesWith = (v: string) =>
  v && !QUARTER_HOURS.includes(v) ? [...QUARTER_HOURS, v].sort() : QUARTER_HOURS;
