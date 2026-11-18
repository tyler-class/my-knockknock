import { describe, expect, it } from 'vitest';
import { buildReport } from '@shared/logic/report';
import { dueNotices } from '@shared/logic/notify';
import type { AppState } from '@shared/types';
import { app, created, ev, st } from './fixtures';

describe('report', () => {
  it('counts each application once per stage reached, and where they ended', () => {
    const apps = [
      app({ id: 'a', status: 'rejected', source: 'LinkedIn' }),
      app({ id: 'b', status: 'interviewing', source: 'Referral' }),
      app({ id: 'c', status: 'ghosted', source: 'LinkedIn' }),
      app({ id: 'd', status: 'saved' }),
    ];
    const on = (id: string) => ({ application_id: id });
    const events = [
      created('applied', '2026-11-02T10:00:00Z', on('a')),
      st('screening', '2026-11-06T10:00:00Z', 'applied', on('a')),
      st('rejected', '2026-11-09T10:00:00Z', 'screening', on('a')),
      created('applied', '2026-11-03T10:00:00Z', on('b')),
      ev('email', '2026-11-05T10:00:00Z', { direction: 'in', category: 'scheduling' }, on('b')),
      st('interviewing', '2026-11-07T10:00:00Z', 'applied', on('b')),
      created('saved', '2026-11-01T10:00:00Z', on('c')),
      st('applied', '2026-11-02T10:00:00Z', 'saved', on('c')),
      st('ghosted', '2026-12-10T10:00:00Z', 'applied', on('c')),
      created('saved', '2026-11-04T10:00:00Z', on('d')),
    ];
    const r = buildReport(apps, events, [], 4, new Date('2026-11-12T12:00:00Z'));
    expect([r.sent, r.saved, r.responded, r.interviewed, r.rejected, r.ghosted, r.open]).toEqual([
      3, 1, 2, 1, 1, 1, 1,
    ]);
    expect(r.responseRate).toBeCloseTo(2 / 3);
    // a: 4 days; b: 2 days (the scheduling email).
    expect(r.medianReplyDays).toBe(3);
    const link = (from: string, to: string) =>
      r.links.find((l) => l.from === from && l.to === to)?.n;
    expect(link('applied', 'screening')).toBe(2);
    expect(link('screening', 'interviewing')).toBe(1);
    expect(link('screening', 'rejected@screening')).toBe(1);
    expect(link('applied', 'ghosted@applied')).toBe(1);
    expect(link('interviewing', 'open@interviewing')).toBe(1);
    expect(r.bySource.find((s) => s.name === 'LinkedIn')).toMatchObject({ n: 2, responded: 1 });
    expect(r.perWeek.map((w) => w.n)).toEqual([0, 0, 3, 0]);
  });
});

describe('notifications', () => {
  it('interview today, follow up, debrief', () => {
    const now = new Date('2026-11-14T13:41:00Z'); // 8:41 in New York
    const state = {
      settings: {
        time_zone: 'America/New_York',
        current_search_id: null,
        follow_up_days: 10,
        ghost_days: 30,
        telemetry: false,
        updates_set_up: false,
      },
      searches: [],
      applications: [
        app({
          id: 'a1',
          company: 'Fathom',
          status: 'interviewing',
          last_activity_at: '2026-11-13T10:00:00Z',
        }),
        app({
          id: 'a2',
          company: 'Copperleaf',
          status: 'applied',
          last_activity_at: '2026-11-01T10:00:00Z',
        }),
      ],
      people: [],
      events: [
        ev(
          'meeting',
          '2026-11-14T19:00:00Z',
          { kind: 'panel', state: 'scheduled', ends_at: null, attendees: [] },
          { id: 'm1', title: 'Panel interview' },
        ),
        ev(
          'meeting',
          '2026-11-13T15:00:00Z',
          { kind: 'hiring_manager', state: 'held', ends_at: '2026-11-13T15:45:00Z', attendees: [] },
          { id: 'm0', title: 'Hiring manager' },
        ),
      ],
      frameworks: [],
      stories: [],
      job_stories: [],
      files: [],
    } as unknown as AppState;
    const n = dueNotices(state, now, 'America/New_York');
    expect(n.map((x) => `${x.kind}|${x.title}|${x.body}|${x.url}`)).toEqual([
      'interviews|Interview today: Fathom|Panel interview at 2:00 PM. Your stories are ready in Call Mode.|/a/a1',
      'follow_up|Time to follow up|Copperleaf has been quiet for 13 days. Knock again?|/a/a2',
      "debrief|How did it go at Fathom?|Write down what they asked about in the hiring manager while it's fresh.|/a/a1",
    ]);
  });
});
