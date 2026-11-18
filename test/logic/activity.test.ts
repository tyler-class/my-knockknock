import { describe, expect, it } from 'vitest';
import { activityLabel, interviewsThisWeek } from '@shared/logic/activity';
import { created, ev, st } from './fixtures';

const NOW = new Date('2026-11-18T15:00:00Z');
const meeting = (at: string, state = 'scheduled', extra = {}) =>
  ev(
    'meeting',
    at,
    {
      kind: 'recruiter_screen',
      state,
      ends_at: null,
      timezone: null,
      join_url: null,
      location: null,
      attendees: [],
      agenda: null,
    },
    extra,
  );

describe('interviews this week', () => {
  it('counts scheduled meetings from now through 7 days, soonest first', () => {
    const later = meeting('2026-11-24T16:00:00Z');
    const soon = meeting('2026-11-19T16:00:00Z');
    const list = interviewsThisWeek(
      [
        later,
        meeting('2026-11-18T14:00:00Z'), // already started
        meeting('2026-11-26T16:00:00Z'), // more than a week out
        meeting('2026-11-20T16:00:00Z', 'canceled'),
        ev('note', '2026-11-19T10:00:00Z'),
        soon,
      ],
      NOW,
    );
    expect(list.map((e) => e.id)).toEqual([soon.id, later.id]);
  });
});

describe('activity label', () => {
  it('names each kind of entry and gives a line of what it says', () => {
    expect(
      activityLabel(ev('note', NOW.toISOString(), {}, { body: '\n During the call\nmore' })),
    ).toEqual({ icon: 'note', kind: 'Note', snippet: 'During the call' });
    expect(activityLabel(ev('email', NOW.toISOString(), { subject: 'Next steps' }))).toEqual({
      icon: 'email',
      kind: 'Email',
      snippet: 'Next steps',
    });
    expect(
      activityLabel(meeting(NOW.toISOString(), 'held', { title: 'Recruiter screen' })),
    ).toEqual({ icon: 'meeting', kind: 'Meeting: Recruiter screen', snippet: null });
    expect(activityLabel(st('screening', NOW.toISOString(), 'applied'))).toEqual({
      icon: 'status',
      kind: 'Status: Applied → Screening',
      snippet: null,
    });
    expect(activityLabel(created('saved', NOW.toISOString())).kind).toBe('Created');
    expect(
      activityLabel(ev('note', NOW.toISOString(), { file_id: 'f1' }, { title: 'resume.pdf' })),
    ).toEqual({ icon: 'file', kind: 'File added', snippet: 'resume.pdf' });
  });
});
