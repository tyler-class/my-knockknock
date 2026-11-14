import type { Application } from '@shared/types';

const short = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function money(n: number, currency: string | null): string {
  const sym =
    !currency || currency === 'USD'
      ? '$'
      : currency === 'EUR'
        ? '€'
        : currency === 'GBP'
          ? '£'
          : `${currency} `;
  if (n >= 1000) return `${sym}${short.format(Math.round(n / 1000))}k`;
  return `${sym}${short.format(n)}`;
}

/** "$215–250k", "$95/hr", or the posting's own words. Null when unknown. */
export function compLabel(
  a: Pick<
    Application,
    'salary_min' | 'salary_max' | 'salary_currency' | 'salary_period' | 'salary_text'
  >,
): string | null {
  const { salary_min: lo, salary_max: hi } = a;
  if (lo == null && hi == null) return a.salary_text;
  const per = a.salary_period === 'hour' ? '/hr' : a.salary_period === 'month' ? '/mo' : '';
  if (lo != null && hi != null && lo !== hi) {
    const a1 = money(lo, a.salary_currency);
    const b1 = money(hi, a.salary_currency);
    // "$215k–$250k" → "$215–250k"
    const same = a1.endsWith('k') && b1.endsWith('k') && a1[0] === b1[0];
    return `${same ? a1.slice(0, -1) : a1}–${same ? b1.slice(1) : b1}${per}`;
  }
  return `${money((lo ?? hi)!, a.salary_currency)}${per}`;
}

export const ellipsis = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dayYearFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const wdFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

/** "Nov 14" (with the year when it isn't this year). */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() ? dayFmt.format(d) : dayYearFmt.format(d);
}

/** "Thu Nov 14 · 2:00 PM" */
export function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return `${wdFmt.format(d)} ${dayLabel(iso, now)} · ${timeFmt.format(d)}`;
}

export const timeLabel = (iso: string) => timeFmt.format(new Date(iso));

/** "in 2 days", "today", "3d ago" */
export function relDays(iso: string, now = new Date()): string {
  const a = new Date(iso);
  const d = Math.round(
    (Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      86_400_000,
  );
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d}d ago`;
}

export const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`);

export const bytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Value for <input type="datetime-local"> in this device's time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A datetime-local value as an ISO instant; null if blank or bad. */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
