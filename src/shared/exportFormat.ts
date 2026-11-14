// The backup format: raw rows per table, in insert order (parents first). Files stay in R2; a
// backup carries their metadata (and kept text), so restoring into the same deployment keeps
// them attached.

export const EXPORT_FORMAT = 'knockknock';
export const EXPORT_VERSION = 1;

export const TABLE_COLUMNS = {
  settings: ['key', 'value'],
  searches: [
    'id',
    'name',
    'status',
    'started_on',
    'ended_on',
    'weekly_goal',
    'notes',
    'created_at',
    'updated_at',
  ],
  applications: [
    'id',
    'search_id',
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
  ],
  people: [
    'id',
    'application_id',
    'name',
    'email',
    'title',
    'role',
    'linkedin',
    'notes',
    'created_at',
    'updated_at',
  ],
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
    'locked',
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
