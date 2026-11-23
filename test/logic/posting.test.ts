import { describe, expect, it } from 'vitest';
import { fromPageData, htmlToText } from '../../src/worker/posting';

describe('reading a posting page', () => {
  it('takes the JobPosting a page carries for Google Jobs', () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'Acme' },
        {
          '@type': 'JobPosting',
          title: 'Staff Engineer',
          hiringOrganization: { name: 'Acme' },
          datePosted: '2026-11-01T00:00:00Z',
          employmentType: ['FULL_TIME'],
          jobLocationType: 'TELECOMMUTE',
          jobLocation: { address: { addressLocality: 'Austin', addressRegion: 'TX' } },
          baseSalary: {
            currency: 'USD',
            value: { minValue: 180000, maxValue: 220000, unitText: 'YEAR' },
          },
          description:
            '&lt;p&gt;Build things.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;li&gt;Rust&lt;/li&gt;&lt;/ul&gt;',
        },
      ],
    })}</script></head><body></body></html>`;
    expect(fromPageData(html, 'https://acme.example/jobs/1')).toEqual({
      source: 'page-data',
      url: 'https://acme.example/jobs/1',
      title: 'Staff Engineer',
      company: 'Acme',
      location: 'Austin, TX',
      work_mode: 'Remote',
      employment_type: 'FULL_TIME',
      pay: 'USD 180000–220000 YEAR',
      posted_on: '2026-11-01',
      description: 'Build things.\n\n- Go\n- Rust',
    });
  });

  it('finds nothing on a page without one', () => {
    expect(fromPageData('<html><body><h1>Hi</h1></body></html>', 'https://x.example')).toBeNull();
  });

  it('turns HTML into readable text', () => {
    expect(htmlToText('<h2>About</h2><p>We &amp; you&nbsp;build.</p><script>x()</script>')).toBe(
      'About\n\nWe & you build.',
    );
  });
});
