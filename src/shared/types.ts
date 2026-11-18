import type { FrameworkSection } from './frameworks';
import type {
  EmailCategory,
  EventType,
  FileKind,
  MeetingKind,
  MeetingState,
  PersonRole,
  SalaryPeriod,
  SearchStatus,
  Status,
  WorkMode,
} from './lookups';

export interface Settings {
  /** IANA zone the app last reported, so assistants see local dates and times. */
  time_zone: string;
  /** The search the app shows and new applications join. */
  current_search_id: string | null;
  /** An open application with no activity for this many days is due a follow-up. */
  follow_up_days: number;
  /** After this many quiet days, it counts as maybe ghosted (you or an assistant confirm). */
  ghost_days: number;
  /** Send the anonymous daily check-in (counts only). */
  telemetry: boolean;
  /** Someone added the update workflow to this copy's GitHub repo, from Settings → Updates. */
  updates_set_up: boolean;
}

/** A stretch of looking for work. Applications belong to one. */
export interface Search {
  id: string;
  name: string;
  status: SearchStatus;
  started_on: string | null;
  ended_on: string | null;
  notes: string | null;
  created_at: string;
}

export interface Application {
  id: string;
  search_id: string;
  /** Cached from the timeline: the latest status event wins. Change it with a status event. */
  status: Status;
  /** For Rejected, Declined and Ghosted: the open stage it closed from. */
  closed_from: Status | null;
  title: string;
  company: string;
  company_domain: string | null;
  company_website: string | null;
  company_linkedin: string | null;
  company_hq: string | null;
  company_size: string | null;
  company_industry: string | null;
  company_funding: string | null;
  url: string | null;
  source: string | null;
  location: string | null;
  work_mode: WorkMode | null;
  seniority: string | null;
  reports_to: string | null;
  team: string | null;
  employment_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: SalaryPeriod | null;
  /** Comp as the posting wrote it, when it doesn't fit min/max ("$205k + 15% bonus"). */
  salary_text: string | null;
  posted_on: string | null;
  /** The posting's text, kept because postings disappear. */
  description: string | null;
  must_haves: string[];
  nice_to_haves: string[];
  /** Field names an assistant inferred rather than read off the posting. */
  inferred: string[];
  applied_on: string | null;
  /** The resume file sent with it. */
  resume_file_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** The newest timeline event's time (or created_at). */
  last_activity_at: string;
}

export interface Person {
  id: string;
  application_id: string;
  name: string;
  email: string | null;
  title: string | null;
  role: PersonRole;
  /** Typed in when role is other; shown in its place. */
  other_role: string | null;
  linkedin: string | null;
  notes: string | null;
  created_at: string;
}

export interface Attendee {
  name: string;
  title?: string | null;
  email?: string | null;
}

export interface MeetingData {
  kind: MeetingKind;
  state: MeetingState;
  ends_at: string | null;
  timezone: string | null;
  join_url: string | null;
  location: string | null;
  attendees: Attendee[];
  agenda: string | null;
}

export interface EmailData {
  direction: 'in' | 'out';
  category: EmailCategory;
  counterpart_name: string | null;
  counterpart_email: string | null;
  subject: string | null;
  key_points: string[];
  thread_ref: string | null;
  link: string | null;
}

export interface StatusData {
  from: Status | null;
  to: Status;
  reason: string | null;
  /** The event (usually an email) that caused it. */
  caused_by: string | null;
}

export type EventData = MeetingData | EmailData | StatusData | Record<string, never>;

/** One card on an application's timeline. */
export interface TimelineEvent {
  id: string;
  application_id: string;
  type: EventType;
  /** When it happened (or, for a meeting, when it starts). Not when it was logged. */
  occurred_at: string;
  title: string | null;
  body: string | null;
  source: 'manual' | 'agent';
  /** Which assistant wrote it, when source is agent. */
  source_name: string | null;
  /** The Gmail message id, calendar event id or similar; the app refuses exact repeats. */
  external_ref: string | null;
  /** A note attached to another event (a debrief under its meeting). */
  parent_id: string | null;
  data: EventData;
  created_at: string;
  updated_at: string;
}

export interface Framework {
  key: string;
  name: string;
  group: string;
  blurb: string;
  sections: FrameworkSection[];
  /** Unused (the probable-questions idea was dropped); the column stays for old data. */
  questions: string[];
  builtin: boolean;
}

/** A story in the bank: a template that gets copied to jobs. */
export interface Story {
  id: string;
  framework_key: string;
  title: string;
  /**
   * Hook, tags (competencies) and questions are no longer shown, edited or searched: a story is
   * its parts. The columns stay (unused, still exported) rather than a migration.
   */
  hook: string | null;
  tags: string[];
  sections: Record<string, string>;
  questions: string[];
  notes: string | null;
  /** Goes up by one each time the content changes. Job copies remember the version they came from. */
  version: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

/** A story copied to one application, edited freely there. */
export interface JobStory {
  id: string;
  application_id: string;
  /** The bank story it came from (null for a job-only story, or after the bank story is deleted). */
  story_id: string | null;
  source_version: number | null;
  framework_key: string;
  /** The framework's sections when it was copied, so later framework edits don't break it. */
  section_defs: FrameworkSection[];
  title: string;
  hook: string | null;
  tags: string[];
  sections: Record<string, string>;
  questions: string[];
  notes: string | null;
  /** How to frame it for this job. Job-only; never counts as an edit. */
  angle: string | null;
  /** Content hash when it was copied, pulled or pushed: differs from now once edited here. */
  base_hash: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface FileRef {
  id: string;
  application_id: string | null;
  /** A transcript's meeting. */
  event_id: string | null;
  kind: FileKind;
  filename: string;
  content_type: string;
  size: number;
  label: string | null;
  sha256: string;
  /** Text was kept (transcripts and other text files), readable through /api/files/:id/text. */
  has_text: boolean;
  created_at: string;
}

export interface AppState {
  settings: Settings;
  searches: Search[];
  applications: Application[];
  people: Person[];
  events: TimelineEvent[];
  frameworks: Framework[];
  stories: Story[];
  job_stories: JobStory[];
  files: FileRef[];
}
