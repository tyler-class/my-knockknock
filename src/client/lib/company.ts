import type { Company } from '@shared/types';

const groupThousands = (s: string) =>
  s.replace(/\d[\d,]*/g, (n) => Number(n.replace(/,/g, '')).toLocaleString('en-US'));

/** "Lisbon · 1,200 people · Logistics": what's known, in a line. */
export function companyFacts(c: Company): string {
  return [c.hq, c.size ? `${groupThousands(c.size)} people` : null, c.industry]
    .filter(Boolean)
    .join(' · ');
}
