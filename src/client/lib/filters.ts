// The counts every filter shows. A filter over the same data shows the same choices and the same
// numbers wherever it appears (the Pipeline board, its list and the Stage toggle; Stories'
// Framework and Competency toggles), so they all count here.
import { CLOSED_STATUSES, OPEN_STATUSES, statusLabel, type Status } from '@shared/lookups';
import type { Application, Framework, Story } from '@shared/types';

export type Stage = Status | 'open' | 'closed';

/** Accepted sits with the closed ones: the search is over. */
export const CLOSED_STAGES: Status[] = ['accepted', ...CLOSED_STATUSES];

export const STAGES: Stage[] = ['open', ...OPEN_STATUSES, 'closed'];

export const isStage = (v: string): v is Stage =>
  (STAGES as string[]).includes(v) || (CLOSED_STAGES as string[]).includes(v);

/** The statuses a stage covers, in the order the list shows them. */
export function stageStatuses(stage: Stage): Status[] {
  if (stage === 'open') return OPEN_STATUSES.slice().reverse();
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
  const count = (stage: Stage) =>
    stage === 'open' || stage === 'closed'
      ? (stage === 'open' ? OPEN_STATUSES : CLOSED_STAGES).reduce(
          (n, s) => n + byStatus(s).length,
          0,
        )
      : byStatus(stage).length;
  return { byStatus, count };
}

/** "Open 5", "Applied 2", "Closed 3": the Stage toggle's choices. */
export const stageLabel = (stage: Stage, counts: StageCounts) =>
  `${stage === 'open' ? 'Open' : stage === 'closed' ? 'Closed' : statusLabel(stage)} ${counts.count(stage)}`;

/** Stories filters: frameworks and competencies in use, counted within current or archived. */
export function storyCounts(stories: Story[], frameworks: Framework[], archived: boolean) {
  const pool = stories.filter((s) => s.archived === archived);
  const byFw = new Map<string, number>();
  for (const s of pool) byFw.set(s.framework_key, (byFw.get(s.framework_key) ?? 0) + 1);
  const tags = new Map<string, number>();
  for (const s of pool) for (const t of s.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  return {
    all: pool.length,
    frameworks: frameworks
      .filter((f) => byFw.has(f.key))
      .map((f) => ({ key: f.key, name: f.name, n: byFw.get(f.key)! })),
    tags: [...tags.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, n]) => ({ tag, n })),
  };
}
