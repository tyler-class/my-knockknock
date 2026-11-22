// A search's numbers, built from status history (not current status), so each application
// counts once in every stage it reached.
//
// Heard back: the application moved past Applied (Screening or later) or was rejected, rather
// than silence. When: the first status change after applying that says so (Screening or later,
// or Rejected). Emails and meetings don't count on their own: status is the reliable signal.
import { CLOSED_STATUSES, OPEN_STATUSES, statusLabel, type Status } from '../lookups';
import type { Application, FileRef, TimelineEvent } from '../types';
import { appliedAt, stagesReached, statusEvents, toOf } from './status';

export type Outcome = 'open' | 'accepted' | 'rejected' | 'declined' | 'ghosted';

export interface FlowLink {
  from: string;
  to: string;
  n: number;
  kind: 'forward' | Outcome;
}

export interface FlowNode {
  id: string;
  label: string;
  col: number;
  n: number;
  kind: 'stage' | Outcome;
}

/** One row of "N of M heard back": a source or a resume. */
export interface Breakdown {
  name: string;
  applied: number;
  heardBack: number;
  rate: number;
}

export interface Report {
  /** Applications sent (reached Applied or beyond). */
  sent: number;
  saved: number;
  /** Moved past Applied, or rejected (see the top of this file). */
  heardBack: number;
  /** Reached Interviewing or later. */
  interviewed: number;
  /** Reached Offer or later (Accepted included). */
  offers: number;
  accepted: number;
  rejected: number;
  declined: number;
  ghosted: number;
  open: number;
  heardBackRate: number | null;
  interviewRate: number | null;
  offerRate: number | null;
  /** Median days from applying to hearing back; null with fewer than two replies. */
  medianDaysToHear: number | null;
  /** How many applications that median is built from. */
  replies: number;
  nodes: FlowNode[];
  links: FlowLink[];
  /** By where the job was found, most applications first (no source: "Not set"). */
  bySource: Breakdown[];
  /** By resume attached; empty unless more than one resume was used. */
  byResume: Breakdown[];
  /** Applications sent per week (Monday starts), oldest first. */
  perWeek: { week: string; n: number }[];
}

const FLOW: Status[] = ['applied', 'screening', 'interviewing', 'offer', 'accepted'];
const DAY = 86_400_000;
const rate = (a: number, b: number) => (b ? a / b : null);

/** The fewest replies a median time is shown for. */
export const MIN_REPLIES = 2;

const PAST_APPLIED: Status[] = ['screening', 'interviewing', 'offer', 'accepted', 'rejected'];

/** Heard back: reached Screening or later, or was rejected (at any point). */
export function heardBack(events: TimelineEvent[]): boolean {
  return statusEvents(events).some((e) => PAST_APPLIED.includes(toOf(e)));
}

/** When it heard back: the first status change after applying to Screening or later, or Rejected. */
export function heardBackAt(events: TimelineEvent[]): string | null {
  const sent = appliedAt(events);
  if (!sent) return null;
  const t = Date.parse(sent);
  const first = statusEvents(events)
    .filter((e) => Date.parse(e.occurred_at) > t && PAST_APPLIED.includes(toOf(e)))
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))[0];
  return first?.occurred_at ?? null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function weekOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return m.toISOString().slice(0, 10);
}

/** Rows with their rate, most applications first (then by name); none with 0 applied. */
function breakdown(m: Map<string, Breakdown>): Breakdown[] {
  return [...m.values()]
    .filter((b) => b.applied > 0)
    .map((b) => ({ ...b, rate: b.heardBack / b.applied }))
    .sort((a, b) => b.applied - a.applied || a.name.localeCompare(b.name));
}

export function buildReport(
  apps: Application[],
  events: TimelineEvent[],
  files: FileRef[] = [],
  weeks = 12,
  now = new Date(),
): Report {
  const byApp = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    if (!byApp.has(e.application_id)) byApp.set(e.application_id, []);
    byApp.get(e.application_id)!.push(e);
  }
  const r: Report = {
    sent: 0,
    saved: 0,
    heardBack: 0,
    interviewed: 0,
    offers: 0,
    accepted: 0,
    rejected: 0,
    declined: 0,
    ghosted: 0,
    open: 0,
    heardBackRate: null,
    interviewRate: null,
    offerRate: null,
    medianDaysToHear: null,
    replies: 0,
    nodes: [],
    links: [],
    bySource: [],
    byResume: [],
    perWeek: [],
  };
  const linkMap = new Map<string, FlowLink>();
  const nodeN = new Map<string, number>();
  const bump = (from: string, to: string, kind: FlowLink['kind']) => {
    const k = `${from}>${to}`;
    const l = linkMap.get(k) ?? { from, to, n: 0, kind };
    l.n++;
    linkMap.set(k, l);
  };
  const replyDays: number[] = [];
  const sources = new Map<string, Breakdown>();
  const resumes = new Map<string, Breakdown>();
  const sentWeeks = new Map<string, number>();

  for (const a of apps) {
    const ev = byApp.get(a.id) ?? [];
    const reached = stagesReached(ev).filter((s) => FLOW.includes(s));
    if (!reached.length) {
      if (a.status === 'saved') r.saved++;
      continue;
    }
    r.sent++;
    const sentAt = appliedAt(ev);
    if (sentAt) sentWeeks.set(weekOf(sentAt), (sentWeeks.get(weekOf(sentAt)) ?? 0) + 1);
    const outcome: Outcome =
      a.status === 'accepted'
        ? 'accepted'
        : CLOSED_STATUSES.includes(a.status)
          ? (a.status as Outcome)
          : 'open';
    const heard = heardBack(ev);
    if (heard) r.heardBack++;
    if (reached.includes('interviewing')) r.interviewed++;
    if (reached.includes('offer') || reached.includes('accepted')) r.offers++;
    if (outcome === 'accepted') r.accepted++;
    else if (outcome === 'open') r.open++;
    else r[outcome]++;

    for (const s of reached) nodeN.set(s, (nodeN.get(s) ?? 0) + 1);
    for (let i = 1; i < reached.length; i++) bump(reached[i - 1]!, reached[i]!, 'forward');
    const last = reached[reached.length - 1]!;
    // Still in play: its flow just stops at the stage it's at (no "still at" branch). An ending
    // (rejected, ghosted, declined) branches off to its own node; Accepted is its own stage.
    if (outcome !== 'accepted' && outcome !== 'open') {
      const id = `${outcome}@${last}`;
      nodeN.set(id, (nodeN.get(id) ?? 0) + 1);
      bump(last, id, outcome);
    }

    const heardAt = heardBackAt(ev);
    if (sentAt && heardAt)
      replyDays.push(Math.round(((Date.parse(heardAt) - Date.parse(sentAt)) / DAY) * 10) / 10);

    const add = (m: Map<string, Breakdown>, name: string) => {
      const b = m.get(name) ?? { name, applied: 0, heardBack: 0, rate: 0 };
      b.applied++;
      if (heard) b.heardBack++;
      m.set(name, b);
    };
    add(sources, a.source?.trim() || 'Not set');
    const file = a.resume_file_id ? files.find((f) => f.id === a.resume_file_id) : undefined;
    add(
      resumes,
      a.resume_file_id ? (file?.label ?? file?.filename ?? 'Resume') : 'No resume attached',
    );
  }

  r.heardBackRate = rate(r.heardBack, r.sent);
  r.interviewRate = rate(r.interviewed, r.sent);
  r.offerRate = rate(r.offers, r.sent);
  r.replies = replyDays.length;
  r.medianDaysToHear = replyDays.length >= MIN_REPLIES ? median(replyDays) : null;

  FLOW.forEach((s, col) => {
    const n = nodeN.get(s);
    if (n) r.nodes.push({ id: s, label: statusLabel(s), col, n, kind: 'stage' });
  });
  for (const [id, n] of nodeN) {
    if (!id.includes('@')) continue;
    const [outcome, at] = id.split('@') as [Outcome, Status];
    const label =
      outcome === 'open' ? `Still at ${statusLabel(at).toLowerCase()}` : statusLabel(outcome);
    r.nodes.push({ id, label, col: FLOW.indexOf(at) + 1, n, kind: outcome });
  }
  r.links = [...linkMap.values()];
  r.bySource = breakdown(sources);
  // Only worth comparing when more than one resume went out.
  const usedResumes = [...resumes.keys()].filter((k) => k !== 'No resume attached');
  r.byResume = usedResumes.length > 1 ? breakdown(resumes) : [];

  const thisWeek = weekOf(now.toISOString());
  for (let i = weeks - 1; i >= 0; i--) {
    const w = weekOf(new Date(Date.parse(thisWeek) - i * 7 * DAY).toISOString());
    r.perWeek.push({ week: w, n: sentWeeks.get(w) ?? 0 });
  }
  return r;
}

/** Statuses still in play, for the board's columns. */
export const BOARD_COLUMNS: Status[] = [...OPEN_STATUSES];

export { statusEvents };
