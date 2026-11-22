// The story bank's copy model and search.
//
// Linking a bank story to a job copies it. The copy remembers the bank version it came from and
// a hash of its content at that moment, which is enough to tell, without a diff engine:
//   in sync     – neither side changed
//   edited      – changed here, bank unchanged
//   bank newer  – bank changed, this copy didn't (pulling is safe)
//   both        – both changed (pull would lose your edits; compare first)
// The angle (how to frame it for this job) is job-only and never counts as an edit.
import { BUILTIN_FRAMEWORKS, type FrameworkSection } from '../frameworks';
import type { Framework, JobStory, Story } from '../types';

/**
 * What a copy's hash covers. Hook, tags and questions are no longer shown or edited (stories are
 * just their parts), but they stay in the hash so copies made before keep their sync state.
 */
export interface StoryContent {
  title: string;
  hook: string | null;
  tags: string[];
  sections: Record<string, string>;
  questions: string[];
}

/** FNV-1a, 32-bit, as hex: stable across the Worker and the browser, no async crypto. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function contentHash(c: StoryContent): string {
  const sections = Object.keys(c.sections)
    .filter((k) => (c.sections[k] ?? '').trim())
    .sort()
    .map((k) => [k, c.sections[k]!.trim()]);
  return fnv(
    JSON.stringify([
      c.title.trim(),
      (c.hook ?? '').trim(),
      [...c.tags].sort(),
      sections,
      c.questions.map((q) => q.trim()),
    ]),
  );
}

export type SyncState = 'job_only' | 'source_gone' | 'in_sync' | 'edited' | 'bank_newer' | 'both';

export function syncState(js: JobStory, bank: Story | undefined): SyncState {
  if (!js.story_id && js.source_version == null) return 'job_only';
  if (!bank) return 'source_gone';
  const edited = contentHash(js) !== js.base_hash;
  const newer = bank.version > (js.source_version ?? 0);
  return edited && newer ? 'both' : edited ? 'edited' : newer ? 'bank_newer' : 'in_sync';
}

/** A job's copy, in plain words, as a short tag on its row ('' when there's nothing to say). */
export const SYNC_LABEL: Record<SyncState, string> = {
  job_only: 'Only on this job',
  source_gone: 'Original deleted from Stories',
  in_sync: '',
  edited: 'Changed for this job',
  bank_newer: 'Newer version in Stories',
  both: 'Changed here and in Stories',
};

/** The same, seen from Stories story: how each job's copy compares with it. */
export const COPY_LABEL: Record<SyncState, string> = {
  job_only: '',
  source_gone: '',
  in_sync: 'Same as here',
  edited: 'Tailored for this job',
  bank_newer: 'Yours here is newer',
  both: 'Tailored; yours here is newer',
};

/** Built-ins first, then custom ones. (`questions` is an unused column, kept for old data.) */
export function allFrameworks(custom: Framework[]): Framework[] {
  return [
    ...BUILTIN_FRAMEWORKS.map((f) => ({ ...f, questions: [], builtin: true })),
    ...custom.filter((c) => !BUILTIN_FRAMEWORKS.some((b) => b.key === c.key)),
  ];
}

export const frameworkOf = (key: string, frameworks: Framework[]) =>
  frameworks.find((f) => f.key === key);

/**
 * Moving a story to another framework: sections whose key the new one also has carry over;
 * the rest are kept in notes as "Label: text", so nothing is lost.
 */
export function switchFramework(
  sections: Record<string, string>,
  from: FrameworkSection[],
  to: FrameworkSection[],
  notes: string | null,
): { sections: Record<string, string>; notes: string | null } {
  const keep = new Set(to.map((s) => s.key));
  const out: Record<string, string> = {};
  const moved: string[] = [];
  for (const [k, v] of Object.entries(sections)) {
    if (!v.trim()) continue;
    if (keep.has(k)) out[k] = v;
    else moved.push(`${from.find((s) => s.key === k)?.label ?? k}: ${v.trim()}`);
  }
  const extra = moved.join('\n\n');
  return {
    sections: out,
    notes: extra ? (notes ? `${notes.trim()}\n\n${extra}` : extra) : notes,
  };
}

const STOP = new Set(
  'a an and are about as at be by can could did do does for from give had has have how i in is it me my of on or our so tell than that the their them then there this time to us was we were what when where which who why will with would you your yours'.split(
    ' ',
  ),
);

export const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w));

const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '');

export interface Searchable {
  title: string;
  framework_key: string;
  sections: Record<string, string>;
}

export interface StoryHit<T> {
  item: T;
  score: number;
}

/**
 * Plain word overlap, no AI: instant and works offline. Type the question you just heard (or any
 * words) and stories whose title, framework name or parts share its words float up: a title word
 * counts most, then the framework's name, then the text of the parts.
 */
export function searchStories<T extends Searchable>(
  items: T[],
  q: string,
  frameworks: Pick<Framework, 'key' | 'name'>[] = [],
): StoryHit<T>[] {
  const qw = [...new Set(words(q).map(stem))];
  if (!qw.length) return items.map((item) => ({ item, score: 0 }));
  const fwName = new Map(frameworks.map((f) => [f.key, f.name]));
  const hits: StoryHit<T>[] = [];
  for (const item of items) {
    const title = new Set(words(item.title).map(stem));
    const fw = new Set(words(fwName.get(item.framework_key) ?? item.framework_key).map(stem));
    const parts = new Set(words(Object.values(item.sections).join(' ')).map(stem));
    let score = 0;
    for (const w of qw) {
      if (title.has(w)) score += 3;
      if (fw.has(w)) score += 2;
      if (parts.has(w)) score += 1;
    }
    if (score > 0) hits.push({ item, score });
  }
  hits.sort((a, b) => b.score - a.score);
  // Drop stragglers that only share a word or two with the question.
  const top = hits[0]?.score ?? 0;
  return hits.filter((h) => h.score >= top * 0.3);
}
