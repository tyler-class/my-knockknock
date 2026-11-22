// Fixed lists: statuses, event kinds, roles and file kinds. Labels live here so the app,
// the API and the MCP server say the same words.

export const STATUSES = [
  { key: 'saved', label: 'Saved', open: true, tone: 'saved' },
  { key: 'applied', label: 'Applied', open: true, tone: 'applied' },
  { key: 'screening', label: 'Screening', open: true, tone: 'screening' },
  { key: 'interviewing', label: 'Interviewing', open: true, tone: 'interviewing' },
  { key: 'offer', label: 'Offer', open: true, tone: 'offer' },
  { key: 'accepted', label: 'Accepted', open: false, tone: 'accepted' },
  { key: 'rejected', label: 'Rejected', open: false, tone: 'rejected' },
  { key: 'declined', label: 'Declined', open: false, tone: 'declined' },
  { key: 'ghosted', label: 'Ghosted', open: false, tone: 'ghosted' },
] as const;

export type Status = (typeof STATUSES)[number]['key'];
export const STATUS_KEYS = STATUSES.map((s) => s.key) as [Status, ...Status[]];
/** The pipeline, in order. */
export const OPEN_STATUSES: Status[] = ['saved', 'applied', 'screening', 'interviewing', 'offer'];
/** Ways an application ends without a signature. Each records the stage it closed from. */
export const CLOSED_STATUSES: Status[] = ['rejected', 'declined', 'ghosted'];
export const statusLabel = (s: string) => STATUSES.find((x) => x.key === s)?.label ?? s;
export const isOpen = (s: Status) => OPEN_STATUSES.includes(s);
/** Position in the pipeline (Accepted is past Offer); closed statuses have none. */
export const stageIndex = (s: Status) =>
  s === 'accepted' ? OPEN_STATUSES.length : OPEN_STATUSES.indexOf(s);

export const SEARCH_STATUSES = ['active', 'accepted', 'ended'] as const;
export type SearchStatus = (typeof SEARCH_STATUSES)[number];

export const WORK_MODES = [
  { key: 'remote', label: 'Remote' },
  { key: 'hybrid', label: 'Hybrid' },
  { key: 'onsite', label: 'On-site' },
] as const;
export type WorkMode = (typeof WORK_MODES)[number]['key'];
export const WORK_MODE_KEYS = WORK_MODES.map((w) => w.key) as [WorkMode, ...WorkMode[]];

export const SALARY_PERIODS = ['year', 'month', 'hour'] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

/** Suggestions for where an application came from (free text is fine too). */
export const SOURCES = [
  'LinkedIn',
  'Company site',
  'Referral',
  'Recruiter',
  'Job board',
  'Network',
  'Other',
];

export const EVENT_TYPES = ['created', 'status', 'meeting', 'email', 'note'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
/** The kinds people and assistants log by hand; created and status come from the app itself. */
export const LOGGABLE_TYPES = ['meeting', 'email', 'note'] as const;

export const MEETING_KINDS = [
  { key: 'recruiter_screen', label: 'Recruiter screen' },
  { key: 'hiring_manager', label: 'Hiring manager' },
  { key: 'technical', label: 'Technical' },
  { key: 'panel', label: 'Panel' },
  { key: 'final', label: 'Final round' },
  { key: 'other', label: 'Other' },
] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number]['key'];
export const MEETING_KIND_KEYS = MEETING_KINDS.map((k) => k.key) as [MeetingKind, ...MeetingKind[]];
export const meetingKindLabel = (k: string) => MEETING_KINDS.find((x) => x.key === k)?.label ?? k;

export const MEETING_STATES = ['scheduled', 'held', 'canceled'] as const;
export type MeetingState = (typeof MEETING_STATES)[number];

export const EMAIL_CATEGORIES = [
  { key: 'confirmation', label: 'Confirmation' },
  { key: 'scheduling', label: 'Scheduling' },
  { key: 'follow_up', label: 'Follow-up' },
  { key: 'thank_you', label: 'Thank-you' },
  { key: 'rejection', label: 'Rejection' },
  { key: 'offer', label: 'Offer' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'other', label: 'Other' },
] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number]['key'];
export const EMAIL_CATEGORY_KEYS = EMAIL_CATEGORIES.map((k) => k.key) as [
  EmailCategory,
  ...EmailCategory[],
];
export const emailCategoryLabel = (k: string) =>
  EMAIL_CATEGORIES.find((x) => x.key === k)?.label ?? k;

export const PERSON_ROLES = [
  { key: 'recruiter', label: 'Recruiter' },
  { key: 'hiring_manager', label: 'Hiring manager' },
  { key: 'interviewer', label: 'Interviewer' },
  { key: 'referrer', label: 'Referrer' },
  { key: 'other', label: 'Other' },
] as const;
export type PersonRole = (typeof PERSON_ROLES)[number]['key'];
export const PERSON_ROLE_KEYS = PERSON_ROLES.map((r) => r.key) as [PersonRole, ...PersonRole[]];
export const roleLabel = (k: string) => PERSON_ROLES.find((x) => x.key === k)?.label ?? k;
/** A person's role as shown: their own words in place of "Other" when given. */
export const personRoleLabel = (p: { role: string; other_role?: string | null }) =>
  p.role === 'other' && p.other_role ? p.other_role : roleLabel(p.role);

export const FILE_KINDS = [
  { key: 'resume', label: 'Resume' },
  { key: 'cover_letter', label: 'Cover letter' },
  { key: 'transcript', label: 'Transcript' },
  { key: 'offer', label: 'Offer letter' },
  { key: 'posting', label: 'Posting copy' },
  { key: 'other', label: 'Other' },
] as const;
export type FileKind = (typeof FILE_KINDS)[number]['key'];
export const FILE_KIND_KEYS = FILE_KINDS.map((k) => k.key) as [FileKind, ...FileKind[]];
export const fileKindLabel = (k: string) => FILE_KINDS.find((x) => x.key === k)?.label ?? k;

/** Common industries, offered when filling in a company's (any other can be typed in). */
export const INDUSTRIES = [
  'Software',
  'SaaS',
  'Artificial Intelligence',
  'Cybersecurity',
  'Fintech',
  'Financial Services',
  'Banking',
  'Insurance',
  'Healthcare',
  'Health Tech',
  'Biotech',
  'Pharmaceuticals',
  'Medical Devices',
  'E-commerce',
  'Retail',
  'Consumer Goods',
  'Marketplaces',
  'Media & Entertainment',
  'Gaming',
  'Advertising & Marketing',
  'Education',
  'EdTech',
  'Government',
  'Nonprofit',
  'Consulting',
  'Professional Services',
  'Legal',
  'Real Estate',
  'Construction',
  'Manufacturing',
  'Automotive',
  'Aerospace & Defense',
  'Energy',
  'Climate & Clean Tech',
  'Utilities',
  'Telecommunications',
  'Transportation & Logistics',
  'Travel & Hospitality',
  'Food & Beverage',
  'Agriculture',
  'Hardware',
  'Semiconductors',
  'Data & Analytics',
  'Developer Tools',
  'HR & Recruiting',
  'Sports & Fitness',
  'Crypto & Web3',
] as const;

/** Employment types offered for a job (anything else can be kept as written). */
export const EMPLOYMENT_TYPES = [
  'Full-time',
  'Part-time',
  'Contract',
  'Contract-to-hire',
  'Internship',
] as const;
