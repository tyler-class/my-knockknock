import { describe, expect, it } from 'vitest';
import { parsePay, payRange } from '@shared/logic/pay';

describe('pay as typed', () => {
  it('reads plain, formatted and "k" amounts', () => {
    expect(parsePay('150000')).toBe(150000);
    expect(parsePay('$150,000')).toBe(150000);
    expect(parsePay('150k')).toBe(150000);
    expect(parsePay(' 72.5 ')).toBe(72.5);
    expect(parsePay('')).toBeNull();
    expect(parsePay('abc')).toBeNull();
  });
  it('swaps a range entered backwards and allows either end alone', () => {
    expect(payRange('180k', '150k')).toEqual([150000, 180000]);
    expect(payRange('150k', '')).toEqual([150000, null]);
    expect(payRange('', '')).toEqual([null, null]);
  });
});
