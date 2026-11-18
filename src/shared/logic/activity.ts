// What Home shows about the timeline: interviews coming up this week, and a plain label for each
// recent entry (what kind of thing it is, and a line of what it says).
import { meetingKindLabel, statusLabel } from '../lookups';
import type { EmailData, MeetingData, StatusData, TimelineEvent } from '../types';

const DAY = 86_400_000;

/**
 * Meetings still scheduled from now through the next 7 days, soonest first (canceled and held
 * ones don't count).
 */
export function interviewsThisWeek(events: TimelineEvent[], now: Date): TimelineEvent[] {
  const from = now.getTime();
  const to = from + 7 * DAY;
  return events
    .filter((e) => {
      if (e.type !== 'meeting' || (e.data as MeetingData).state !== 'scheduled') return false;
      const t = Date.parse(e.occurred_at);
      return t >= from && t <= to;
    })
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

/** The first line of some text, trimmed; null when there's nothing. */
const firstLine = (s: string | null | undefined) => {
  const line = (s ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  return line || null;
};

export interface ActivityLabel {
  /** The icon key: the event type, or 'file' for a file being added. */
  icon: 'meeting' | 'email' | 'note' | 'status' | 'created' | 'file';
  /** "Note", "Email", "Meeting: Recruiter screen", "Status: Applied → Screening", "File added". */
  kind: string;
  /** One line of what it says, when there is one. */
  snippet: string | null;
}

/** What a timeline entry is, in words, and a line of what it says. */
export function activityLabel(e: TimelineEvent): ActivityLabel {
  if (e.type === 'meeting') {
    const d = e.data as MeetingData;
    const kind = meetingKindLabel(d.kind);
    const title = e.title && e.title !== kind ? e.title : null;
    return {
      icon: 'meeting',
      kind: `Meeting: ${kind}`,
      snippet: firstLine(title ?? d.agenda ?? e.body),
    };
  }
  if (e.type === 'email') {
    const d = e.data as EmailData;
    return { icon: 'email', kind: 'Email', snippet: firstLine(e.title || d.subject || e.body) };
  }
  if (e.type === 'status') {
    const d = e.data as StatusData;
    return {
      icon: 'status',
      kind: d.from
        ? `Status: ${statusLabel(d.from)} → ${statusLabel(d.to)}`
        : `Status: ${statusLabel(d.to)}`,
      snippet: firstLine(d.reason),
    };
  }
  if (e.type === 'created') return { icon: 'created', kind: 'Created', snippet: null };
  if ((e.data as { file_id?: string }).file_id)
    return { icon: 'file', kind: 'File added', snippet: firstLine(e.title) };
  return { icon: 'note', kind: 'Note', snippet: firstLine(e.title || e.body) };
}
