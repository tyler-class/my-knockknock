import type { FrameworkSection } from '@shared/frameworks';
import type { SalaryPeriod, Status, WorkMode } from '@shared/lookups';
import { deriveStatus } from '@shared/logic/status';
import { allFrameworks } from '@shared/logic/stories';
import { lastActivity } from '@shared/logic/timeline';
import type {
  AppState,
  Application,
  Company,
  EventData,
  FileRef,
  Framework,
  JobStory,
  Person,
  Round,
  Settings,
  Story,
  TimelineEvent,
  JobQuestion,
  Question,
} from '@shared/types';
import { kitState } from './kit/telemetry';

export type Row = Record<string, unknown>;

export const nowIso = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

export async function all<T = Row>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  const res = await db
    .prepare(sql)
    .bind(...binds)
    .all<T>();
  return res.results;
}

export async function first<T = Row>(
  db: D1Database,
  sql: string,
  ...binds: unknown[]
): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...binds)
    .first<T>();
}

/** UPDATE helper: only the given columns, plus updated_at. */
export function updateStmt(
  db: D1Database,
  table: string,
  id: string,
  fields: Record<string, unknown>,
  idCol = 'id',
) {
  const cols = Object.keys(fields);
  const sets = [...cols.map((c) => `${c} = ?`), 'updated_at = ?'].join(', ');
  return db
    .prepare(`UPDATE ${table} SET ${sets} WHERE ${idCol} = ?`)
    .bind(...cols.map((c) => fields[c]), nowIso(), id);
}

export function insertStmt(db: D1Database, table: string, fields: Record<string, unknown>) {
  const cols = Object.keys(fields);
  return db
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(...cols.map((c) => fields[c]));
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
function json<T>(v: unknown, d: T): T {
  try {
    const p: unknown = JSON.parse(String(v ?? ''));
    return (p ?? d) as T;
  } catch {
    return d;
  }
}
const arr = (v: unknown): string[] => {
  const p = json<unknown>(v, []);
  return Array.isArray(p) ? p.map(String) : [];
};
const rec = (v: unknown): Record<string, string> => {
  const p = json<unknown>(v, {});
  return p && typeof p === 'object' && !Array.isArray(p)
    ? Object.fromEntries(
        Object.entries(p as Record<string, unknown>).map(([k, x]) => [k, String(x ?? '')]),
      )
    : {};
};

/** JSON-encodes arrays and objects, and booleans as 0/1, before they're written. */
export function encode<T extends Record<string, unknown>>(fields: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [
      k,
      v !== null && typeof v === 'object'
        ? JSON.stringify(v)
        : typeof v === 'boolean'
          ? v
            ? 1
            : 0
          : v,
    ]),
  );
}

export const toRound = (r: Row): Round => ({
  id: String(r.id),
  name: String(r.name),
  status: String(r.status) as Round['status'],
  started_on: s(r.started_on),
  ended_on: s(r.ended_on),
  notes: s(r.notes),
  created_at: String(r.created_at),
});

export const toApplication = (r: Row): Application => ({
  id: String(r.id),
  round_id: String(r.round_id),
  status: String(r.status) as Status,
  closed_from: (s(r.closed_from) as Status | null) ?? null,
  title: String(r.title),
  company: String(r.company),
  company_domain: s(r.company_domain),
  company_website: s(r.company_website),
  company_linkedin: s(r.company_linkedin),
  company_hq: s(r.company_hq),
  company_size: s(r.company_size),
  company_industry: s(r.company_industry),
  company_funding: s(r.company_funding),
  url: s(r.url),
  source: s(r.source),
  location: s(r.location),
  work_mode: (s(r.work_mode) as WorkMode | null) ?? null,
  seniority: s(r.seniority),
  reports_to: s(r.reports_to),
  team: s(r.team),
  employment_type: s(r.employment_type),
  salary_min: n(r.salary_min),
  salary_max: n(r.salary_max),
  salary_currency: s(r.salary_currency),
  salary_period: (s(r.salary_period) as SalaryPeriod | null) ?? null,
  salary_text: s(r.salary_text),
  posted_on: s(r.posted_on),
  description: s(r.description),
  must_haves: arr(r.must_haves),
  nice_to_haves: arr(r.nice_to_haves),
  inferred: arr(r.inferred),
  applied_on: s(r.applied_on),
  resume_file_id: s(r.resume_file_id),
  notes: s(r.notes),
  created_at: String(r.created_at),
  updated_at: String(r.updated_at),
  last_activity_at: String(r.last_activity_at),
  board_position: n(r.board_position),
  company_id: s(r.company_id),
});

export const toCompany = (r: Row): Company => ({
  id: String(r.id),
  name: String(r.name),
  website: s(r.website),
  linkedin: s(r.linkedin),
  hq: s(r.hq),
  size: s(r.size),
  industry: s(r.industry),
  funding: s(r.funding),
  has_logo: !!r.logo_key,
  logo_color: s(r.logo_color),
  created_at: String(r.created_at),
  updated_at: String(r.updated_at),
});

export const toPerson = (r: Row, jobs: string[] = []): Person => ({
  id: String(r.id),
  application_id: s(r.application_id),
  company_id: s(r.company_id),
  application_ids: jobs,
  name: String(r.name),
  email: s(r.email),
  title: s(r.title),
  role: String(r.role) as Person['role'],
  other_role: s(r.other_role),
  linkedin: s(r.linkedin),
  notes: s(r.notes),
  created_at: String(r.created_at),
});

export const toEvent = (r: Row): TimelineEvent => ({
  id: String(r.id),
  application_id: String(r.application_id),
  type: String(r.type) as TimelineEvent['type'],
  occurred_at: String(r.occurred_at),
  title: s(r.title),
  body: s(r.body),
  source: r.source === 'agent' ? 'agent' : 'manual',
  source_name: s(r.source_name),
  external_ref: s(r.external_ref),
  parent_id: s(r.parent_id),
  data: json<EventData>(r.data, {}),
  created_at: String(r.created_at),
  updated_at: String(r.updated_at),
});

export const toFramework = (r: Row): Framework => ({
  key: String(r.key),
  name: String(r.name),
  group: 'Custom',
  blurb: String(r.blurb ?? ''),
  sections: json<FrameworkSection[]>(r.sections, []),
  questions: arr(r.questions),
  builtin: false,
});

export const toStory = (r: Row): Story => ({
  id: String(r.id),
  framework_key: String(r.framework_key),
  title: String(r.title),
  hook: s(r.hook),
  tags: arr(r.tags),
  sections: rec(r.sections),
  questions: arr(r.questions),
  notes: s(r.notes),
  version: Number(r.version ?? 1),
  archived: !!r.archived,
  created_at: String(r.created_at),
  updated_at: String(r.updated_at),
});

export const toQuestion = (r: Row): Question => ({
  id: String(r.id),
  text: String(r.text),
  tags: arr(r.tags),
  notes: s(r.notes),
  archived: !!r.archived,
  created_at: String(r.created_at),
  updated_at: String(r.updated_at),
});

export const toJobQuestion = (r: Row): JobQuestion => ({
  id: String(r.id),
  application_id: String(r.application_id),
  question_id: s(r.question_id),
  text: String(r.text),
  position: Number(r.position ?? 0),
  created_at: String(r.created_at),
  updated_at: String(r.updated_at),
});

export const toJobStory = (r: Row): JobStory => ({
  id: String(r.id),
  application_id: String(r.application_id),
  story_id: s(r.story_id),
  source_version: n(r.source_version),
  framework_key: String(r.framework_key),
  section_defs: json<FrameworkSection[]>(r.section_defs, []),
  title: String(r.title),
  hook: s(r.hook),
  tags: arr(r.tags),
  sections: rec(r.sections),
  questions: arr(r.questions),
  notes: s(r.notes),
  angle: s(r.angle),
  base_hash: String(r.base_hash),
  position: Number(r.position ?? 0),
  created_at: String(r.created_at),
  updated_at: String(r.updated_at),
});

export const toFile = (r: Row): FileRef => ({
  id: String(r.id),
  application_id: s(r.application_id),
  event_id: s(r.event_id),
  kind: String(r.kind) as FileRef['kind'],
  filename: String(r.filename),
  content_type: String(r.content_type),
  size: Number(r.size),
  label: s(r.label),
  sha256: String(r.sha256),
  has_text: !!r.has_text,
  created_at: String(r.created_at),
  application_ids: jobsOf(r),
});

/** Every job a file is on: the one it was added to, and any it's been linked to since. */
function jobsOf(r: Row): string[] {
  const linked = r.linked_ids ? (JSON.parse(String(r.linked_ids)) as (string | null)[]) : [];
  return [...new Set([s(r.application_id), ...linked].filter((x): x is string => !!x))];
}

// A file is on a job when that job's timeline has its "File added" entry (a note pointing at it).
const FILE_COLS = `id, application_id, event_id, kind, filename, content_type, size, label, sha256,
  created_at, text IS NOT NULL AS has_text,
  (SELECT json_group_array(DISTINCT e.application_id) FROM events e
    WHERE e.type = 'note' AND json_extract(e.data, '$.file_id') = files.id) AS linked_ids`;

export const DEFAULT_SETTINGS: Settings = {
  time_zone: 'UTC',
  current_round_id: null,
  follow_up_days: 10,
  ghost_days: 30,
  telemetry: true,
  updates_set_up: false,
};

export async function loadSettings(db: D1Database): Promise<Settings> {
  const [rows, kit] = await Promise.all([
    all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings'),
    kitState(db),
  ]);
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const int = (k: string, d: number) => {
    const v = Number.parseInt(m.get(k) ?? '', 10);
    return Number.isFinite(v) ? v : d;
  };
  const cur = m.get('current_round_id');
  return {
    time_zone: m.get('time_zone') ?? DEFAULT_SETTINGS.time_zone,
    current_round_id: cur && cur !== 'null' ? cur.replace(/^"|"$/g, '') : null,
    follow_up_days: int('follow_up_days', DEFAULT_SETTINGS.follow_up_days),
    ghost_days: int('ghost_days', DEFAULT_SETTINGS.ghost_days),
    telemetry: kit.telemetry,
    updates_set_up: kit.updates_set_up,
  };
}

export async function saveSetting(db: D1Database, key: string, value: string) {
  await db
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .bind(key, value)
    .run();
}

export const loadRounds = async (db: D1Database) =>
  (await all(db, 'SELECT * FROM rounds ORDER BY created_at DESC')).map(toRound);

export async function loadApplications(db: D1Database, id?: string) {
  return (
    await all(
      db,
      `SELECT * FROM applications${id ? ' WHERE id = ?' : ''} ORDER BY last_activity_at DESC`,
      ...(id ? [id] : []),
    )
  ).map(toApplication);
}

export async function loadApplication(db: D1Database, id: string) {
  return (await loadApplications(db, id))[0] ?? null;
}

export async function loadEvents(db: D1Database, applicationId?: string) {
  return (
    await all(
      db,
      `SELECT * FROM events${applicationId ? ' WHERE application_id = ?' : ''} ORDER BY occurred_at DESC, created_at DESC`,
      ...(applicationId ? [applicationId] : []),
    )
  ).map(toEvent);
}

export async function loadEvent(db: D1Database, id: string) {
  const r = await first(db, 'SELECT * FROM events WHERE id = ?', id);
  return r ? toEvent(r) : null;
}

export async function loadFrameworks(db: D1Database): Promise<Framework[]> {
  return allFrameworks(
    (await all(db, 'SELECT * FROM frameworks ORDER BY created_at')).map(toFramework),
  );
}

export async function loadStory(db: D1Database, id: string) {
  const r = await first(db, 'SELECT * FROM stories WHERE id = ?', id);
  return r ? toStory(r) : null;
}

export async function loadJobStory(db: D1Database, id: string) {
  const r = await first(db, 'SELECT * FROM job_stories WHERE id = ?', id);
  return r ? toJobStory(r) : null;
}

export async function loadFile(db: D1Database, id: string) {
  const r = await first(db, `SELECT ${FILE_COLS} FROM files WHERE id = ?`, id);
  return r ? toFile(r) : null;
}

export async function loadState(db: D1Database): Promise<AppState> {
  const [
    settings,
    rounds,
    applications,
    companies,
    people,
    events,
    frameworks,
    stories,
    jobStories,
    questions,
    jobQuestions,
    files,
  ] = await Promise.all([
    loadSettings(db),
    loadRounds(db),
    loadApplications(db),
    all(db, 'SELECT * FROM companies ORDER BY name COLLATE NOCASE').then((r) => r.map(toCompany)),
    loadPeople(db),
    loadEvents(db),
    loadFrameworks(db),
    all(db, 'SELECT * FROM stories ORDER BY updated_at DESC').then((r) => r.map(toStory)),
    all(db, 'SELECT * FROM job_stories ORDER BY application_id, position, created_at').then((r) =>
      r.map(toJobStory),
    ),
    all(db, 'SELECT * FROM questions ORDER BY created_at').then((r) => r.map(toQuestion)),
    all(db, 'SELECT * FROM job_questions ORDER BY application_id, position, created_at').then((r) =>
      r.map(toJobQuestion),
    ),
    all(db, `SELECT ${FILE_COLS} FROM files ORDER BY created_at DESC`).then((r) => r.map(toFile)),
  ]);
  return {
    settings,
    rounds,
    applications,
    companies,
    people,
    events,
    frameworks,
    stories,
    job_stories: jobStories,
    questions,
    job_questions: jobQuestions,
    files,
  };
}

/**
 * Recomputes an application's cached status, closed_from and last activity from its timeline.
 * Called after any timeline change.
 */
/** Everyone, each with every job they're on. */
export async function loadPeople(db: D1Database, id?: string): Promise<Person[]> {
  const [rows, links] = await Promise.all([
    all(
      db,
      `SELECT * FROM people${id ? ' WHERE id = ?' : ''} ORDER BY created_at`,
      ...(id ? [id] : []),
    ),
    all<{ application_id: string; person_id: string }>(
      db,
      `SELECT application_id, person_id FROM job_people${id ? ' WHERE person_id = ?' : ''} ORDER BY created_at`,
      ...(id ? [id] : []),
    ),
  ]);
  const by = new Map<string, string[]>();
  for (const l of links) by.set(l.person_id, [...(by.get(l.person_id) ?? []), l.application_id]);
  return rows.map((r) => toPerson(r, by.get(String(r.id)) ?? []));
}

export async function refreshApplication(db: D1Database, id: string): Promise<void> {
  const app = await first<{ created_at: string }>(
    db,
    'SELECT created_at FROM applications WHERE id = ?',
    id,
  );
  if (!app) return;
  // Something logged from before tracking started (a backfilled "thanks for applying"): the
  // created event moves back to it, so the timeline still starts with it.
  await db
    .prepare(
      "UPDATE events SET occurred_at = (SELECT MIN(occurred_at) FROM events WHERE application_id = ?1) WHERE application_id = ?1 AND type = 'created'",
    )
    .bind(id)
    .run();
  const events = await loadEvents(db, id);
  const { status, closed_from } = deriveStatus(events);
  // Moving to another lane drops its hand-set place there (it goes to the top of the new lane).
  await db
    .prepare(
      'UPDATE applications SET status = ?1, closed_from = ?2, last_activity_at = ?3, board_position = CASE WHEN status = ?1 THEN board_position ELSE NULL END WHERE id = ?4',
    )
    .bind(status, closed_from, lastActivity(events, '') || app.created_at, id)
    .run();
}

/** The current round, making a first one if there are none. */
export async function currentRoundId(db: D1Database): Promise<string> {
  const s = await loadSettings(db);
  if (
    s.current_round_id &&
    (await first(db, 'SELECT id FROM rounds WHERE id = ?', s.current_round_id))
  )
    return s.current_round_id;
  const open = await first<{ id: string }>(
    db,
    "SELECT id FROM rounds WHERE status = 'active' ORDER BY created_at DESC LIMIT 1",
  );
  if (open) {
    await saveSetting(db, 'current_round_id', open.id);
    return open.id;
  }
  const id = newId();
  const now = nowIso();
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(),
  );
  await insertStmt(db, 'rounds', {
    id,
    name: `Round · ${month}`,
    status: 'active',
    started_on: now.slice(0, 10),
    created_at: now,
    updated_at: now,
  }).run();
  await saveSetting(db, 'current_round_id', id);
  return id;
}
