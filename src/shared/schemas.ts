// Request bodies. Shared so the client, the Worker and the MCP server agree on shapes.
import { z } from 'zod';
import { withScheme } from './url';
import { LOGO_COLOR_KEYS } from './logo';
import {
  EMAIL_CATEGORY_KEYS,
  FILE_KIND_KEYS,
  MEETING_KIND_KEYS,
  MEETING_STATES,
  PERSON_ROLE_KEYS,
  SALARY_PERIODS,
  SEARCH_STATUSES,
  STATUS_KEYS,
  WORK_MODE_KEYS,
} from './lookups';

/** Optional text: blank becomes null, so clearing a field in a form clears it in the database. */
export const text = (max = 2000) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v.trim() === '' ? null : v.trim()));
const name = (max = 200) => z.string().trim().min(1, 'Required').max(max);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .nullish()
  .transform((v) => v ?? null);
/** An instant: ISO 8601 with an offset or Z. The API stores it as UTC. */
const instant = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Use an ISO 8601 timestamp')
  .transform((v) => new Date(v).toISOString());
const money = z
  .number()
  .min(0)
  .max(100_000_000)
  .nullish()
  .transform((v) => v ?? null);
const list = (max = 40, each = 300) =>
  z
    .array(z.string().trim().min(1).max(each))
    .max(max)
    .transform((a) => [...new Set(a)]);
/**
 * A link. "acme.com" and "www.acme.com" are fine: without a scheme it's taken as https. Only
 * http(s) links with a real-looking host are kept.
 */
// In its own module so the client can use it without bundling zod.
export { withScheme };
const url = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v ? withScheme(v) : null))
  .refine(
    (v) => v === null || /^https?:\/\/[^\s/.]+\.[^\s]+/i.test(v),
    'That doesn’t look like a link',
  );
const externalRef = text(500);

export const loginInput = z.object({ password: z.string().min(1).max(500) });

export const settingsPatch = z
  .object({
    time_zone: z.string().min(1).max(100),
    current_round_id: z.string().max(100).nullable(),
    follow_up_days: z.number().int().min(1).max(90),
    ghost_days: z.number().int().min(7).max(365),
    telemetry: z.boolean(),
    updates_set_up: z.boolean(),
  })
  .partial();

// ---------- rounds ----------

export const roundInput = z.object({
  name: name(120),
  status: z.enum(SEARCH_STATUSES).default('active'),
  started_on: day,
  ended_on: day,
  notes: text(4000),
});
export const roundPatch = roundInput.partial();

// ---------- applications ----------

const applicationFields = {
  title: name(300),
  company: name(200),
  company_domain: text(200),
  company_website: url,
  company_linkedin: url,
  company_hq: text(200),
  company_size: text(100),
  company_industry: text(200),
  company_funding: text(200),
  url,
  source: text(100),
  location: text(300),
  work_mode: z
    .enum(WORK_MODE_KEYS)
    .nullish()
    .transform((v) => v ?? null),
  seniority: text(100),
  reports_to: text(200),
  team: text(500),
  employment_type: text(100),
  salary_min: money,
  salary_max: money,
  salary_currency: text(10),
  salary_period: z
    .enum(SALARY_PERIODS)
    .nullish()
    .transform((v) => v ?? null),
  salary_text: text(300),
  posted_on: day,
  description: text(100_000),
  must_haves: list(),
  nice_to_haves: list(),
  inferred: list(60, 60),
  applied_on: day,
  resume_file_id: z
    .string()
    .max(100)
    .nullish()
    .transform((v) => v ?? null),
  notes: text(20_000),
};

export const applicationInput = z.object({
  ...applicationFields,
  must_haves: applicationFields.must_haves.default([]),
  nice_to_haves: applicationFields.nice_to_haves.default([]),
  inferred: applicationFields.inferred.default([]),
  /** Defaults to the current search. */
  round_id: z.string().max(100).optional(),
  /** Where it starts. Saved unless you're logging one you already sent. */
  status: z.enum(STATUS_KEYS).default('saved'),
  /** When the created event happened (defaults to now; backfills can set it). */
  occurred_at: instant.optional(),
});
export const applicationPatch = z
  .object({ ...applicationFields, round_id: z.string().max(100) })
  .partial();

export const statusInput = z.object({
  status: z.enum(STATUS_KEYS),
  occurred_at: instant.optional(),
  reason: text(1000),
  caused_by: z.string().max(100).nullish(),
  external_ref: externalRef,
  /** With Accepted: also mark the search Accepted. Only when the owner said yes. */
  close_round: z.boolean().optional(),
});

// ---------- timeline ----------

const attendee = z.object({
  name: z.string().trim().min(1).max(200),
  title: text(200),
  email: text(200),
});

const meetingFields = {
  title: name(300),
  occurred_at: instant,
  body: text(20_000),
  kind: z.enum(MEETING_KIND_KEYS).default('other'),
  state: z.enum(MEETING_STATES).optional(),
  ends_at: instant.nullish().transform((v) => v ?? null),
  timezone: text(100),
  join_url: url,
  location: text(500),
  attendees: z.array(attendee).max(30).default([]),
  agenda: text(10_000),
};
export const meetingInput = z.object({
  ...meetingFields,
  external_ref: externalRef,
});
export const meetingPatch = z
  .object({
    ...meetingFields,
    kind: z.enum(MEETING_KIND_KEYS),
    state: z.enum(MEETING_STATES),
    attendees: z.array(attendee).max(30),
    external_ref: externalRef,
  })
  .partial();

const emailFields = {
  direction: z.enum(['in', 'out']),
  occurred_at: instant,
  category: z.enum(EMAIL_CATEGORY_KEYS).default('other'),
  counterpart_name: text(200),
  counterpart_email: text(200),
  subject: text(500),
  /** What happened: a summary, not the whole email. */
  body: text(10_000),
  key_points: list(20, 300).default([]),
  thread_ref: text(500),
  link: url,
};
export const emailInput = z.object({
  ...emailFields,
  external_ref: externalRef,
});
export const emailPatch = z
  .object({
    ...emailFields,
    category: z.enum(EMAIL_CATEGORY_KEYS),
    key_points: list(20, 300),
    external_ref: externalRef,
  })
  .partial();

export const noteInput = z.object({
  body: z.string().trim().min(1, 'Write something').max(20_000),
  title: text(300),
  occurred_at: instant.optional(),
  parent_id: z.string().max(100).nullish(),
  external_ref: externalRef,
});
export const notePatch = z
  .object({
    body: z.string().trim().min(1).max(20_000),
    title: text(300),
    occurred_at: instant,
    parent_id: z.string().max(100).nullable(),
  })
  .partial();

// ---------- people ----------

export const personInput = z.object({
  name: name(200),
  email: text(200),
  title: text(200),
  role: z.enum(PERSON_ROLE_KEYS).default('other'),
  /** What the role is when role is other ("Head of Talent", "Board member"). */
  other_role: text(100),
  linkedin: url,
  notes: text(4000),
});
export const personPatch = personInput.partial();

// ---------- stories ----------

const sectionDef = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'Section keys are lowercase letters, digits and _'),
  label: name(60),
  prompt: z.string().trim().max(300).default(''),
});

export const frameworkInput = z.object({
  name: name(60),
  blurb: z.string().trim().max(300).default(''),
  sections: z.array(sectionDef).min(1).max(12),
  questions: list(20, 300).default([]),
});
export const frameworkPatch = frameworkInput.partial();

const sections = z.record(z.string().max(40), z.string().max(10_000));

const storyFields = {
  framework_key: z.string().min(1).max(60),
  title: name(300),
  hook: text(500),
  tags: list(30, 60),
  sections,
  questions: list(30, 300),
  notes: text(10_000),
};
export const storyInput = z.object({
  ...storyFields,
  tags: storyFields.tags.default([]),
  sections: sections.default({}),
  questions: storyFields.questions.default([]),
});
export const storyPatch = z.object({ ...storyFields, archived: z.boolean() }).partial();

/** A job-only story (no bank source). */
export const jobStoryInput = storyInput.extend({ angle: text(2000) });
export const jobStoryPatch = z
  .object({ ...storyFields, angle: text(2000), position: z.number().int().min(0).max(10_000) })
  .partial();
// (storyFields has no defaults, so partial patches never reset anything.)

export const linkStoryInput = z.object({
  story_id: z.string().min(1).max(100),
  angle: text(2000),
});

// ---------- files ----------

export const filePatch = z
  .object({
    kind: z.enum(FILE_KIND_KEYS),
    label: text(200),
    event_id: z.string().max(100).nullable(),
    application_id: z.string().max(100).nullable(),
  })
  .partial();

export const uploadLinkInput = z.object({
  application_id: z.string().min(1).max(100),
  kind: z.enum(FILE_KIND_KEYS).default('resume'),
  event_id: z.string().max(100).nullish(),
});

/** A company's details (several jobs can be at one company). */
const companyFields = {
  name: name(200),
  website: url,
  linkedin: url,
  hq: text(200),
  size: text(100),
  industry: text(200),
  funding: text(200),
};
export const companyInput = z.object(companyFields);
export const companyPatch = z
  .object({
    ...companyFields,
    /** The monogram's colour; null puts it back to ultramarine. */
    logo_color: z.enum(LOGO_COLOR_KEYS).nullable(),
  })
  .partial();
/** A company logo from an image on the web (or a data: URL holding one). */
export const logoFromUrl = z.object({ url: z.string().trim().min(1).max(3_000_000) });
/** Point a job at a company: an existing one by id, or a new one by name. */
export const companyLink = z.union([
  z.object({ company_id: z.string().max(100) }),
  z.object(companyFields),
]);
/** A lane's jobs in their new order (dragged on the board). */
export const boardOrder = z.object({ ids: z.array(z.string().max(100)).min(1).max(500) });
