import { describe, expect, it } from 'vitest';
import { appliedAt, deriveStatus, stagesReached } from '@shared/logic/status';
import { created, st } from './fixtures';

describe('status from the timeline', () => {
  it('is the newest status by when it happened, not when it was logged', () => {
    const events = [
      created('saved', '2026-10-01T10:00:00Z'),
      st('applied', '2026-10-02T10:00:00Z', 'saved'),
      // Backfilled later, but it happened between the two.
      st('screening', '2026-10-05T10:00:00Z', 'applied'),
      st('rejected', '2026-10-20T10:00:00Z', 'screening'),
    ];
    expect(deriveStatus(events)).toEqual({ status: 'rejected', closed_from: 'screening' });
    // Deleting the rejection reopens it where it was.
    expect(deriveStatus(events.slice(0, 3))).toEqual({ status: 'screening', closed_from: null });
  });

  it('is Saved with no events, and closed_from is the furthest open stage reached', () => {
    expect(deriveStatus([])).toEqual({ status: 'saved', closed_from: null });
    const events = [
      created('applied', '2026-10-01T10:00:00Z'),
      st('interviewing', '2026-10-08T10:00:00Z', 'applied'),
      st('ghosted', '2026-11-20T10:00:00Z', 'interviewing'),
    ];
    expect(deriveStatus(events)).toEqual({ status: 'ghosted', closed_from: 'interviewing' });
  });

  it('fills gaps in the stages reached, and knows when it was sent', () => {
    const events = [
      created('saved', '2026-10-01T10:00:00Z'),
      st('applied', '2026-10-03T09:00:00Z', 'saved'),
      st('interviewing', '2026-10-09T10:00:00Z', 'applied'),
    ];
    expect(stagesReached(events)).toEqual(['saved', 'applied', 'screening', 'interviewing']);
    expect(appliedAt(events)).toBe('2026-10-03T09:00:00Z');
    expect(stagesReached([created('applied', 'x'), st('accepted', 'y')])).toEqual([
      'saved',
      'applied',
      'screening',
      'interviewing',
      'offer',
      'accepted',
    ]);
    expect(appliedAt([created('saved', '2026-10-01T10:00:00Z')])).toBeNull();
  });
});
