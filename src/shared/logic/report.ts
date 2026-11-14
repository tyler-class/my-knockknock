// A search's numbers, built from status history (not current status), so each application
// counts once in every stage it reached.
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

export interface Breakdown {
  name: string;
  n: number;
  responded: number;
  rate: number;
}

export interface Report {
  /** Applications sent (reached Applied or beyond). */
  sent: number;
  saved: number;
  responded: number;
  interviewed: number;
  offers: number;
  accepted: number;
  rejected: number;
  declined: number;
  ghosted: number;
  open: number;
  responseRate: number | null;
  interviewRate: number | null;
  offerRate: number | null;
  ghostRate: number | null;
  /** Median days from applying to the first reply (an inbound email or a status change). */
  medianReplyDays: number | null;
  nodes: FlowNode[];
  links: FlowLink[];
  bySource: Breakdown[];
  byResume: Breakdown[];
  /** Applications sent per week (Monday starts), oldest first. */
  perWeek: { week: string; n: number }[];
}

const FLOW: Status[] = ['applied', 'screening', 'interviewing', 'offer', 'accepted'];
const DAY = 86_400_000;
const rate = (a: number, b: number) => (b ? a / b : null);

function median(xs: number[]): number | null {
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
    responded: 0,
    interviewed: 0,
    offers: 0,
    accepted: 0,
    rejected: 0,
    declined: 0,
    ghosted: 0,
    open: 0,
    responseRate: null,
    interviewRate: null,
    offerRate: null,
    ghostRate: null,
    medianReplyDays: null,
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
    // A reply: got past Applied, or any close other than silence.
    const responded =
      reached.length > 1 ||
      outcome === 'rejected' ||
      outcome === 'declined' ||
      ev.some(
        (e) =>
          e.type === 'email' &&
          (e.data as { direction?: string }).direction === 'in' &&
          (e.data as { category?: string }).category !== 'confirmation',
      );
    if (responded) r.responded++;
    if (reached.includes('interviewing')) r.interviewed++;
    if (reached.includes('offer')) r.offers++;
    if (outcome === 'accepted') r.accepted++;
    else if (outcome === 'open') r.open++;
    else r[outcome]++;

    for (const s of reached) nodeN.set(s, (nodeN.get(s) ?? 0) + 1);
    for (let i = 1; i < reached.length; i++) bump(reached[i - 1]!, reached[i]!, 'forward');
    const last = reached[reached.length - 1]!;
    if (outcome !== 'accepted') {
      const id = `${outcome}@${last}`;
      nodeN.set(id, (nodeN.get(id) ?? 0) + 1);
      bump(last, id, outcome);
    }

    if (sentAt) {
      const t = Date.parse(sentAt);
      const reply = ev
        .filter((e) => Date.parse(e.occurred_at) > t)
        .filter(
          (e) =>
            (e.type === 'email' &&
              (e.data as { direction?: string }).direction === 'in' &&
              (e.data as { category?: string }).category !== 'confirmation') ||
            ((e.type === 'status' || e.type === 'created') &&
              toOf(e) !== 'applied' &&
              toOf(e) !== 'ghosted' &&
              toOf(e) !== 'saved'),
        )
        .map((e) => Date.parse(e.occurred_at))
        .sort((x, y) => x - y)[0];
      if (reply != null) replyDays.push(Math.round(((reply - t) / DAY) * 10) / 10);
    }

    const src = a.source?.trim() || 'Unknown';
    const sb = sources.get(src) ?? { name: src, n: 0, responded: 0, rate: 0 };
    sb.n++;
    if (responded) sb.responded++;
    sources.set(src, sb);
    const resume = a.resume_file_id
      ? (files.find((f) => f.id === a.resume_file_id)?.label ??
        files.find((f) => f.id === a.resume_file_id)?.filename ??
        'Resume')
      : 'No resume attached';
    const rb = resumes.get(resume) ?? { name: resume, n: 0, responded: 0, rate: 0 };
    rb.n++;
    if (responded) rb.responded++;
    resumes.set(resume, rb);
  }

  r.responseRate = rate(r.responded, r.sent);
  r.interviewRate = rate(r.interviewed, r.sent);
  r.offerRate = rate(r.offers, r.sent);
  r.ghostRate = rate(r.ghosted, r.sent);
  r.medianReplyDays = median(replyDays);

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
  const finish = (m: Map<string, Breakdown>) =>
    [...m.values()].map((b) => ({ ...b, rate: b.responded / b.n })).sort((a, b) => b.n - a.n);
  r.bySource = finish(sources);
  r.byResume = finish(resumes);

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
