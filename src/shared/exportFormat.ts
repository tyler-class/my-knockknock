// The backup format: raw rows per table, in insert order (parents first). Files stay in R2; a
// backup carries their metadata (and kept text), so restoring into the same deployment keeps
// them attached.

export const EXPORT_FORMAT = 'knockknock';
/** 2: "searches" became "rounds" (the table, round_id, current_round_id). */
export const EXPORT_VERSION = 2;

export const TABLE_COLUMNS = {
  settings: ['key', 'value'],
  rounds: ['id', 'name', 'status', 'started_on', 'ended_on', 'notes', 'created_at', 'updated_at'],
  companies: [
    'id',
    'name',
    'website',
    'linkedin',
    'hq',
    'size',
    'industry',
    'funding',
    'logo_key',
    'logo_type',
    'logo_color',
    'created_at',
    'updated_at',
  ],
  applications: [
    'id',
    'round_id',
    'status',
    'closed_from',
    'title',
    'company',
    'company_domain',
    'company_website',
    'company_linkedin',
    'company_hq',
    'company_size',
    'company_industry',
    'company_funding',
    'url',
    'source',
    'location',
    'work_mode',
    'seniority',
    'reports_to',
    'team',
    'employment_type',
    'salary_min',
    'salary_max',
    'salary_currency',
    'salary_period',
    'salary_text',
    'posted_on',
    'description',
    'must_haves',
    'nice_to_haves',
    'inferred',
    'applied_on',
    'resume_file_id',
    'notes',
    'created_at',
    'updated_at',
    'last_activity_at',
    'board_position',
    'company_id',
  ],
  people: [
    'id',
    'application_id',
    'company_id',
    'name',
    'email',
    'title',
    'role',
    'other_role',
    'linkedin',
    'notes',
    'created_at',
    'updated_at',
  ],

  job_people: ['application_id', 'person_id', 'created_at'],
  events: [
    'id',
    'application_id',
    'type',
    'occurred_at',
    'title',
    'body',
    'source',
    'source_name',
    'external_ref',
    'parent_id',
    'data',
    'created_at',
    'updated_at',
  ],
  frameworks: ['key', 'name', 'blurb', 'sections', 'questions', 'created_at', 'updated_at'],
  stories: [
    'id',
    'framework_key',
    'title',
    'hook',
    'tags',
    'sections',
    'questions',
    'notes',
    'version',
    'archived',
    'created_at',
    'updated_at',
  ],
  job_stories: [
    'id',
    'application_id',
    'story_id',
    'source_version',
    'framework_key',
    'section_defs',
    'title',
    'hook',
    'tags',
    'sections',
    'questions',
    'notes',
    'angle',
    'base_hash',
    'position',
    'created_at',
    'updated_at',
  ],
  questions: ['id', 'text', 'tags', 'notes', 'archived', 'created_at', 'updated_at'],
  job_questions: [
    'id',
    'application_id',
    'question_id',
    'text',
    'position',
    'created_at',
    'updated_at',
  ],
  // Unused since 0.1.2 (the "told" marks were removed). The table stays in D1 and in exports
  // so older data still round-trips; nothing reads or writes it any more.
  story_tells: ['id', 'job_story_id', 'event_id', 'told_at', 'heard_by', 'note', 'created_at'],
  files: [
    'id',
    'application_id',
    'event_id',
    'kind',
    'r2_key',
    'filename',
    'content_type',
    'size',
    'label',
    'sha256',
    'text',
    'created_at',
  ],
} as const;

export type TableName = keyof typeof TABLE_COLUMNS;
export const TABLE_ORDER = Object.keys(TABLE_COLUMNS) as TableName[];
/** Never exported or overwritten: the session salt is per deployment. */
export const PRIVATE_SETTINGS = ['session_salt'];

export type Cell = string | number | null;
export type ExportRow = Record<string, Cell | boolean | undefined>;

export interface KnockKnockExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  exported_at: string;
  tables: Partial<Record<TableName, ExportRow[]>>;
}

export function isKnockKnockExport(v: unknown): v is KnockKnockExport {
  const o = v as KnockKnockExport;
  return (
    !!o &&
    o.format === EXPORT_FORMAT &&
    typeof o.version === 'number' &&
    !!o.tables &&
    typeof o.tables === 'object'
  );
}

/** Column names and values for one row, keeping only known columns. */
export function rowValues(table: TableName, row: ExportRow): { cols: string[]; vals: Cell[] } {
  const cols: string[] = [];
  const vals: Cell[] = [];
  for (const c of TABLE_COLUMNS[table]) {
    if (c in row) {
      const v = row[c];
      cols.push(c);
      vals.push(v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
    }
  }
  return { cols, vals };
}

/**
 * An older backup in today's shape: version 1 called rounds "searches" (its table, the
 * applications' search_id and the current_search_id setting). Newer ones pass through as they are.
 */
export function upgradeExport(data: KnockKnockExport): KnockKnockExport {
  if (data.version >= 2) return data;
  const t = { ...data.tables } as Record<string, ExportRow[] | undefined>;
  if (t.searches && !t.rounds) t.rounds = t.searches;
  delete t.searches;
  t.applications = t.applications?.map(({ search_id, ...r }) =>
    'round_id' in r ? r : { ...r, round_id: search_id },
  );
  t.settings = t.settings?.map((r) =>
    r.key === 'current_search_id' ? { ...r, key: 'current_round_id' } : r,
  );
  return { ...data, version: EXPORT_VERSION, tables: t as KnockKnockExport['tables'] };
}
