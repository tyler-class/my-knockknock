// An application's status is its timeline's: the newest created/status event (by when it
// happened, not when it was logged) decides it. Backfilling "they rejected me on the 3rd" on
// the 10th lands in the right place, and deleting a status event recomputes from what's left.
import { CLOSED_STATUSES, OPEN_STATUSES, stageIndex, type Status } from '../lookups';
import type { StatusData, TimelineEvent } from '../types';

type Ev = Pick<TimelineEvent, 'type' | 'occurred_at' | 'created_at' | 'data'>;

const byTime = (a: Ev, b: Ev) =>
  a.occurred_at < b.occurred_at
    ? -1
    : a.occurred_at > b.occurred_at
      ? 1
      : a.created_at < b.created_at
        ? -1
        : a.created_at > b.created_at
          ? 1
          : 0;

/** The created and status events, oldest first (the created event always leads). */
export function statusEvents<E extends Ev>(events: E[]): E[] {
  return events
    .filter((e) => e.type === 'created' || e.type === 'status')
    .sort((a, b) => (a.type === 'created' ? -1 : b.type === 'created' ? 1 : byTime(a, b)));
}

export const toOf = (e: Ev) => (e.data as StatusData).to;

export function deriveStatus(events: Ev[]): { status: Status; closed_from: Status | null } {
  const seq = statusEvents(events);
  const last = seq[seq.length - 1];
  const status: Status = last ? toOf(last) : 'saved';
  if (!CLOSED_STATUSES.includes(status)) return { status, closed_from: null };
  // The open stage it closed from: the furthest open stage reached before the close.
  let from: Status | null = null;
  for (const e of seq.slice(0, -1)) {
    const t = toOf(e);
    if (OPEN_STATUSES.includes(t) && (from === null || stageIndex(t) > stageIndex(from))) from = t;
  }
  return { status, closed_from: from };
}

/** Every open stage the application reached, in pipeline order (gaps filled: an interview means it was screened). */
export function stagesReached(events: Ev[]): Status[] {
  let top = -1;
  let accepted = false;
  for (const e of statusEvents(events)) {
    const t = toOf(e);
    if (t === 'accepted') accepted = true;
    const i = OPEN_STATUSES.indexOf(t);
    if (i > top) top = i;
  }
  if (accepted) top = OPEN_STATUSES.length - 1;
  const out = OPEN_STATUSES.slice(0, top + 1);
  return accepted ? [...out, 'accepted'] : out;
}

/** When it was sent: the first event that put it at Applied or beyond. */
export function appliedAt(events: Ev[]): string | null {
  for (const e of statusEvents(events)) {
    const t = toOf(e);
    if (t !== 'saved' && (OPEN_STATUSES.includes(t) || t === 'accepted')) return e.occurred_at;
  }
  return null;
}
