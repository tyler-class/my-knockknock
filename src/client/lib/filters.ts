// The counts every filter shows. A filter over the same data shows the same choices and the same
// numbers wherever it appears (the Jobs board, its list and the list's stage tabs; Stories'
// Framework filter), so they all count here.
import { CLOSED_STATUSES, statusLabel, type Status } from '@shared/lookups';
import type { Application, Framework, Story } from '@shared/types';

export type Stage = Status | 'active' | 'closed';

/** Accepted sits with the closed ones: the search is over. */
export const CLOSED_STAGES: Status[] = ['accepted', ...CLOSED_STATUSES];

/** Active: talking to them (Screening and Interviewing together). */
const ACTIVE_STATUSES: Status[] = ['interviewing', 'screening'];

/** The Jobs list's tabs, in order. */
export const STAGES: Stage[] = ['saved', 'applied', 'active', 'offer', 'closed'];

export const isStage = (v: string): v is Stage =>
  (STAGES as string[]).includes(v) || (CLOSED_STAGES as string[]).includes(v);

/** The statuses a stage covers, in the order the list shows them (furthest along first). */
export function stageStatuses(stage: Stage): Status[] {
  if (stage === 'active') return ACTIVE_STATUSES;
  if (stage === 'closed') return CLOSED_STAGES;
  return [stage];
}

export interface StageCounts {
  byStatus: (s: Status) => Application[];
  count: (stage: Stage) => number;
}

export function stageCounts(apps: Application[]): StageCounts {
  const by = new Map<Status, Application[]>();
  for (const a of apps) {
    if (!by.has(a.status)) by.set(a.status, []);
    by.get(a.status)!.push(a);
  }
  const byStatus = (s: Status) => by.get(s) ?? [];
  const count = (stage: Stage) => stageStatuses(stage).reduce((n, s) => n + byStatus(s).length, 0);
  return { byStatus, count };
}

/**
 * Where Jobs opens: the furthest stage that has a job in it (Offer, then Active, Applied, Saved;
 * never Closed), else Saved.
 */
export function defaultStage(apps: Application[]): Stage {
  const c = stageCounts(apps);
  return (
    (['offer', 'active', 'applied', 'saved'] as Stage[]).find((s) => c.count(s) > 0) ?? 'saved'
  );
}

/** A Jobs list tab's name: "Saved", "Active", "Closed". */
export const stageName = (stage: Stage) =>
  stage === 'active' ? 'Active' : stage === 'closed' ? 'Closed' : statusLabel(stage);

/** Stories filters: frameworks in use, counted within current or archived. */
export function storyCounts(stories: Story[], frameworks: Framework[], archived: boolean) {
  const pool = stories.filter((s) => s.archived === archived);
  const byFw = new Map<string, number>();
  for (const s of pool) byFw.set(s.framework_key, (byFw.get(s.framework_key) ?? 0) + 1);
  return {
    all: pool.length,
    frameworks: frameworks
      .filter((f) => byFw.has(f.key))
      .map((f) => ({ key: f.key, name: f.name, n: byFw.get(f.key)! })),
  };
}
