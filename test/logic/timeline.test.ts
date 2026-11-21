import { describe, expect, it } from 'vitest';
import {
  ghostCandidate,
  lastActivity,
  nearby,
  needsDebrief,
  needsFollowUp,
  timelineView,
} from '@shared/logic/timeline';
import { app, created, ev } from './fixtures';

const NOW = new Date('2026-11-12T15:00:00Z');
const meeting = (at: string, state = 'scheduled', extra = {}) =>
  ev(
    'meeting',
    at,
    {
      kind: 'panel',
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

describe('timeline view', () => {
  it('nests a loose note under the meeting it was written during, and leaves others alone', () => {
    const call = meeting('2026-11-10T18:00:00Z', 'held', {});
    const during = ev('note', '2026-11-10T18:20:00Z', {}, { body: 'call notes' });
    const after = ev('note', '2026-11-10T20:00:00Z', {}, { body: 'later thought' });
    const file = ev('note', '2026-11-10T18:10:00Z', { file_id: 'f1' }, { body: 'resume' });
    const v = timelineView([call, during, after, file], NOW);
    expect(v.children.get(call.id)?.map((n) => n.id)).toEqual([during.id]);
    expect(v.past.map((e) => e.id)).toEqual([after.id, file.id, call.id]);
  });
  it('puts upcoming meetings above now, the rest newest first, and notes under their event', () => {
    const past = meeting('2026-10-30T18:00:00Z', 'held');
    const next = meeting('2026-11-14T19:00:00Z');
    const later = meeting('2026-11-20T19:00:00Z');
    const note = ev('note', '2026-10-30T19:30:00Z', {}, { parent_id: past.id, body: 'debrief' });
    const email = ev('email', '2026-11-08T16:00:00Z', { direction: 'in' });
    const v = timelineView(
      [later, past, note, email, created('applied', '2026-10-14T10:00:00Z'), next],
      NOW,
    );
    expect(v.upcoming.map((e) => e.id)).toEqual([next.id, later.id]);
    expect(v.past.map((e) => e.type)).toEqual(['email', 'meeting', 'created']);
    expect(v.children.get(past.id)!.map((e) => e.body)).toEqual(['debrief']);
  });

  it('finds what is near a time, nearest first, optionally by type', () => {
    const a = ev('email', '2026-11-03T10:00:00Z');
    const b = ev('email', '2026-11-05T10:00:00Z');
    const c = ev('note', '2026-11-03T11:00:00Z');
    const far = ev('email', '2026-10-01T10:00:00Z');
    expect(nearby([far, b, a, c], '2026-11-03T10:30:00Z', 3).map((e) => e.id)).toEqual([
      a.id,
      c.id,
      b.id,
    ]);
    expect(nearby([far, b, a, c], '2026-11-03T10:30:00Z', 3, ['email']).map((e) => e.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  it('counts only what has happened as activity', () => {
    const events = [ev('email', '2026-11-01T10:00:00Z'), meeting('2026-12-01T10:00:00Z')];
    expect(lastActivity(events, '2026-10-01T00:00:00Z', NOW)).toBe('2026-11-01T10:00:00Z');
  });
});

describe('what needs attention', () => {
  const s = { follow_up_days: 10, ghost_days: 30 };
  it('follow up: waiting on them, quiet long enough, nothing scheduled', () => {
    const quiet = app({ status: 'applied', last_activity_at: '2026-10-30T10:00:00Z' });
    expect(needsFollowUp(quiet, [], s, NOW)).toBe(true);
    expect(needsFollowUp({ ...quiet, status: 'saved' }, [], s, NOW)).toBe(false);
    expect(needsFollowUp({ ...quiet, last_activity_at: '2026-11-10T10:00:00Z' }, [], s, NOW)).toBe(
      false,
    );
    expect(needsFollowUp(quiet, [meeting('2026-11-20T10:00:00Z')], s, NOW)).toBe(false);
  });

  it('ghosted is only suggested for applied or screening after ghost_days', () => {
    const old = app({ status: 'applied', last_activity_at: '2026-10-01T10:00:00Z' });
    expect(ghostCandidate(old, [], s, NOW)).toBe(true);
    expect(ghostCandidate({ ...old, status: 'interviewing' }, [], s, NOW)).toBe(false);
  });

  it('debrief: a meeting that ended with no note under it', () => {
    const held = meeting('2026-11-12T12:00:00Z', 'held');
    const canceled = meeting('2026-11-11T12:00:00Z', 'canceled');
    const noted = meeting('2026-11-10T12:00:00Z', 'held');
    const note = ev('note', '2026-11-10T14:00:00Z', {}, { parent_id: noted.id });
    const notOver = meeting('2026-11-12T14:30:00Z', 'scheduled');
    expect(needsDebrief([held, canceled, noted, note, notOver], NOW).map((e) => e.id)).toEqual([
      held.id,
    ]);
  });
});
