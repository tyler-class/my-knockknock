// Ordering and reading an application's timeline: upcoming meetings above "now", the past
// newest first, notes nested under the event they're about, and what's near a given time
// (what an assistant reads before logging, so it doesn't log the same thing twice).
import type { EventType, Status } from '../lookups';
import type { Application, MeetingData, Settings, TimelineEvent } from '../types';

const DAY = 86_400_000;

export const isUpcoming = (e: TimelineEvent, now: Date) =>
  e.type === 'meeting' &&
  (e.data as MeetingData).state === 'scheduled' &&
  Date.parse(e.occurred_at) > now.getTime();

export interface TimelineView {
  /** Scheduled meetings still ahead, soonest first. */
  upcoming: TimelineEvent[];
  /** Everything else at the top level, newest first. */
  past: TimelineEvent[];
  /** Notes attached to an event, oldest first. */
  children: Map<string, TimelineEvent[]>;
}

export function timelineView(events: TimelineEvent[], now: Date): TimelineView {
  const ids = new Set(events.map((e) => e.id));
  const children = new Map<string, TimelineEvent[]>();
  const top: TimelineEvent[] = [];
  for (const e of events) {
    if (e.parent_id && ids.has(e.parent_id)) {
      if (!children.has(e.parent_id)) children.set(e.parent_id, []);
      children.get(e.parent_id)!.push(e);
    } else top.push(e);
  }
  for (const list of children.values())
    list.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const upcoming = top
    .filter((e) => isUpcoming(e, now))
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const past = top
    .filter((e) => !isUpcoming(e, now))
    .sort(
      (a, b) =>
        b.occurred_at.localeCompare(a.occurred_at) || b.created_at.localeCompare(a.created_at),
    );
  return { upcoming, past, children };
}

/** Events within ±days of `at`, nearest first: what to check before writing one. */
export function nearby(
  events: TimelineEvent[],
  at: string,
  days = 3,
  types?: readonly EventType[],
): TimelineEvent[] {
  const t = Date.parse(at);
  return events
    .filter(
      (e) =>
        (!types || types.includes(e.type)) && Math.abs(Date.parse(e.occurred_at) - t) <= days * DAY,
    )
    .sort(
      (a, b) => Math.abs(Date.parse(a.occurred_at) - t) - Math.abs(Date.parse(b.occurred_at) - t),
    );
}

/** The newest thing that has happened (future meetings don't count). */
export function lastActivity(events: TimelineEvent[], fallback: string, now = new Date()): string {
  let best = fallback;
  for (const e of events)
    if (Date.parse(e.occurred_at) <= now.getTime() && e.occurred_at > best) best = e.occurred_at;
  return best;
}

/**
 * Whole days since anything happened. With the timeline, a meeting that was still ahead when
 * last_activity_at was cached counts once it's past.
 */
export function quietDays(
  app: Pick<Application, 'id' | 'last_activity_at'>,
  now: Date,
  events?: TimelineEvent[],
): number {
  const last = events
    ? lastActivity(
        events.filter((e) => e.application_id === app.id),
        app.last_activity_at,
        now,
      )
    : app.last_activity_at;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(last)) / DAY));
}

/** Waiting on them: the stages where silence means you should knock again. */
const WAITING: Status[] = ['applied', 'screening', 'interviewing', 'offer'];

export function hasUpcoming(events: TimelineEvent[], appId: string, now: Date) {
  return events.some((e) => e.application_id === appId && isUpcoming(e, now));
}

/** Open, waiting on them, nothing scheduled, and quiet for at least follow_up_days. */
export function needsFollowUp(
  app: Application,
  events: TimelineEvent[],
  s: Pick<Settings, 'follow_up_days'>,
  now: Date,
): boolean {
  return (
    WAITING.includes(app.status) &&
    quietDays(app, now, events) >= s.follow_up_days &&
    !hasUpcoming(events, app.id, now)
  );
}

/** Applied or screening and quiet past ghost_days: suggest Ghosted (never set automatically). */
export function ghostCandidate(
  app: Application,
  events: TimelineEvent[],
  s: Pick<Settings, 'ghost_days'>,
  now: Date,
): boolean {
  return (
    (app.status === 'applied' || app.status === 'screening') &&
    quietDays(app, now, events) >= s.ghost_days &&
    !hasUpcoming(events, app.id, now)
  );
}

/** When a meeting is over: its end time, else an hour after it starts. */
export const meetingEnd = (e: TimelineEvent) => {
  const d = e.data as MeetingData;
  return d.ends_at ? Date.parse(d.ends_at) : Date.parse(e.occurred_at) + 3_600_000;
};

/** Meetings that ended in the last `withinDays` with no note under them yet. */
export function needsDebrief(events: TimelineEvent[], now: Date, withinDays = 7): TimelineEvent[] {
  const noted = new Set(events.filter((e) => e.parent_id).map((e) => e.parent_id));
  return events.filter((e) => {
    if (e.type !== 'meeting' || (e.data as MeetingData).state === 'canceled') return false;
    const end = meetingEnd(e);
    return end <= now.getTime() && now.getTime() - end <= withinDays * DAY && !noted.has(e.id);
  });
}
