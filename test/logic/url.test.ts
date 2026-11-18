import { describe, expect, it } from 'vitest';
import { personInput, withScheme } from '@shared/schemas';

describe('links', () => {
  it('takes a link without a scheme as https', () => {
    expect(withScheme('acme.com')).toBe('https://acme.com');
    expect(withScheme('www.acme.com/jobs')).toBe('https://www.acme.com/jobs');
    expect(withScheme('https://acme.com')).toBe('https://acme.com');
    expect(withScheme('http://acme.com')).toBe('http://acme.com');
  });

  it('accepts url.com, www.url.com and https://www.url.com alike', () => {
    for (const raw of ['url.com', 'www.url.com', 'https://www.url.com'])
      expect(personInput.parse({ name: 'Sam', linkedin: raw }).linkedin).toMatch(/^https:\/\//);
    expect(personInput.safeParse({ name: 'Sam', linkedin: 'not a link' }).success).toBe(false);
  });
});
