// What Knock Knock's notifications say and when. Pure, so each rule is unit-tested; the worker
// (src/worker/notifications.ts) feeds it the state and skips any key a device already got.
// Sending, the 8 a.m. timing and the sent log are the Selfhost Kit's (src/worker/kit/push.ts).
//
// - Interview today: the morning of each scheduled meeting.
// - Follow up: an open application quiet for follow_up_days, once per quiet spell.
// - Debrief: a meeting that ended with nothing written under it, once.
import { meetingKindLabel } from '../lookups';
import type { AppState, MeetingData, TimelineEvent } from '../types';
import { needsDebrief, needsFollowUp, quietDays } from './timeline';
import { dayIn } from './tz';

export const NOTIFY_KINDS = [
  { id: 'interviews', label: 'Interview today', description: 'The morning of each interview.' },
  {
    id: 'follow_up',
    label: 'Time to follow up',
    description: 'An application has gone quiet.',
  },
  { id: 'debrief', label: 'Write your debrief', description: 'After an interview ends.' },
] as const;

export type NotifyKind = (typeof NOTIFY_KINDS)[number]['id'];

export interface Notice {
  kind: NotifyKind;
  /** What it's about, sent once ever per device. */
  key: string;
  title: string;
  body: string;
  url: string;
  tag: string;
}

function timeIn(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

const meetingName = (e: TimelineEvent) => e.title || meetingKindLabel((e.data as MeetingData).kind);

export function dueNotices(state: AppState, now: Date, tz: string): Notice[] {
  const out: Notice[] = [];
  const today = dayIn(now, tz);
  const apps = new Map(state.applications.map((a) => [a.id, a]));

  for (const e of state.events) {
    if (e.type !== 'meeting' || (e.data as MeetingData).state !== 'scheduled') continue;
    if (dayIn(new Date(e.occurred_at), tz) !== today) continue;
    if (Date.parse(e.occurred_at) < now.getTime()) continue;
    const a = apps.get(e.application_id);
    if (!a) continue;
    out.push({
      kind: 'interviews',
      key: `meeting-${e.id}-${e.occurred_at}`,
      title: `Interview today: ${a.company}`,
      body: `${meetingName(e)} at ${timeIn(e.occurred_at, tz)}. Your stories are ready in call mode.`,
      url: `/a/${a.id}`,
      tag: `meeting-${e.id}`,
    });
  }

  for (const a of state.applications) {
    if (!needsFollowUp(a, state.events, state.settings, now)) continue;
    const days = quietDays(a, now, state.events);
    out.push({
      kind: 'follow_up',
      key: `follow-${a.id}-${a.last_activity_at}`,
      title: 'Time to follow up',
      body: `${a.company} has been quiet for ${days} days. Knock again?`,
      url: `/a/${a.id}`,
      tag: `follow-${a.id}`,
    });
  }

  for (const e of needsDebrief(state.events, now, 2)) {
    const a = apps.get(e.application_id);
    if (!a) continue;
    out.push({
      kind: 'debrief',
      key: `debrief-${e.id}`,
      title: `How did it go at ${a.company}?`,
      body: `Write down what they asked about in the ${meetingName(e).toLowerCase()} while it's fresh.`,
      url: `/a/${a.id}`,
      tag: `debrief-${e.id}`,
    });
  }
  return out;
}
