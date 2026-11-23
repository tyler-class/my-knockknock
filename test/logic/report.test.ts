import { describe, expect, it } from 'vitest';
import { buildReport, heardBack, heardBackAt, median } from '@shared/logic/report';
import { dueNotices } from '@shared/logic/notify';
import type { AppState, FileRef } from '@shared/types';
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
    expect([r.sent, r.saved, r.heardBack, r.interviewed, r.rejected, r.ghosted, r.open]).toEqual([
      3, 1, 2, 1, 1, 1, 1,
    ]);
    expect(r.heardBackRate).toBeCloseTo(2 / 3);
    // a: 4 days (to Screening); b: 4 days (to Interviewing; the email alone doesn't count).
    expect(r.medianDaysToHear).toBe(4);
    expect(r.replies).toBe(2);
    const link = (from: string, to: string) =>
      r.links.find((l) => l.from === from && l.to === to)?.n;
    expect(link('applied', 'screening')).toBe(2);
    expect(link('screening', 'interviewing')).toBe(1);
    expect(link('screening', 'rejected@screening')).toBe(1);
    expect(link('applied', 'ghosted@applied')).toBe(1);
    // Still interviewing: the flow stops there, with no "still at" branch.
    expect(link('interviewing', 'open@interviewing')).toBeUndefined();
    expect(r.nodes.some((n) => n.kind === 'open')).toBe(false);
    expect(r.bySource).toEqual([
      { name: 'LinkedIn', applied: 2, heardBack: 1, rate: 0.5 },
      { name: 'Referral', applied: 1, heardBack: 1, rate: 1 },
    ]);
    expect(r.perWeek.map((w) => w.n)).toEqual([0, 0, 3, 0]);
  });
});

describe('heard back', () => {
  const on = { application_id: 'x' };
  it('means past Applied, or a rejection; not silence, ghosting or withdrawing', () => {
    const applied = created('applied', '2026-11-02T10:00:00Z', on);
    expect(heardBack([applied])).toBe(false);
    expect(heardBack([applied, st('ghosted', '2026-12-02T10:00:00Z', 'applied', on)])).toBe(false);
    expect(heardBack([applied, st('declined', '2026-11-04T10:00:00Z', 'applied', on)])).toBe(false);
    expect(
      heardBack([
        applied,
        ev('email', '2026-11-03T10:00:00Z', { direction: 'in', category: 'scheduling' }, on),
      ]),
    ).toBe(false);
    expect(heardBack([applied, st('rejected', '2026-11-05T10:00:00Z', 'applied', on)])).toBe(true);
    expect(heardBack([applied, st('screening', '2026-11-05T10:00:00Z', 'applied', on)])).toBe(true);
  });
  it('is dated by the first status change past Applied', () => {
    const evs = [
      created('saved', '2026-11-01T10:00:00Z', on),
      st('applied', '2026-11-02T10:00:00Z', 'saved', on),
      st('interviewing', '2026-11-09T10:00:00Z', 'screening', on),
      st('screening', '2026-11-06T10:00:00Z', 'applied', on),
    ];
    expect(heardBackAt(evs)).toBe('2026-11-06T10:00:00Z');
    expect(heardBackAt([created('applied', '2026-11-02T10:00:00Z', on)])).toBeNull();
  });
  it('median', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});

describe('report breakdowns and empty states', () => {
  const NOW = new Date('2026-11-12T12:00:00Z');
  const sent = (id: string, o: Parameters<typeof app>[0], heard: boolean, day = 2) => ({
    app: app({ id, ...o }),
    events: [
      created('applied', `2026-11-0${day}T10:00:00Z`, { application_id: id }),
      ...(heard
        ? [st('screening', '2026-11-08T10:00:00Z', 'applied', { application_id: id })]
        : []),
    ],
  });
  const build = (rows: ReturnType<typeof sent>[], files: FileRef[] = []) =>
    buildReport(
      rows.map((x) => x.app),
      rows.flatMap((x) => x.events),
      files,
      4,
      NOW,
    );
  const file = (id: string, label: string) => ({ id, label, filename: `${label}.pdf` }) as FileRef;

  it('nothing sent: no rates, no median, no rows', () => {
    const r = build([]);
    expect([r.sent, r.heardBack, r.heardBackRate, r.medianDaysToHear, r.replies]).toEqual([
      0,
      0,
      null,
      null,
      0,
    ]);
    expect(r.bySource).toEqual([]);
    expect(r.byResume).toEqual([]);
  });
  it('one reply is not enough for a median time', () => {
    const r = build([sent('a', {}, true), sent('b', {}, false)]);
    expect(r.replies).toBe(1);
    expect(r.medianDaysToHear).toBeNull();
  });
  it('sources: no source reads "Not set"; most applications first', () => {
    const r = build([
      sent('a', { source: 'LinkedIn' }, true),
      sent('b', { source: null }, false),
      sent('c', { source: 'LinkedIn' }, false),
    ]);
    expect(r.bySource.map((b) => [b.name, b.heardBack, b.applied])).toEqual([
      ['LinkedIn', 1, 2],
      ['Not set', 0, 1],
    ]);
  });
  it('resumes: hidden with one resume, shown with two', () => {
    const files = [file('r1', 'Resume A'), file('r2', 'Resume B')];
    expect(
      build(
        [sent('a', { resume_file_id: 'r1' }, true), sent('b', { resume_file_id: null }, false)],
        files,
      ).byResume,
    ).toEqual([]);
    const r = build(
      [
        sent('a', { resume_file_id: 'r1' }, true),
        sent('b', { resume_file_id: 'r2' }, false),
        sent('c', { resume_file_id: 'r1' }, false),
      ],
      files,
    );
    expect(r.byResume.map((b) => [b.name, b.heardBack, b.applied])).toEqual([
      ['Resume A', 1, 2],
      ['Resume B', 0, 1],
    ]);
  });
});

describe('notifications', () => {
  it('interview today, follow up, debrief', () => {
    const now = new Date('2026-11-14T13:41:00Z'); // 8:41 in New York
    const state = {
      settings: {
        time_zone: 'America/New_York',
        current_round_id: null,
        follow_up_days: 10,
        ghost_days: 30,
        telemetry: false,
        updates_set_up: false,
      },
      rounds: [],
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
