import { describe, expect, it } from 'vitest';
import {
  QUARTER_HOURS,
  addDays,
  addMonths,
  dateKey,
  joinLocal,
  monthCells,
  parseKey,
  splitLocal,
  timesWith,
  todayKey,
} from '../../src/client/lib/dates';

describe('date picker helpers', () => {
  it('reads and writes plain dates without slipping a day', () => {
    expect(dateKey(2026, 10, 18)).toBe('2026-11-18');
    expect(dateKey(2026, 11, 32)).toBe('2027-01-01');
    expect(parseKey('2026-11-18')).toEqual({ y: 2026, m: 10, d: 18 });
    expect(parseKey('2026-02-30')).toBeNull();
    expect(parseKey('')).toBeNull();
    expect(todayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('moves by days and months', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('lays a month out from Sunday', () => {
    const nov = monthCells(2026, 10); // Nov 1, 2026 is a Sunday
    expect(nov[0]).toBe(1);
    expect(nov).toHaveLength(30);
    const dec = monthCells(2026, 11); // Dec 1, 2026 is a Tuesday
    expect(dec.slice(0, 3)).toEqual([null, null, 1]);
  });

  it('splits and joins datetime-local values', () => {
    expect(splitLocal('2026-11-18T14:30')).toEqual({ date: '2026-11-18', time: '14:30' });
    expect(splitLocal('')).toEqual({ date: '', time: '' });
    expect(joinLocal('2026-11-18', '09:15')).toBe('2026-11-18T09:15');
    expect(joinLocal('2026-11-18', '')).toBe('2026-11-18T00:00');
    expect(joinLocal('', '09:15')).toBe('');
  });

  it('lists quarter hours, plus an odd time when one is set', () => {
    expect(QUARTER_HOURS).toHaveLength(96);
    expect(QUARTER_HOURS[37]).toBe('09:15');
    expect(timesWith('09:15')).toBe(QUARTER_HOURS);
    const odd = timesWith('09:07');
    expect(odd).toHaveLength(97);
    expect(odd[odd.indexOf('09:07') - 1]).toBe('09:00');
  });
});
