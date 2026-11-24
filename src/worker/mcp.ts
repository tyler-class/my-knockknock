// MCP server: lets any MCP-capable assistant keep the job search up to date. The app only
// receives: the assistant reads job postings, email and calendars, decides what happened and to
// which application, and writes it here. Tools call the same REST API the app uses (validation,
// status history and the external_ref duplicate check live there), marked internal because
// OAuthProvider already checked the token.
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  EMAIL_CATEGORY_KEYS,
  FILE_KIND_KEYS,
  MEETING_KIND_KEYS,
  MEETING_STATES,
  OPEN_STATUSES,
  PERSON_ROLE_KEYS,
  SALARY_PERIODS,
  STATUS_KEYS,
  WORK_MODE_KEYS,
  isOpen,
  personRoleLabel,
  statusLabel,
} from '@shared/lookups';
import { EXAMPLE_PROMPTS, MCP_PROMPTS } from '@shared/examples';
import {
  DEFAULT_LOGO_COLOR,
  LOGO_COLOR_KEYS,
  LOGO_COLORS,
  logoColor,
  monogram,
} from '@shared/logo';
import { searchStories, frameworkOf } from '@shared/logic/stories';
import { dayIn, parseLocal, whenIn } from '@shared/logic/tz';
import {
  ghostCandidate,
  isUpcoming,
  needsDebrief,
  needsFollowUp,
  quietDays,
  timelineView,
} from '@shared/logic/timeline';
import type {
  AppState,
  Application,
  CallQuestion,
  Company,
  EmailData,
  FileRef,
  Framework,
  JobQuestion,
  JobStory,
  MeetingData,
  Person,
  Question,
  StatusData,
  Story,
  TimelineEvent,
} from '@shared/types';
import pkg from '../../package.json';
import { app } from './app';
import { AGENT, INTERNAL } from './auth';

type Call = <T>(method: string, path: string, body?: unknown) => Promise<T>;

class ToolError extends Error {}

function apiCaller(
  origin: string,
  env: Cloudflare.Env,
  ctx: ExecutionContext,
  agent: string | null,
): Call {
  const internalEnv = { ...env, [INTERNAL]: true, [AGENT]: agent };
  return async <T>(method: string, path: string, body?: unknown) => {
    const res = await app.fetch(
      new Request(`${origin}/api${path}`, {
        method,
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      }),
      internalEnv,
      ctx,
    );
    const data = (await res.json().catch(() => null)) as T & {
      message?: string;
      details?: unknown;
    };
    if (!res.ok) {
      const extra =
        data?.details && typeof data.details === 'object' && 'event_id' in (data.details as object)
          ? ` Existing event id: ${(data.details as { event_id: string }).event_id}.`
          : '';
      throw new ToolError((data?.message ?? `Request failed (${res.status}).`) + extra);
    }
    return data;
  };
}

const out = (v: unknown) => ({
  content: [
    { type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) },
  ],
});
const fail = (e: unknown) => ({
  content: [
    { type: 'text' as const, text: e instanceof Error ? e.message : 'Something went wrong.' },
  ],
  isError: true,
});
const safe =
  <A>(fn: (a: A) => Promise<unknown>) =>
  async (a: A) => {
    try {
      return out(await fn(a));
    } catch (e) {
      return fail(e);
    }
  };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Exact id, exact name, then a unique partial match (all words present). */
function pick<T extends { id: string }>(
  list: T[],
  key: string,
  names: (t: T) => string[],
  what: string,
  describe: (t: T) => string,
  prefer?: (t: T) => boolean,
): T {
  const byId = list.find((t) => t.id === key.trim());
  if (byId) return byId;
  const k = norm(key);
  if (!k) throw new ToolError(`Say which ${what}.`);
  const exact = list.filter((t) => names(t).some((n) => norm(n) === k));
  if (exact.length === 1) return exact[0]!;
  const words = k.split(' ');
  const partial = (exact.length ? exact : list).filter((t) => {
    const hay = norm(names(t).join(' '));
    return words.every((w) => hay.includes(w));
  });
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1 && prefer) {
    const preferred = partial.filter(prefer);
    if (preferred.length === 1) return preferred[0]!;
  }
  const pool = partial.length ? partial : list;
  const options = pool.slice(0, 15).map(describe).join('; ') || 'none yet';
  throw new ToolError(
    partial.length
      ? `“${key}” matches more than one ${what}: ${options}. Be more specific or pass the id.`
      : `No ${what} matches “${key}”. Some options: ${options}.`,
  );
}

interface Ctx {
  state: AppState;
  tz: string;
  today: string;
  now: Date;
}

const money = (n: number | null, cur: string | null) =>
  n == null
    ? null
    : `${cur && cur !== 'USD' ? cur + ' ' : '$'}${n >= 1000 ? `${Math.round(n / 1000)}k` : n}`;

function comp(a: Application): string | null {
  if (a.salary_min == null && a.salary_max == null) return a.salary_text;
  const range = [money(a.salary_min, a.salary_currency), money(a.salary_max, a.salary_currency)]
    .filter(Boolean)
    .join('–');
  return `${range}${a.salary_period && a.salary_period !== 'year' ? `/${a.salary_period}` : ''}${a.salary_text ? ` (${a.salary_text})` : ''}`;
}

function appLine(a: Application, c: Ctx) {
  return {
    id: a.id,
    company: a.company,
    title: a.title,
    status: a.status,
    ...(a.closed_from ? { closed_from: a.closed_from } : {}),
    comp: comp(a),
    location: [a.work_mode, a.location].filter(Boolean).join(', ') || null,
    url: a.url,
    last_activity: whenIn(a.last_activity_at, c.tz),
    quiet_days: quietDays(a, c.now, c.state.events),
  };
}

function eventOut(e: TimelineEvent, c: Ctx) {
  const base = {
    id: e.id,
    type: e.type,
    when: whenIn(e.occurred_at, c.tz),
    occurred_at: e.occurred_at,
    ...(e.title ? { title: e.title } : {}),
    ...(e.body ? { body: e.body } : {}),
    logged_by: e.source === 'agent' ? (e.source_name ?? 'an assistant') : 'manual',
    ...(e.external_ref ? { external_ref: e.external_ref } : {}),
    ...(e.parent_id ? { about_event: e.parent_id } : {}),
  };
  if (e.type === 'meeting') {
    const d = e.data as MeetingData;
    return {
      ...base,
      kind: d.kind,
      state: d.state,
      ...(d.ends_at ? { ends: whenIn(d.ends_at, c.tz) } : {}),
      ...(d.join_url ? { join_url: d.join_url } : {}),
      ...(d.location ? { location: d.location } : {}),
      ...(d.attendees.length ? { attendees: d.attendees } : {}),
      ...(d.agenda ? { agenda: d.agenda } : {}),
      ...(d.questions?.length
        ? {
            questions: d.questions.map((q) => ({
              id: q.id,
              text: q.text,
              asked: q.asked,
              ...(q.answer ? { answer: q.answer } : {}),
            })),
          }
        : {}),
    };
  }
  if (e.type === 'email') {
    const d = e.data as EmailData;
    return {
      ...base,
      direction: d.direction,
      category: d.category,
      with: [d.counterpart_name, d.counterpart_email].filter(Boolean).join(' ') || null,
      ...(d.key_points.length ? { key_points: d.key_points } : {}),
      ...(d.thread_ref ? { thread_ref: d.thread_ref } : {}),
    };
  }
  if (e.type === 'status' || e.type === 'created') {
    const d = e.data as StatusData;
    return {
      ...base,
      ...(e.type === 'status' ? { from: d.from } : {}),
      to: d.to,
      ...(d.reason ? { reason: d.reason } : {}),
      ...(d.caused_by ? { caused_by: d.caused_by } : {}),
    };
  }
  const fileId = (e.data as { file_id?: string }).file_id;
  return fileId ? { ...base, file_id: fileId } : base;
}

function sectionsOut(defs: { key: string; label: string }[], sections: Record<string, string>) {
  return defs
    .filter((d) => sections[d.key]?.trim())
    .map((d) => ({ section: d.label, key: d.key, text: sections[d.key] }));
}

const WRITE_NOTE =
  'The answer includes `nearby`: other events on this timeline within 3 days. If one of them is the same thing you just logged, fix it now (update_event or delete_event).';

const GETTING_STARTED = `

When someone asks what you can do with Knock Knock (or seems unsure where to start), call get_started: it returns their round's current state and example requests to offer. Suggest two or three that fit, rather than listing tools. Examples:
${EXAMPLE_PROMPTS.map((e) => `- "${e.prompt}"`).join('\n')}`;

const INSTRUCTIONS =
  [
    'Knock Knock is a personal job search tracker: rounds (stretches of job hunting) → applications → a timeline per application (created, status changes, meetings, emails, notes), plus Stories, the owner’s bank of interview stories (call it Stories).',
    'Start with round_overview to see the current round, what is upcoming and what needs attention. The current round is the one last picked in the app; round_overview lists the others, and creating or finding applications in another round takes its name.',
    'You do the reading and judging; Knock Knock only stores. To read a job posting, call read_posting with its link (it gets the full text even from pages built with JavaScript) rather than fetching the page yourself. Pull out every field you can (title, company, comp, location, work mode, seniority, reports-to, team, must-haves, company basics) and list the ones you inferred rather than read in `inferred`.',
    'Applications can be named loosely ("Fathom", "fathom principal") or by id. Use find_applications to look one up from an email: by company, domain, URL or a person’s email.',
    'Status only changes through set_status, which writes a status event. Point caused_by at the email event that caused it.',
    'Before logging an email, meeting or note, call get_timeline with around set to its date (days 3, the same type) and read what is there. Same type, same people, within the window: it is probably the same thing, so update it instead of adding another. Pass external_ref (the Gmail message id or calendar event id) whenever you have one; the app refuses an exact repeat. If unsure, add a note saying what you saw instead of guessing.',
    'Log emails as summaries of what happened, not the whole email. For negotiation, put the numbers in key_points.',
    'Times without an offset are the owner’s local time.',
    'Stories: a story is just its framework’s parts (no hook, tags or probable questions). list_stories searches the bank (Stories) by the question being asked, matching titles, frameworks and the parts’ text.',
    'Questions: the owner’s questions to ask in interviews. Like stories, there is a bank (list_questions, create_question) and each application has its own list (get_application shows it), which comes up on every call for that job; a meeting also keeps its own questions with what was said (get_meeting_questions, add_meeting_question, update_meeting_question).',
    'Bank vs job-only, for stories and questions alike: link_story / link_question put a bank item on a job, linked. While it is unchanged there it follows the bank: editing the bank item updates it on the job too. Editing its content on the job (update_job_story, update_job_question) makes it a job-only variant: the job keeps the new words, the link is dropped, and the bank item never changes (a story’s angle or the order doesn’t count as an edit). create_job_story and add_job_question write one just for a job; save_job_story_to_bank / save_job_question_to_bank add a job-only one to the bank and link it. remove_job_story / remove_job_question take a linked one off the job (the bank keeps it) but delete a job-only one.',
    'Archived stories and questions are left out of list_stories, list_questions, round_overview and get_started. To find one, use list_archived_stories or list_archived_questions; if the owner asks to bring one back, call update_story or update_question with archived: false.',
    'To attach a file the person has (resume, transcript), call upload_link and give them the link; a file seen in the chat cannot be passed to a tool. For a transcript you already have as text, use add_text_file. Adding a file puts a "File added" note on the timeline (with file_id); change its time with update_event if the file belongs to an earlier moment.',
    'People work at a company and can be on several of its jobs. add_person on an application first reuses someone already at its company with the same name or email; on a company alone it adds someone on no job yet. link_person puts someone known on another job, remove_person_from_job takes them off one job only (they stay at the company). set_person_company moves someone to another company or takes them off theirs; their jobs stay. find_people searches everyone. People have a role (recruiter, hiring_manager, interviewer, referrer or other); for other, put their actual role in other_role.',
    'Companies are their own records: get_company shows one with its jobs and people, update_company changes its details (every job there follows). A company name written to an application (update_application) links the job to the company of that name, or makes one.',
    'Hard deletes (delete_application, delete_company, delete_person, delete_story, delete_question, delete_file, and removing a job-only story or question) can’t be undone: say what will go and get the owner’s yes first.',
    'Companies show their logo, or without one a monogram (their initial) on an ultramarine tile. set_company_logo attaches a logo from an image on the web (find the company’s own logo and pass the image’s address) and sets the monogram’s color: if you know the brand color you may pick the closest of the ten, otherwise leave the default.',
  ].join(' ') + GETTING_STARTED;

/** A job's question: from_bank when it's linked to (and follows) a bank question. */
const jobQuestionOut = (j: JobQuestion) => ({
  id: j.id,
  text: j.text,
  from_bank: !!j.question_id,
  ...(j.question_id ? { bank_question: j.question_id } : {}),
  position: j.position,
});

/** Best matches first: the more of the query's words a text has, the higher. */
function searchText<T>(list: T[], query: string, text: (t: T) => string): T[] {
  const words = norm(query)
    .split(' ')
    .filter((w) => w.length > 2);
  if (!words.length) return list;
  return list
    .map((t) => {
      const hay = norm(text(t));
      return { t, n: words.filter((w) => hay.includes(w)).length };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.t);
}

/** How a company shows in the app: its logo, or its monogram and the monogram's color. */
function companyMark(co: Company) {
  return co.has_logo
    ? { logo: 'uploaded' }
    : { logo: 'none', monogram: monogram(co.name), color: logoColor(co.logo_color).key };
}

function buildServer(call: Call) {
  const server = new McpServer(
    { name: 'knockknock', version: pkg.version },
    { instructions: INSTRUCTIONS },
  );

  async function load(): Promise<Ctx> {
    const state = await call<AppState>('GET', '/state');
    const tz = state.settings.time_zone || 'UTC';
    const now = new Date();
    return { state, tz, today: dayIn(now, tz), now };
  }

  const findApp = (c: Ctx, key: string) =>
    pick(
      c.state.applications,
      key,
      (a) => [a.company, `${a.company} ${a.title}`, a.title, a.company_domain ?? '', a.url ?? ''],
      'application',
      (a) => `${a.company} · ${a.title} [${a.status}, id ${a.id}]`,
      (a) => isOpen(a.status),
    );

  /** A company by name or id, or the company of an application named that way. */
  const findCompany = (c: Ctx, key: string): Company => {
    try {
      return pick(
        c.state.companies,
        key,
        (co) => [co.name, co.website ?? ''],
        'company',
        (co) => `${co.name} [id ${co.id}]`,
      );
    } catch (e) {
      const a = (() => {
        try {
          return findApp(c, key);
        } catch {
          return null;
        }
      })();
      const co = a && c.state.companies.find((x) => x.id === a.company_id);
      if (co) return co;
      throw e;
    }
  };

  const findStory = (c: Ctx, key: string, includeArchived = false) =>
    pick(
      c.state.stories.filter((s) => includeArchived || !s.archived),
      key,
      (s) => [s.title],
      'bank story',
      (s) => `${s.title} [${s.framework_key}, id ${s.id}]`,
    );

  const findJobStory = (c: Ctx, key: string, appKey?: string) => {
    const pool = appKey
      ? c.state.job_stories.filter((j) => j.application_id === findApp(c, appKey).id)
      : c.state.job_stories;
    return pick(
      pool,
      key,
      (j) => [j.title],
      'story on that application',
      (j) => `${j.title} [id ${j.id}]`,
    );
  };

  const findFramework = (c: Ctx, key: string): Framework => {
    const fw = c.state.frameworks.find((f) => f.key === key || norm(f.name) === norm(key));
    if (!fw) throw new ToolError(`No framework “${key}”. Use list_frameworks.`);
    return fw;
  };

  const findQuestion = (c: Ctx, key: string, includeArchived = false) =>
    pick(
      c.state.questions.filter((q) => includeArchived || !q.archived),
      key,
      (q) => [q.text],
      'bank question',
      (q) => `“${q.text}” [id ${q.id}]`,
    );

  const findJobQuestion = (c: Ctx, key: string, appKey: string) => {
    const a = findApp(c, appKey);
    return pick(
      c.state.job_questions.filter((j) => j.application_id === a.id),
      key,
      (j) => [j.text],
      'question on that application',
      (j) => `“${j.text}” [id ${j.id}]`,
    );
  };

  const appName = (c: Ctx, id: string | null) => {
    const a = id ? c.state.applications.find((x) => x.id === id) : undefined;
    return a ? `${a.company} · ${a.title}` : null;
  };
  const companyName = (c: Ctx, id: string | null) =>
    (id && c.state.companies.find((x) => x.id === id)?.name) || null;

  const findPerson = (c: Ctx, key: string) =>
    pick(
      c.state.people,
      key,
      (p) => [p.name, p.email ?? ''],
      'person',
      (p) =>
        `${p.name}${p.email ? ` <${p.email}>` : ''}${p.company_id ? ` at ${companyName(c, p.company_id)}` : ''} [id ${p.id}]`,
    );

  const personOut = (p: Person, c: Ctx) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    role_label: personRoleLabel(p),
    ...(p.other_role ? { other_role: p.other_role } : {}),
    ...(p.title ? { title: p.title } : {}),
    ...(p.email ? { email: p.email } : {}),
    ...(p.linkedin ? { linkedin: p.linkedin } : {}),
    ...(p.notes ? { notes: p.notes } : {}),
    company: companyName(c, p.company_id),
    applications: p.application_ids.map((id) => ({ id, name: appName(c, id) })),
  });

  const findFile = (c: Ctx, key: string) =>
    pick(
      c.state.files,
      key,
      (f) => [f.label ?? '', f.filename],
      'file',
      (f) => `${f.label ?? f.filename} (${f.kind}) [id ${f.id}]`,
    );

  const fileOut = (f: FileRef, c: Ctx) => ({
    id: f.id,
    kind: f.kind,
    filename: f.filename,
    ...(f.label ? { label: f.label } : {}),
    added: whenIn(f.created_at, c.tz),
    readable_text: f.has_text,
    ...(f.event_id ? { meeting: f.event_id } : {}),
    applications: f.application_ids.map((id) => ({ id, name: appName(c, id) })),
  });

  const findMeeting = (c: Ctx, key: string) => {
    const ev = c.state.events.find((e) => e.id === key.trim());
    if (!ev || ev.type !== 'meeting')
      throw new ToolError(
        `No meeting with id “${key}”. Pass the meeting’s event id (from get_application or get_timeline).`,
      );
    return ev;
  };

  /**
   * A meeting's questions as the call shows them: the job's questions not on it yet first, then
   * what the meeting keeps (its own and the job's, with what was said). As Call Mode's callList.
   */
  const meetingQuestions = (c: Ctx, ev: TimelineEvent): CallQuestion[] => {
    const jobQs = c.state.job_questions
      .filter((j) => j.application_id === ev.application_id)
      .sort((x, y) => x.position - y.position);
    const jobById = new Map(jobQs.map((j) => [j.id, j]));
    const kept = ((ev.data as MeetingData).questions ?? [])
      .filter(
        (q) =>
          !q.job_question_id || jobById.has(q.job_question_id) || q.asked || !!q.answer?.trim(),
      )
      .map((q) => {
        const jq = q.job_question_id ? jobById.get(q.job_question_id) : undefined;
        return jq && jq.text !== q.text ? { ...q, text: jq.text } : q;
      });
    const on = new Set(kept.map((q) => q.job_question_id).filter(Boolean));
    const missing = jobQs
      .filter((j) => !on.has(j.id))
      .map((j) => ({
        id: `jq-${j.id}`,
        text: j.text,
        answer: null,
        asked: false,
        job_question_id: j.id,
        question_id: j.question_id,
      }));
    return [...missing, ...kept];
  };
  const callQuestionOut = (q: CallQuestion) => ({
    id: q.id,
    text: q.text,
    asked: q.asked,
    ...(q.answer ? { answer: q.answer } : {}),
    from: q.job_question_id ? 'job' : 'meeting',
    ...(q.question_id ? { bank_question: q.question_id } : {}),
  });
  const saveMeetingQuestions = async (ev: TimelineEvent, list: CallQuestion[]) => {
    await call('PATCH', `/events/${ev.id}`, {
      questions: list.filter((q) => q.text.trim()).map((q) => ({ ...q, text: q.text.trim() })),
    });
    return {
      meeting: ev.id,
      title: ev.title,
      questions: list.map(callQuestionOut),
    };
  };

  const when = (c: Ctx, v: string | undefined, what = 'occurred_at') => {
    if (v === undefined) return undefined;
    const d = parseLocal(v, c.tz);
    if (!d) throw new ToolError(`${what} must look like 2026-11-04 14:00 or an ISO timestamp.`);
    return d.toISOString();
  };

  interface Written {
    event: TimelineEvent | null;
    application: Application;
    nearby: TimelineEvent[];
  }
  const writtenOut = (w: Written, c: Ctx) => ({
    ...(w.event ? { logged: eventOut(w.event, c) } : { logged: null }),
    application: {
      id: w.application.id,
      company: w.application.company,
      status: w.application.status,
    },
    nearby: w.nearby.map((e) => eventOut(e, c)),
  });

  const storyOut = (s: Story | JobStory, c: Ctx, full = true) => {
    const fw = frameworkOf(s.framework_key, c.state.frameworks);
    const defs =
      'section_defs' in s && s.section_defs.length ? s.section_defs : (fw?.sections ?? []);
    return {
      id: s.id,
      title: s.title,
      framework: fw?.name ?? s.framework_key,
      ...(full ? { sections: sectionsOut(defs, s.sections) } : {}),
      ...(full && s.notes ? { notes: s.notes } : {}),
    };
  };

  // ---------- read ----------

  server.registerTool(
    'get_started',
    {
      title: 'What can I do here?',
      description:
        'Call when someone asks what you can do with Knock Knock or how to start. Returns the round’s current state and example requests that fit it, plus the ready-made prompts.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async () => {
      const c = await load();
      const s = c.state;
      const cur = s.rounds.find((x) => x.id === s.settings.current_round_id);
      const apps = s.applications.filter((a) => !cur || a.round_id === cur.id);
      const count = (st: string) => apps.filter((a) => a.status === st).length;
      const state = apps.length
        ? [
            `Current round: ${cur?.name ?? 'none'}. ${apps.length} applications: ${OPEN_STATUSES.map((st) => `${count(st)} ${statusLabel(st).toLowerCase()}`).join(', ')}; ${count('rejected')} rejected, ${count('ghosted')} ghosted.`,
            `Story bank: ${s.stories.filter((x) => !x.archived).length} stories.`,
          ].join('\n')
        : 'Nothing tracked yet. A good first step is pasting a few job links to add as Saved applications.';
      const examples = EXAMPLE_PROMPTS.map((e) => `- "${e.prompt}" — ${e.why}`).join('\n');
      const prompts = MCP_PROMPTS.map((p) => `- ${p.title} (${p.name}): ${p.does}`).join('\n');
      return `${state}\n\nThings to offer (fill in <…> from the state above, and suggest the two or three that fit best):\n${examples}\n\nReady-made prompts the person can pick in their app’s prompt menu:\n${prompts}`;
    }),
  );

  server.registerTool(
    'round_overview',
    {
      title: 'Search overview',
      description:
        'Start here. The current round, applications by status, interviews coming up, applications due a follow-up or that look ghosted, meetings still waiting for a debrief, and today’s date and time zone.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    safe(async () => {
      const c = await load();
      const s = c.state;
      const cur = s.rounds.find((x) => x.id === s.settings.current_round_id) ?? null;
      const apps = s.applications.filter((a) => !cur || a.round_id === cur.id);
      const byId = new Map(s.applications.map((a) => [a.id, a]));
      const upcoming = s.events
        .filter((e) => isUpcoming(e, c.now) && byId.get(e.application_id)?.round_id === cur?.id)
        .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
        .slice(0, 15);
      return {
        today: c.today,
        time_zone: c.tz,
        round: cur,
        other_rounds: s.rounds
          .filter((x) => x.id !== cur?.id)
          .map((x) => ({ id: x.id, name: x.name, status: x.status })),
        by_status: Object.fromEntries(
          STATUS_KEYS.map((st) => [st, apps.filter((a) => a.status === st).length]),
        ),
        open: apps.filter((a) => isOpen(a.status)).map((a) => appLine(a, c)),
        upcoming_meetings: upcoming.map((e) => ({
          company: byId.get(e.application_id)?.company,
          ...eventOut(e, c),
        })),
        follow_up: apps
          .filter((a) => needsFollowUp(a, s.events, s.settings, c.now))
          .map((a) => appLine(a, c)),
        maybe_ghosted: apps
          .filter((a) => ghostCandidate(a, s.events, s.settings, c.now))
          .map((a) => appLine(a, c)),
        needs_debrief: needsDebrief(s.events, c.now).map((e) => ({
          company: byId.get(e.application_id)?.company,
          ...eventOut(e, c),
        })),
        settings: { follow_up_days: s.settings.follow_up_days, ghost_days: s.settings.ghost_days },
      };
    }),
  );

  server.registerTool(
    'find_applications',
    {
      title: 'Find applications',
      description:
        'Look applications up by company, title, company domain, posting URL or a person’s email address (all words must match), optionally only some statuses. Use it to work out which application an email or invite belongs to. Returns compact rows; get_application has everything.',
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe('Words to match: "Copperleaf", "fathom.example", "dana@fathom.example".'),
        url: z.string().optional().describe('A posting URL; tracking parameters are ignored.'),
        status: z
          .array(z.enum([...STATUS_KEYS, 'open'] as [string, ...string[]]))
          .optional()
          .describe('Only these statuses; "open" means any of Saved through Offer.'),
        all_rounds: z
          .boolean()
          .optional()
          .describe(
            'Also look in past rounds (default false: only the current round). Turn it on when nothing in the current round fits.',
          ),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ query, url, status, all_rounds }) => {
      const c = await load();
      const cur = c.state.settings.current_round_id;
      const p = new URLSearchParams();
      if (query) p.set('q', query);
      if (url) p.set('url', url);
      if (status?.length) p.set('status', status.join(','));
      const { applications } = await call<{ applications: Application[] }>(
        'GET',
        `/applications?${p}`,
      );
      const inScope =
        all_rounds || !cur ? applications : applications.filter((a) => a.round_id === cur);
      const elsewhere = applications.length - inScope.length;
      return {
        count: inScope.length,
        ...(elsewhere
          ? {
              in_past_rounds: elsewhere,
              note: `${elsewhere} more in past rounds; pass all_rounds: true to see them.`,
            }
          : {}),
        applications: inScope.slice(0, 50).map((a) => ({
          ...appLine(a, c),
          people: c.state.people
            .filter((x) => x.application_ids.includes(a.id))
            .map((x) => [x.name, x.email].filter(Boolean).join(' ')),
        })),
      };
    }),
  );

  server.registerTool(
    'get_application',
    {
      title: 'Get an application',
      description:
        'Everything about one application: posting fields, company basics, people, the timeline (upcoming meetings first, then newest first, with notes under the event they’re about), its stories and questions (from_bank: linked to the bank, else only on this job), and files.',
      inputSchema: z.object({
        application: z.string().describe('Company, "company title", or id.'),
        timeline_limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Most recent events to include (default 40).'),
        include_description: z
          .boolean()
          .optional()
          .describe('Include the full posting text (default true).'),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ application, timeline_limit, include_description }) => {
      const c = await load();
      const a = findApp(c, application);
      const events = c.state.events.filter((e) => e.application_id === a.id);
      const view = timelineView(events, c.now);
      const childOut = (e: TimelineEvent) => ({
        ...eventOut(e, c),
        ...(view.children.get(e.id)?.length
          ? { notes: view.children.get(e.id)!.map((n) => eventOut(n, c)) }
          : {}),
      });
      const round = c.state.rounds.find((s) => s.id === a.round_id);
      const js = c.state.job_stories.filter((j) => j.application_id === a.id);
      const files = c.state.files.filter((f) => f.application_ids.includes(a.id));
      const { description, ...fields } = a;
      return {
        ...fields,
        ...(include_description === false ? {} : { description }),
        round: round?.name,
        comp: comp(a),
        ...(() => {
          const co = c.state.companies.find((x) => x.id === a.company_id);
          return co ? { company_mark: companyMark(co) } : {};
        })(),
        people: c.state.people
          .filter((p) => p.application_ids.includes(a.id))
          .map((p) => ({ ...p, role_label: personRoleLabel(p) })),
        upcoming: view.upcoming.map(childOut),
        timeline: view.past.slice(0, timeline_limit ?? 40).map(childOut),
        stories: js.map((j) => ({
          ...storyOut(j, c, false),
          from_bank: !!j.story_id,
          ...(j.angle ? { angle: j.angle } : {}),
        })),
        questions: c.state.job_questions
          .filter((q) => q.application_id === a.id)
          .sort((x, y) => x.position - y.position)
          .map(jobQuestionOut),
        files: files.map((f) => fileOut(f, c)),
      };
    }),
  );

  server.registerTool(
    'get_timeline',
    {
      title: 'Read a timeline',
      description:
        'An application’s timeline events. With `around`, only events within ±days of that time, nearest first: call this before logging anything so you don’t log the same email or meeting twice.',
      inputSchema: z.object({
        application: z.string(),
        around: z
          .string()
          .optional()
          .describe('A date or time ("2026-11-03", "2026-11-03 14:00").'),
        days: z
          .number()
          .int()
          .min(0)
          .max(60)
          .optional()
          .describe('Window around `around` (default 3).'),
        types: z.array(z.enum(['created', 'status', 'meeting', 'email', 'note'])).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ application, around, days, types }) => {
      const c = await load();
      const a = findApp(c, application);
      const p = new URLSearchParams();
      if (around) p.set('around', when(c, around, 'around')!);
      if (days != null) p.set('days', String(days));
      if (types?.length) p.set('types', types.join(','));
      const { events } = await call<{ events: TimelineEvent[] }>(
        'GET',
        `/applications/${a.id}/timeline?${p}`,
      );
      return {
        application: `${a.company} · ${a.title}`,
        count: events.length,
        events: events.map((e) => eventOut(e, c)),
      };
    }),
  );

  // ---------- applications ----------

  const appFields = {
    title: z.string().describe('Job title as posted.'),
    company: z.string(),
    url: z.string().optional().describe('The posting URL.'),
    company_domain: z.string().optional().describe('"fathom.com": helps match email later.'),
    company_website: z.string().optional(),
    company_linkedin: z.string().optional(),
    company_hq: z.string().optional(),
    company_size: z.string().optional().describe('"201–500", "5,000+".'),
    company_industry: z.string().optional(),
    company_funding: z
      .string()
      .optional()
      .describe('"Series C", "Public (NYSE: X)", "Bootstrapped".'),
    source: z
      .string()
      .optional()
      .describe('Where it came from: LinkedIn, Company site, Referral, Recruiter…'),
    location: z.string().optional(),
    work_mode: z.enum(WORK_MODE_KEYS).optional(),
    seniority: z.string().optional().describe('"Senior IC", "Principal", "Director".'),
    reports_to: z.string().optional(),
    team: z.string().optional(),
    employment_type: z.string().optional().describe('Full-time, contract…'),
    salary_min: z.number().optional(),
    salary_max: z.number().optional(),
    salary_currency: z.string().optional().describe('ISO code; default USD.'),
    salary_period: z.enum(SALARY_PERIODS).optional(),
    salary_text: z
      .string()
      .optional()
      .describe('Comp as written when it doesn’t fit min/max ("$205k + 15% bonus").'),
    posted_on: z.string().optional().describe('YYYY-MM-DD'),
    description: z
      .string()
      .optional()
      .describe('The posting’s text (clean, but complete): postings disappear.'),
    must_haves: z.array(z.string()).optional(),
    nice_to_haves: z.array(z.string()).optional(),
    inferred: z
      .array(z.string())
      .optional()
      .describe(
        'Field names you inferred rather than read off the posting, e.g. ["seniority", "reports_to"].',
      ),
    notes: z.string().optional(),
  };

  server.registerTool(
    'read_posting',
    {
      title: 'Read a job posting',
      description:
        "Reads a job posting from its link, the whole of it, including pages that only fill in with JavaScript (Workday, iCIMS and the like). Call it before create_application whenever you have a posting link, instead of fetching the page yourself. It returns the posting text and any fields the job board or page states outright (title, company, location, work mode, employment type, pay, date posted, department): use those as read, and pull the rest (seniority, reports-to, team, must-haves, nice-to-haves) from the text. If it can't read the page (a sign-in wall), ask the owner to paste the posting.",
      inputSchema: z.object({ url: z.string().describe('The posting’s link.') }),
    },
    safe(async ({ url }) => call('POST', '/postings/read', { url })),
  );

  server.registerTool(
    'create_application',
    {
      title: 'Add an application',
      description:
        'Adds a job to the current round, as Saved unless you say it was already sent. Pull every field you can from the posting. If an application with the same posting URL exists, it is returned instead of a duplicate (pass force to add anyway).',
      inputSchema: z.object({
        ...appFields,
        status: z
          .enum(STATUS_KEYS)
          .optional()
          .describe('Default saved. Use applied (with occurred_at) when logging one already sent.'),
        occurred_at: z.string().optional().describe('When it was saved or sent, for backfills.'),
        round: z.string().optional().describe('A round name or id (default: the current round).'),
        force: z.boolean().optional(),
      }),
    },
    safe(async ({ round, force, occurred_at, ...input }) => {
      const c = await load();
      if (input.url && !force) {
        const { applications } = await call<{ applications: Application[] }>(
          'GET',
          `/applications?url=${encodeURIComponent(input.url)}`,
        );
        if (applications[0])
          return {
            already_saved: true,
            application: appLine(applications[0], c),
            note: 'Already tracked; nothing added. Use update_application to fill in fields.',
          };
      }
      const round_id = round
        ? pick(
            c.state.rounds,
            round,
            (s) => [s.name],
            'round',
            (s) => `${s.name} [id ${s.id}]`,
          ).id
        : undefined;
      const a = await call<Application>('POST', '/applications', {
        ...input,
        salary_currency:
          input.salary_currency ?? (input.salary_min || input.salary_max ? 'USD' : undefined),
        round_id,
        occurred_at: when(c, occurred_at),
      });
      return { created: appLine(a, c) };
    }),
  );

  server.registerTool(
    'update_application',
    {
      title: 'Update an application',
      description: 'Changes posting or company fields. Not the status: use set_status for that.',
      inputSchema: z.object({
        application: z.string(),
        ...Object.fromEntries(Object.entries(appFields).map(([k, v]) => [k, v.optional()])),
        resume_file: z.string().optional().describe('The id of the resume file it was sent with.'),
      }),
    },
    safe(
      async ({
        application,
        resume_file,
        ...input
      }: { application: string; resume_file?: string } & Record<string, unknown>) => {
        const c = await load();
        const a = findApp(c, application);
        const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
        if (resume_file) body.resume_file_id = resume_file;
        const next = await call<Application>('PATCH', `/applications/${a.id}`, body);
        return { updated: appLine(next, c), fields: Object.keys(body) };
      },
    ),
  );

  server.registerTool(
    'set_company_logo',
    {
      title: 'Set a company’s logo or color',
      description: `Gives a company its logo, from an image on the web: find the company’s logo (its own website or press kit is best; a square icon or mark reads better than a wide wordmark) and pass the image’s own address, not a web page. PNG, JPEG, WebP, GIF or SVG, up to 2 MB; a data: URL with base64 also works. Knock Knock fetches and keeps it. A company without a logo shows a monogram (its initial) on a colored tile; \`color\` sets that tile. If you know the company’s brand color, you may pick the closest of: ${LOGO_COLORS.map((c) => `${c.key} ${c.hex}`).join(', ')}. Otherwise leave it at the default (ultramarine). Only change a logo the owner already has when they ask.`,
      inputSchema: z.object({
        company: z.string().describe('The company (named loosely), or an application at it.'),
        image_url: z
          .string()
          .optional()
          .describe('The logo image’s address (https://…/logo.png), or a data:image/…;base64 URL.'),
        color: z
          .enum([...LOGO_COLOR_KEYS, 'default'])
          .optional()
          .describe('The monogram’s color; "default" is ultramarine.'),
        remove_logo: z
          .boolean()
          .optional()
          .describe('Remove the uploaded logo (back to the monogram).'),
      }),
    },
    safe(async ({ company, image_url, color, remove_logo }) => {
      if (!image_url && !color && !remove_logo)
        throw new ToolError('Pass image_url, color or remove_logo.');
      if (image_url && remove_logo) throw new ToolError('Pass image_url or remove_logo, not both.');
      const c = await load();
      const co = findCompany(c, company);
      let next: Company = co;
      if (remove_logo && co.has_logo)
        next = await call<Company>('DELETE', `/companies/${co.id}/logo`);
      if (image_url)
        next = await call<Company>('POST', `/companies/${co.id}/logo-from-url`, { url: image_url });
      if (color)
        next = await call<Company>('PATCH', `/companies/${co.id}`, {
          logo_color: color === 'default' || color === DEFAULT_LOGO_COLOR ? null : color,
        });
      return { company: next.name, id: next.id, ...companyMark(next) };
    }),
  );

  server.registerTool(
    'set_status',
    {
      title: 'Change status',
      description:
        'Moves an application along (or closes it) by writing a status event at occurred_at (default now). Point caused_by at the event (usually the email you just logged) that caused it. Rejected/Declined/Ghosted remember the stage they closed from. Accepting an offer lists the other open applications: ask before declining them. It does not close the round: ask the owner whether to mark the round Accepted, and if they say yes, call set_status again with close_round: true.',
      inputSchema: z.object({
        application: z.string(),
        status: z.enum(STATUS_KEYS),
        occurred_at: z.string().optional(),
        reason: z.string().optional(),
        caused_by: z.string().optional().describe('Event id that caused it.'),
        external_ref: z.string().optional(),
        close_round: z
          .boolean()
          .optional()
          .describe('With accepted: also mark the round Accepted. Only after the owner says yes.'),
      }),
    },
    safe(
      async ({
        application,
        status,
        occurred_at,
        reason,
        caused_by,
        external_ref,
        close_round,
      }) => {
        const c = await load();
        const a = findApp(c, application);
        const w = await call<Written>('POST', `/applications/${a.id}/status`, {
          status,
          occurred_at: when(c, occurred_at),
          reason,
          caused_by,
          external_ref,
          close_round,
        });
        const res: Record<string, unknown> = writtenOut(w, c);
        if (!w.event) res.note = `Already ${statusLabel(status)}; nothing written.`;
        if (status === 'accepted') {
          const { applications } = await call<{ applications: Application[] }>(
            'GET',
            `/applications/${a.id}/others-open`,
          );
          res.others_open = applications.map((x) => appLine(x, c));
          res.note = close_round
            ? 'Search marked Accepted. Ask before declining the others_open applications (set_status declined).'
            : 'Ask the owner whether to mark this round Accepted (set_status again with close_round: true), and ask before declining the others_open applications (set_status declined).';
        }
        return res;
      },
    ),
  );

  const personFields = {
    email: z.string().optional(),
    title: z.string().optional().describe('Their job title, e.g. "Senior Recruiter".'),
    role: z.enum(PERSON_ROLE_KEYS).optional(),
    other_role: z
      .string()
      .optional()
      .describe('When role is other: their actual role, e.g. "Head of Talent".'),
    linkedin: z.string().optional(),
    notes: z.string().optional(),
  };

  server.registerTool(
    'add_person',
    {
      title: 'Add a person',
      description:
        'A recruiter, hiring manager, interviewer or referrer, on an application or at a company. On an application, someone already at its company with the same name or email is put on the job instead of adding them twice. Pass company with an application for someone at another company (an agency recruiter); without an application, they’re added at that company on no job yet. Their email helps match future emails.',
      inputSchema: z.object({
        application: z.string().optional().describe('The job they’re on (company, title or id).'),
        company: z
          .string()
          .optional()
          .describe(
            'Where they work, if not the application’s company (found by name, or added). Alone: added there on no job.',
          ),
        name: z.string(),
        ...personFields,
      }),
    },
    safe(async ({ application, company, ...input }) => {
      if (!application && !company) throw new ToolError('Pass an application, a company, or both.');
      const c = await load();
      const same = (p: Person) =>
        (input.email && p.email?.toLowerCase() === input.email.toLowerCase()) ||
        norm(p.name) === norm(input.name);
      if (!application) {
        const co = findCompany(c, company!);
        const dup = c.state.people.find((p) => p.company_id === co.id && same(p));
        if (dup) return { already_there: personOut(dup, c) };
        const made = await call<Person>('POST', `/companies/${co.id}/people`, input);
        return { added: personOut(made, c) };
      }
      const a = findApp(c, application);
      const onJob = c.state.people.find((p) => p.application_ids.includes(a.id) && same(p));
      if (onJob) return { already_there: personOut(onJob, c) };
      let at: { company_id?: string; company_name?: string } = {};
      if (company) {
        const known = c.state.companies.find((co) => norm(co.name) === norm(company));
        const co = known ?? c.state.companies.find((x) => x.id === company.trim());
        at = co ? { company_id: co.id } : { company_name: company };
      }
      const coId = at.company_id ?? (at.company_name ? null : a.company_id);
      const atCompany = coId && c.state.people.find((p) => p.company_id === coId && same(p));
      if (atCompany) {
        const linked = await call<Person>('POST', `/applications/${a.id}/people/${atCompany.id}`);
        return {
          linked: personOut(linked, c),
          note: 'Already at the company, so they were put on this job rather than added twice.',
        };
      }
      const made = await call<Person>('POST', `/applications/${a.id}/people`, { ...input, ...at });
      // It may have made the company, so read it back.
      return { added: personOut(made, at.company_name ? await load() : c) };
    }),
  );

  server.registerTool(
    'find_people',
    {
      title: 'Find people',
      description:
        'Everyone across companies and jobs (the People page), matched by name, email, title or company. Returns each person with their company and the jobs they’re on.',
      inputSchema: z.object({
        query: z.string().optional().describe('Words to match: "Dana", "dana@fathom.example".'),
        company: z.string().optional().describe('Only people at this company.'),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ query, company }) => {
      const c = await load();
      let pool = c.state.people;
      if (company) {
        const co = findCompany(c, company);
        pool = pool.filter((p) => p.company_id === co.id);
      }
      if (query) {
        const words = norm(query).split(' ').filter(Boolean);
        pool = pool.filter((p) => {
          const hay = norm(
            [p.name, p.email, p.title, personRoleLabel(p), companyName(c, p.company_id)]
              .filter(Boolean)
              .join(' '),
          );
          return words.every((w) => hay.includes(w));
        });
      }
      return { count: pool.length, people: pool.slice(0, 50).map((p) => personOut(p, c)) };
    }),
  );

  server.registerTool(
    'update_person',
    {
      title: 'Update a person',
      description:
        'Changes someone’s name, email, title, role (with other_role for other), LinkedIn or notes. Only the fields given change; it’s the same person on every job they’re on.',
      inputSchema: z.object({
        person: z.string().describe('Their name, email or id.'),
        name: z.string().optional(),
        ...personFields,
      }),
    },
    safe(async ({ person, ...input }) => {
      const c = await load();
      const p = findPerson(c, person);
      const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      return { updated: personOut(await call<Person>('PATCH', `/people/${p.id}`, body), c) };
    }),
  );

  server.registerTool(
    'link_person',
    {
      title: 'Put someone on a job',
      description:
        'Puts someone already known (at the job’s company, usually) on another application. Use it instead of add_person for someone who already exists.',
      inputSchema: z.object({
        person: z.string().describe('Their name, email or id.'),
        application: z.string(),
      }),
    },
    safe(async ({ person, application }) => {
      const c = await load();
      const p = findPerson(c, person);
      const a = findApp(c, application);
      if (p.application_ids.includes(a.id)) return { already_there: personOut(p, c) };
      const next = await call<Person>('POST', `/applications/${a.id}/people/${p.id}`);
      return {
        linked: personOut(next, c),
        ...(p.company_id && a.company_id && p.company_id !== a.company_id
          ? { note: `${p.name} works at ${companyName(c, p.company_id)}, not ${a.company}.` }
          : {}),
      };
    }),
  );

  server.registerTool(
    'set_person_company',
    {
      title: 'Move someone to a company, or off one',
      description:
        'Sets the company someone works at: give `company` (a name or id; a name that matches no company, ignoring case, adds it) to link them to it or move them there, or `remove: true` to take them off their company. Their jobs stay as they are (someone can be on a job at another company, like an agency recruiter). Use add_person for someone new.',
      inputSchema: z.object({
        person: z.string().describe('Their name, email or id.'),
        company: z.string().optional().describe('The company’s name or id.'),
        remove: z.boolean().optional().describe('True to take them off their company.'),
      }),
    },
    safe(async ({ person, company, remove }) => {
      const c = await load();
      const p = findPerson(c, person);
      if (remove) {
        if (!p.company_id)
          return { unchanged: personOut(p, c), note: `${p.name} isn’t at a company.` };
        const was = companyName(c, p.company_id);
        const next = await call<Person>('PATCH', `/people/${p.id}`, { company_id: null });
        return { removed_from: was, person: personOut(next, c) };
      }
      if (!company?.trim()) throw new Error('Give a company, or remove: true.');
      const key = company.trim().toLowerCase();
      const match = c.state.companies.find(
        (co) => co.id === company.trim() || co.name.toLowerCase() === key,
      );
      if (match && match.id === p.company_id)
        return { unchanged: personOut(p, c), note: `${p.name} is already at ${match.name}.` };
      const next = await call<Person>(
        'PATCH',
        `/people/${p.id}`,
        match ? { company_id: match.id } : { company_name: company.trim() },
      );
      // A company added just now isn't in the state read above.
      return {
        moved: personOut(next, match ? c : await load()),
        ...(match ? {} : { note: `Added ${company.trim()} as a new company.` }),
      };
    }),
  );

  server.registerTool(
    'remove_person_from_job',
    {
      title: 'Take someone off a job',
      description:
        'Takes someone off one application only. They stay at their company and on any other jobs there. To delete the person altogether, use delete_person.',
      inputSchema: z.object({
        person: z.string().describe('Their name, email or id.'),
        application: z.string(),
      }),
    },
    safe(async ({ person, application }) => {
      const c = await load();
      const a = findApp(c, application);
      const p = pick(
        c.state.people.filter((x) => x.application_ids.includes(a.id)),
        person,
        (x) => [x.name, x.email ?? ''],
        'person on that application',
        (x) => `${x.name} [id ${x.id}]`,
      );
      await call('DELETE', `/applications/${a.id}/people/${p.id}`);
      return {
        removed: p.name,
        from: `${a.company} · ${a.title}`,
        note: p.company_id
          ? `${p.name} stays at ${companyName(c, p.company_id)}.`
          : `${p.name} stays in People.`,
      };
    }),
  );

  server.registerTool(
    'delete_person',
    {
      title: 'Delete a person',
      description:
        'Hard delete: removes the person from every job and from their company, and can’t be undone. Confirm with the owner first. To take them off one job only, use remove_person_from_job.',
      inputSchema: z.object({ person: z.string().describe('Their name, email or id.') }),
      annotations: { destructiveHint: true },
    },
    safe(async ({ person }) => {
      const c = await load();
      const p = findPerson(c, person);
      await call('DELETE', `/people/${p.id}`);
      return { deleted: p.name, was_on: p.application_ids.map((id) => appName(c, id)) };
    }),
  );

  // ---------- companies ----------

  const companyFields = {
    website: z.string().optional(),
    linkedin: z.string().optional(),
    hq: z.string().optional(),
    size: z.string().optional().describe('"201–500", "5,000+".'),
    industry: z.string().optional(),
    funding: z.string().optional().describe('"Series C", "Public (NYSE: X)", "Bootstrapped".'),
  };
  const companyOut = (co: Company, c: Ctx) => ({
    id: co.id,
    name: co.name,
    website: co.website,
    linkedin: co.linkedin,
    hq: co.hq,
    size: co.size,
    industry: co.industry,
    funding: co.funding,
    ...companyMark(co),
    jobs: c.state.applications
      .filter((a) => a.company_id === co.id)
      .map((a) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        round: c.state.rounds.find((r) => r.id === a.round_id)?.name,
      })),
    people: c.state.people.filter((p) => p.company_id === co.id).map((p) => personOut(p, c)),
  });

  server.registerTool(
    'get_company',
    {
      title: 'Get a company',
      description:
        'One company: its details, logo or monogram, every job there (from every round) and its people.',
      inputSchema: z.object({
        company: z.string().describe('The company (named loosely), or an application at it.'),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ company }) => {
      const c = await load();
      return companyOut(findCompany(c, company), c);
    }),
  );

  server.registerTool(
    'list_companies',
    {
      title: 'List companies',
      description: 'Every company (the Companies page), with how many jobs and people each has.',
      inputSchema: z.object({ query: z.string().optional().describe('Words in the name.') }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ query }) => {
      const c = await load();
      const words = norm(query ?? '')
        .split(' ')
        .filter(Boolean);
      const list = c.state.companies.filter((co) =>
        words.every((w) => norm(`${co.name} ${co.website ?? ''}`).includes(w)),
      );
      return list.map((co) => ({
        id: co.id,
        name: co.name,
        jobs: c.state.applications.filter((a) => a.company_id === co.id).length,
        people: c.state.people.filter((p) => p.company_id === co.id).length,
      }));
    }),
  );

  server.registerTool(
    'create_company',
    {
      title: 'Add a company',
      description:
        'A company with no job yet (to add people there first, say). A company of the same name (ignoring case) is returned instead of a second one. Jobs get their company from create_application.',
      inputSchema: z.object({ name: z.string(), ...companyFields }),
    },
    safe(async (input) => {
      const c = await load();
      const known = c.state.companies.find((co) => norm(co.name) === norm(input.name));
      if (known) return { already_there: companyOut(known, c) };
      const co = await call<Company>('POST', '/companies', input);
      return { created: companyOut(co, c) };
    }),
  );

  server.registerTool(
    'update_company',
    {
      title: 'Update a company',
      description:
        'Changes a company’s name or details (website, LinkedIn, HQ, size, industry, funding). Every job at the company shows the change. For its logo or monogram color, use set_company_logo. To move one job to a different company, use update_application with company.',
      inputSchema: z.object({
        company: z.string().describe('The company (named loosely), or an application at it.'),
        name: z.string().optional(),
        ...companyFields,
      }),
    },
    safe(async ({ company, ...input }) => {
      const c = await load();
      const co = findCompany(c, company);
      const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const next = await call<Company>('PATCH', `/companies/${co.id}`, body);
      return { updated: companyOut(next, await load()) };
    }),
  );

  server.registerTool(
    'delete_company',
    {
      title: 'Delete a company',
      description:
        'Hard delete, and it can’t be undone: the company, every job there (with their timelines, stories and questions) and its people. Files stay in the library. Tell the owner how many jobs and people go with it and confirm first.',
      inputSchema: z.object({ company: z.string().describe('The company’s name or id.') }),
      annotations: { destructiveHint: true },
    },
    safe(async ({ company }) => {
      const c = await load();
      const co = pick(
        c.state.companies,
        company,
        (x) => [x.name, x.website ?? ''],
        'company',
        (x) => `${x.name} [id ${x.id}]`,
      );
      const jobs = c.state.applications.filter((a) => a.company_id === co.id);
      const people = c.state.people.filter((p) => p.company_id === co.id);
      await call('DELETE', `/companies/${co.id}`);
      return {
        deleted: co.name,
        jobs_deleted: jobs.map((a) => a.title),
        people_deleted: people.map((p) => p.name),
      };
    }),
  );

  server.registerTool(
    'delete_application',
    {
      title: 'Delete an application',
      description:
        'Hard delete, and it can’t be undone: the job with its timeline, stories and questions. Its people stay at the company, and its files stay in the library. Confirm with the owner first; to close a job instead, use set_status.',
      inputSchema: z.object({ application: z.string() }),
      annotations: { destructiveHint: true },
    },
    safe(async ({ application }) => {
      const c = await load();
      const a = findApp(c, application);
      await call('DELETE', `/applications/${a.id}`);
      return { deleted: `${a.company} · ${a.title}` };
    }),
  );

  // ---------- timeline ----------

  const attendee = z.object({
    name: z.string(),
    title: z.string().optional(),
    email: z.string().optional(),
  });

  server.registerTool(
    'log_meeting',
    {
      title: 'Log a meeting',
      description: `An interview or call, scheduled or held. Read get_timeline around its time first; if it is already there (you or the person logged it), use update_meeting instead. Pass the calendar event id as external_ref. ${WRITE_NOTE}`,
      inputSchema: z.object({
        application: z.string(),
        title: z.string().describe('"Panel interview", "Recruiter screen with Dana".'),
        starts_at: z.string(),
        ends_at: z.string().optional(),
        kind: z.enum(MEETING_KIND_KEYS).optional(),
        state: z
          .enum(MEETING_STATES)
          .optional()
          .describe('Default: scheduled if in the future, else held.'),
        join_url: z.string().optional(),
        location: z.string().optional(),
        timezone: z.string().optional(),
        attendees: z.array(attendee).optional(),
        agenda: z.string().optional().describe('Topics, format, what to prepare.'),
        description: z.string().optional(),
        external_ref: z.string().optional(),
      }),
    },
    safe(async ({ application, starts_at, ends_at, description, ...rest }) => {
      const c = await load();
      const a = findApp(c, application);
      const w = await call<Written>('POST', `/applications/${a.id}/meetings`, {
        ...rest,
        occurred_at: when(c, starts_at, 'starts_at'),
        ends_at: when(c, ends_at, 'ends_at'),
        body: description,
      });
      return writtenOut(w, c);
    }),
  );

  server.registerTool(
    'update_meeting',
    {
      title: 'Update a meeting',
      description:
        'Reschedule, add the join link or attendees, or mark it held or canceled. Rescheduling edits the same meeting rather than adding a new one.',
      inputSchema: z.object({
        event: z.string().describe('The meeting’s event id.'),
        title: z.string().optional(),
        starts_at: z.string().optional(),
        ends_at: z.string().optional(),
        kind: z.enum(MEETING_KIND_KEYS).optional(),
        state: z.enum(MEETING_STATES).optional(),
        join_url: z.string().optional(),
        location: z.string().optional(),
        attendees: z.array(attendee).optional(),
        agenda: z.string().optional(),
        description: z.string().optional(),
        external_ref: z.string().optional(),
      }),
    },
    safe(async ({ event, starts_at, ends_at, description, ...rest }) => {
      const c = await load();
      const body = Object.fromEntries(
        Object.entries({
          ...rest,
          occurred_at: when(c, starts_at, 'starts_at'),
          ends_at: when(c, ends_at, 'ends_at'),
          body: description,
        }).filter(([, v]) => v !== undefined),
      );
      return writtenOut(await call<Written>('PATCH', `/events/${event}`, body), c);
    }),
  );

  server.registerTool(
    'log_email',
    {
      title: 'Log an email',
      description: `An email sent or received about an application, as a summary of what happened (not the whole email). Read get_timeline around its date first. Pass the Gmail message id as external_ref. ${WRITE_NOTE}`,
      inputSchema: z.object({
        application: z.string(),
        direction: z.enum(['in', 'out']),
        occurred_at: z.string(),
        category: z.enum(EMAIL_CATEGORY_KEYS),
        subject: z.string().optional(),
        summary: z.string().describe('What happened, in a sentence or three.'),
        counterpart_name: z.string().optional(),
        counterpart_email: z.string().optional(),
        key_points: z
          .array(z.string())
          .optional()
          .describe('Numbers and commitments: "Base: $205k → asked $225k".'),
        thread_ref: z.string().optional(),
        link: z.string().optional().describe('A link back to the email, if you have one.'),
        external_ref: z.string().optional(),
      }),
    },
    safe(async ({ application, occurred_at, summary, ...rest }) => {
      const c = await load();
      const a = findApp(c, application);
      const w = await call<Written>('POST', `/applications/${a.id}/emails`, {
        ...rest,
        occurred_at: when(c, occurred_at),
        body: summary,
      });
      return writtenOut(w, c);
    }),
  );

  server.registerTool(
    'add_note',
    {
      title: 'Add a note',
      description: `An internal note on an application: a thought, something said worth remembering, a debrief. Set about_event to a meeting’s id to attach it under that meeting (a debrief). ${WRITE_NOTE}`,
      inputSchema: z.object({
        application: z.string(),
        body: z.string(),
        title: z.string().optional(),
        about_event: z.string().optional(),
        occurred_at: z.string().optional(),
        external_ref: z.string().optional(),
      }),
    },
    safe(async ({ application, about_event, occurred_at, ...rest }) => {
      const c = await load();
      const a = findApp(c, application);
      const w = await call<Written>('POST', `/applications/${a.id}/notes`, {
        ...rest,
        parent_id: about_event,
        occurred_at: when(c, occurred_at),
      });
      return writtenOut(w, c);
    }),
  );

  server.registerTool(
    'update_event',
    {
      title: 'Update an event',
      description:
        'Fix an email or note (or a status event’s time and reason): only the fields given change. For meetings, update_meeting has the meeting fields.',
      inputSchema: z.object({
        event: z.string(),
        occurred_at: z.string().optional(),
        subject: z.string().optional().describe('Email.'),
        summary: z.string().optional().describe('Email summary or note text.'),
        title: z.string().optional().describe('Note.'),
        category: z.enum(EMAIL_CATEGORY_KEYS).optional(),
        key_points: z.array(z.string()).optional(),
        reason: z.string().optional().describe('Status event.'),
        external_ref: z.string().optional(),
      }),
    },
    safe(async ({ event, occurred_at, summary, ...rest }) => {
      const c = await load();
      const ev = c.state.events.find((e) => e.id === event);
      if (!ev) throw new ToolError(`No event ${event}.`);
      const body: Record<string, unknown> = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      if (occurred_at) body.occurred_at = when(c, occurred_at);
      if (summary !== undefined) body.body = summary;
      return writtenOut(await call<Written>('PATCH', `/events/${event}`, body), c);
    }),
  );

  server.registerTool(
    'delete_event',
    {
      title: 'Delete an event',
      description:
        'Removes a timeline event (and notes under it), for example a duplicate. Deleting a status event recomputes the status. The created event can’t be deleted.',
      inputSchema: z.object({ event: z.string() }),
      annotations: { destructiveHint: true },
    },
    safe(async ({ event }) => {
      const c = await load();
      return writtenOut(await call<Written>('DELETE', `/events/${event}`), c);
    }),
  );

  // ---------- stories ----------

  server.registerTool(
    'list_frameworks',
    {
      title: 'Story frameworks',
      description:
        'The story frameworks (STAR, Introduction, Why this job, …) with their sections. A story is just its framework’s parts.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    safe(async () => {
      const c = await load();
      return c.state.frameworks.map((f) => ({
        key: f.key,
        name: f.name,
        group: f.group,
        when: f.blurb,
        sections: f.sections.map((s) => ({ key: s.key, label: s.label, prompt: s.prompt })),
      }));
    }),
  );

  server.registerTool(
    'list_stories',
    {
      title: 'Search Stories',
      description:
        'Bank stories, best match first. Put the interview question or a few words in `query` ("tell me about a time you disagreed with a leader"): stories whose title, framework or parts share its words rise to the top.',
      inputSchema: z.object({
        query: z.string().optional(),
        framework: z.string().optional().describe('A framework key or name.'),
        full: z
          .boolean()
          .optional()
          .describe('Include the sections (default false: titles and frameworks only).'),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ query, framework, full }) => {
      const c = await load();
      let pool = c.state.stories.filter((s) => !s.archived);
      if (framework) {
        const fw = c.state.frameworks.find(
          (f) => f.key === framework || norm(f.name) === norm(framework),
        );
        if (!fw) throw new ToolError(`No framework “${framework}”. Use list_frameworks.`);
        pool = pool.filter((s) => s.framework_key === fw.key);
      }
      const hits = searchStories(pool, query ?? '', c.state.frameworks);
      return hits.slice(0, 25).map((h) => storyOut(h.item, c, !!full));
    }),
  );

  server.registerTool(
    'list_archived_stories',
    {
      title: 'Find archived stories',
      description:
        'Archived bank stories, which list_stories and the overview leave out. Use it when the owner asks about a story you can’t find, or about what they archived. Each result is archived; to bring one back, only if the owner asks, call update_story with archived: false.',
      inputSchema: z.object({
        query: z.string().optional().describe('Words or an interview question to match.'),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ query }) => {
      const c = await load();
      const pool = c.state.stories.filter((s) => s.archived);
      const hits = searchStories(pool, query ?? '', c.state.frameworks);
      return {
        note: 'These stories are archived: they are not in list_stories or the overview. To restore one when the owner asks, call update_story with its id and archived: false.',
        count: hits.length,
        stories: hits.slice(0, 25).map((h) => ({
          ...storyOut(h.item, c, false),
          archived: true,
        })),
      };
    }),
  );

  server.registerTool(
    'get_story',
    {
      title: 'Get a story',
      description:
        'One bank story in full, and which applications have it linked (they follow it while unchanged there). Also finds archived stories.',
      inputSchema: z.object({ story: z.string().describe('Title or id.') }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ story }) => {
      const c = await load();
      const s = findStory(c, story, true);
      return {
        ...storyOut(s, c),
        ...(s.archived ? { archived: true } : {}),
        copies: c.state.job_stories
          .filter((j) => j.story_id === s.id)
          .map((j) => {
            const a = c.state.applications.find((x) => x.id === j.application_id);
            return {
              job_story: j.id,
              application: a ? `${a.company} · ${a.title}` : j.application_id,
            };
          }),
      };
    }),
  );

  const storyFields = {
    title: z.string(),
    sections: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Section key → text, e.g. {"situation": "...", "task": "...", "action": "...", "result": "..."}. Keys from list_frameworks.',
      ),
    notes: z.string().optional(),
  };

  server.registerTool(
    'create_story',
    {
      title: 'Add a story to the bank',
      description:
        'A new bank story. Pick the framework that fits (list_frameworks) and fill its sections: a story is its framework’s parts, and Call Mode finds it by the words in them, so write the parts in full.',
      inputSchema: z.object({
        framework: z
          .string()
          .describe(
            'Framework key: star, car, soar, intro, why_job, why_looking, failure, weakness, design, or a custom key.',
          ),
        ...storyFields,
      }),
    },
    safe(async ({ framework, ...input }) => {
      const c = await load();
      const fw = c.state.frameworks.find(
        (f) => f.key === framework || norm(f.name) === norm(framework),
      );
      if (!fw) throw new ToolError(`No framework “${framework}”. Use list_frameworks.`);
      const s = await call<Story>('POST', '/stories', { ...input, framework_key: fw.key });
      return { created: storyOut(s, c) };
    }),
  );

  server.registerTool(
    'update_story',
    {
      title: 'Update a bank story',
      description:
        'Changes a bank story. Applications that have it linked and haven’t changed it there take the new version too (each keeps its angle); job-only variants don’t change. Also finds archived stories: pass archived: false to bring one back (only when the owner asks), or archived: true to archive one.',
      inputSchema: z.object({
        story: z.string().describe('Title or id.'),
        framework: z.string().optional(),
        ...Object.fromEntries(Object.entries(storyFields).map(([k, v]) => [k, v.optional()])),
        archived: z
          .boolean()
          .optional()
          .describe('true archives it (out of the normal results); false brings it back.'),
      }),
    },
    safe(
      async ({
        story,
        framework,
        ...input
      }: { story: string; framework?: string } & Record<string, unknown>) => {
        const c = await load();
        const s = findStory(c, story, true);
        const body: Record<string, unknown> = Object.fromEntries(
          Object.entries(input).filter(([, v]) => v !== undefined),
        );
        if (framework) {
          const fw = c.state.frameworks.find(
            (f) => f.key === framework || norm(f.name) === norm(framework),
          );
          if (!fw) throw new ToolError(`No framework “${framework}”.`);
          body.framework_key = fw.key;
        }
        return { updated: storyOut(await call<Story>('PATCH', `/stories/${s.id}`, body), c) };
      },
    ),
  );

  server.registerTool(
    'link_story',
    {
      title: 'Link a story to an application',
      description:
        'Puts a bank story on an application, linked, optionally with an angle (how to frame it for this job). It follows the bank story while unchanged; editing it on the job (update_job_story) makes it that job’s own.',
      inputSchema: z.object({
        application: z.string(),
        story: z.string(),
        angle: z.string().optional(),
      }),
    },
    safe(async ({ application, story, angle }) => {
      const c = await load();
      const a = findApp(c, application);
      const s = findStory(c, story);
      const js = await call<JobStory>('POST', `/applications/${a.id}/stories`, {
        story_id: s.id,
        angle,
      });
      return {
        linked: { job_story: js.id, title: js.title, application: `${a.company} · ${a.title}` },
      };
    }),
  );

  server.registerTool(
    'update_job_story',
    {
      title: 'Edit a story on an application',
      description:
        'Edits a story on an application: its angle, title, framework, sections or notes. The bank story never changes. Changing anything but the angle (or position) of a story linked from the bank makes it a job-only variant: the job keeps your words and it stops following the bank. To change the story everywhere instead, use update_story on the bank story.',
      inputSchema: z.object({
        application: z.string(),
        story: z.string().describe('The copy’s title or job story id.'),
        angle: z.string().optional(),
        framework: z.string().optional(),
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Its place in the job’s list, from 0.'),
        ...Object.fromEntries(Object.entries(storyFields).map(([k, v]) => [k, v.optional()])),
      }),
    },
    safe(
      async ({
        application,
        story,
        framework,
        ...input
      }: { application: string; story: string; framework?: string } & Record<string, unknown>) => {
        const c = await load();
        const js = findJobStory(c, story, application);
        const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
        if (framework) body.framework_key = findFramework(c, framework).key;
        const next = await call<JobStory>('PATCH', `/job-stories/${js.id}`, body);
        return {
          updated: { ...storyOut(next, c), from_bank: !!next.story_id },
          ...(js.story_id && !next.story_id
            ? {
                note: 'This is now a job-only variant: it no longer follows the bank story, which is unchanged.',
              }
            : {}),
        };
      },
    ),
  );

  server.registerTool(
    'get_job_story',
    {
      title: 'Read a story on an application',
      description:
        'One of an application’s stories in full: its sections, notes, angle, and whether it’s linked to the bank (from_bank) or only on this job.',
      inputSchema: z.object({
        application: z.string(),
        story: z.string().describe('Its title or job story id.'),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ application, story }) => {
      const c = await load();
      const js = findJobStory(c, story, application);
      return {
        ...storyOut(js, c),
        ...(js.angle ? { angle: js.angle } : {}),
        from_bank: !!js.story_id,
        ...(js.story_id ? { bank_story: js.story_id } : {}),
      };
    }),
  );

  server.registerTool(
    'create_job_story',
    {
      title: 'Write a story for one application',
      description:
        'A story just for this application (job-only), not in the bank. Pass save_to_bank to also add it to the bank, linked. For a story already in the bank, use link_story.',
      inputSchema: z.object({
        application: z.string(),
        framework: z.string().describe('Framework key or name (list_frameworks).'),
        ...storyFields,
        angle: z.string().optional().describe('How to frame it for this job.'),
        save_to_bank: z.boolean().optional().describe('Also add it to the bank (default false).'),
      }),
    },
    safe(async ({ application, framework, save_to_bank, ...input }) => {
      const c = await load();
      const a = findApp(c, application);
      const fw = findFramework(c, framework);
      let js = await call<JobStory>('POST', `/applications/${a.id}/stories`, {
        ...input,
        framework_key: fw.key,
      });
      if (save_to_bank)
        js = (
          await call<{ job_story: JobStory }>('POST', `/job-stories/${js.id}/save-as-new`, {
            once: true,
          })
        ).job_story;
      return {
        created: { ...storyOut(js, c), from_bank: !!js.story_id },
        application: `${a.company} · ${a.title}`,
      };
    }),
  );

  server.registerTool(
    'save_job_story_to_bank',
    {
      title: 'Save a job’s story to the bank',
      description:
        'Adds a job-only story to the bank (Stories) as a new story and links the job’s story to it. A story already linked to the bank needs nothing.',
      inputSchema: z.object({
        application: z.string(),
        story: z.string().describe('Its title or job story id.'),
      }),
    },
    safe(async ({ application, story }) => {
      const c = await load();
      const js = findJobStory(c, story, application);
      if (js.story_id)
        return { note: 'Already linked to the bank; nothing to do.', bank_story: js.story_id };
      const r = await call<{ job_story: JobStory; story: Story }>(
        'POST',
        `/job-stories/${js.id}/save-as-new`,
        { once: true },
      );
      return { saved: storyOut(r.story, c, false), job_story: r.job_story.id };
    }),
  );

  server.registerTool(
    'remove_job_story',
    {
      title: 'Remove a story from an application',
      description:
        'Takes a story off an application. One linked from the bank is just unlinked (the bank keeps it). A job-only story is deleted for good: that is a hard delete, so confirm with the owner first.',
      inputSchema: z.object({
        application: z.string(),
        story: z.string().describe('Its title or job story id.'),
      }),
      annotations: { destructiveHint: true },
    },
    safe(async ({ application, story }) => {
      const c = await load();
      const js = findJobStory(c, story, application);
      await call('DELETE', `/job-stories/${js.id}`);
      return js.story_id
        ? { removed: js.title, note: 'Taken off this job; the story stays in the bank.' }
        : { deleted: js.title, note: 'It was only on this job, so it is deleted.' };
    }),
  );

  server.registerTool(
    'delete_story',
    {
      title: 'Delete a bank story',
      description:
        'Hard delete from the bank (Stories), and it can’t be undone; archived stories too. Applications that had it linked keep their story as a job-only one. Confirm with the owner first; archiving (update_story with archived: true) is the gentler choice.',
      inputSchema: z.object({ story: z.string().describe('Title or id.') }),
      annotations: { destructiveHint: true },
    },
    safe(async ({ story }) => {
      const c = await load();
      const s = findStory(c, story, true);
      const kept = c.state.job_stories.filter((j) => j.story_id === s.id);
      await call('DELETE', `/stories/${s.id}`);
      return {
        deleted: s.title,
        ...(kept.length
          ? {
              kept_on_jobs: kept.map((j) => appName(c, j.application_id)),
              note: 'Those jobs keep it as their own.',
            }
          : {}),
      };
    }),
  );

  server.registerTool(
    'create_framework',
    {
      title: 'Add a story framework',
      description:
        'A custom story framework: a name and its sections (each with a key, a label and an optional prompt). Built-in frameworks can’t be changed; make a custom one instead.',
      inputSchema: z.object({
        name: z.string(),
        blurb: z.string().optional().describe('When to use it, in a line.'),
        sections: z
          .array(
            z.object({
              key: z.string().describe('lowercase_with_underscores'),
              label: z.string(),
              prompt: z.string().optional(),
            }),
          )
          .min(1),
      }),
    },
    safe(async (input) => ({ created: await call<Framework>('POST', '/frameworks', input) })),
  );

  server.registerTool(
    'update_framework',
    {
      title: 'Change a custom framework',
      description:
        'Renames a custom framework or changes its blurb or sections (pass the whole list). Built-in ones can’t change.',
      inputSchema: z.object({
        framework: z.string().describe('Its key or name.'),
        name: z.string().optional(),
        blurb: z.string().optional(),
        sections: z
          .array(z.object({ key: z.string(), label: z.string(), prompt: z.string().optional() }))
          .min(1)
          .optional(),
      }),
    },
    safe(async ({ framework, ...input }) => {
      const c = await load();
      const fw = findFramework(c, framework);
      const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      return { updated: await call<Framework>('PATCH', `/frameworks/${fw.key}`, body) };
    }),
  );

  server.registerTool(
    'delete_framework',
    {
      title: 'Delete a custom framework',
      description:
        'Deletes a custom framework no story uses (move them to another framework first). Confirm with the owner first.',
      inputSchema: z.object({ framework: z.string().describe('Its key or name.') }),
      annotations: { destructiveHint: true },
    },
    safe(async ({ framework }) => {
      const c = await load();
      const fw = findFramework(c, framework);
      await call('DELETE', `/frameworks/${fw.key}`);
      return { deleted: fw.name };
    }),
  );

  // ---------- questions ----------

  const questionOut = (q: Question, c: Ctx) => ({
    id: q.id,
    text: q.text,
    ...(q.archived ? { archived: true } : {}),
    on_jobs: c.state.job_questions
      .filter((j) => j.question_id === q.id)
      .map((j) => appName(c, j.application_id)),
  });

  server.registerTool(
    'list_questions',
    {
      title: 'Search the Question bank',
      description:
        'The owner’s bank of questions to ask in interviews, best match first, with the jobs each is on. Leave query empty for all of them.',
      inputSchema: z.object({ query: z.string().optional() }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ query }) => {
      const c = await load();
      const pool = c.state.questions.filter((q) => !q.archived);
      const hits = searchText(pool, query ?? '', (q) => q.text);
      return { count: hits.length, questions: hits.slice(0, 50).map((q) => questionOut(q, c)) };
    }),
  );

  server.registerTool(
    'list_archived_questions',
    {
      title: 'Find archived questions',
      description:
        'Archived bank questions, which list_questions leaves out. Each result is archived; to bring one back, only if the owner asks, call update_question with archived: false.',
      inputSchema: z.object({ query: z.string().optional() }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ query }) => {
      const c = await load();
      const hits = searchText(
        c.state.questions.filter((q) => q.archived),
        query ?? '',
        (q) => q.text,
      );
      return {
        note: 'These questions are archived: they are not in list_questions. To restore one when the owner asks, call update_question with its id and archived: false.',
        count: hits.length,
        questions: hits.slice(0, 50).map((q) => questionOut(q, c)),
      };
    }),
  );

  server.registerTool(
    'get_question',
    {
      title: 'Get a bank question',
      description:
        'One bank question and the applications it’s linked to. Also finds archived ones.',
      inputSchema: z.object({ question: z.string().describe('Its words (loosely) or id.') }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ question }) => {
      const c = await load();
      return questionOut(findQuestion(c, question, true), c);
    }),
  );

  server.registerTool(
    'create_question',
    {
      title: 'Add a question to the bank',
      description:
        'A question to ask in interviews, kept in the bank to reuse across jobs. To put it on a job too, follow with link_question (or use add_job_question with save_to_bank).',
      inputSchema: z.object({ text: z.string() }),
    },
    safe(async ({ text }) => {
      const c = await load();
      const same = c.state.questions.find((q) => norm(q.text) === norm(text));
      if (same) return { already_there: questionOut(same, c) };
      return { created: questionOut(await call<Question>('POST', '/questions', { text }), c) };
    }),
  );

  server.registerTool(
    'update_question',
    {
      title: 'Update a bank question',
      description:
        'Rewords a bank question: applications that have it linked and haven’t reworded it there take the new words too. Also archives it (archived: true) or brings an archived one back (archived: false, only when the owner asks).',
      inputSchema: z.object({
        question: z.string().describe('Its words (loosely) or id.'),
        text: z.string().optional(),
        archived: z.boolean().optional(),
      }),
    },
    safe(async ({ question, text, archived }) => {
      const c = await load();
      const q = findQuestion(c, question, true);
      const next = await call<Question>('PATCH', `/questions/${q.id}`, { text, archived });
      return { updated: questionOut(next, await load()) };
    }),
  );

  server.registerTool(
    'delete_question',
    {
      title: 'Delete a bank question',
      description:
        'Hard delete from the bank, and it can’t be undone. Applications that had it linked keep it as their own (job-only). Confirm with the owner first; archiving (update_question with archived: true) is the gentler choice.',
      inputSchema: z.object({ question: z.string().describe('Its words (loosely) or id.') }),
      annotations: { destructiveHint: true },
    },
    safe(async ({ question }) => {
      const c = await load();
      const q = findQuestion(c, question, true);
      const kept = c.state.job_questions.filter((j) => j.question_id === q.id);
      await call('DELETE', `/questions/${q.id}`);
      return {
        deleted: q.text,
        ...(kept.length
          ? {
              kept_on_jobs: kept.map((j) => appName(c, j.application_id)),
              note: 'Those jobs keep it as their own.',
            }
          : {}),
      };
    }),
  );

  server.registerTool(
    'add_job_question',
    {
      title: 'Add a question to an application',
      description:
        'A question written just for this application (job-only); it comes up on every call for the job. Pass save_to_bank to keep it in the bank too, linked. For a question already in the bank, use link_question.',
      inputSchema: z.object({
        application: z.string(),
        text: z.string(),
        save_to_bank: z.boolean().optional().describe('Also keep it in the bank (default false).'),
      }),
    },
    safe(async ({ application, text, save_to_bank }) => {
      const c = await load();
      const a = findApp(c, application);
      const dup = c.state.job_questions.find(
        (j) => j.application_id === a.id && norm(j.text) === norm(text),
      );
      if (dup) return { already_there: jobQuestionOut(dup) };
      const jq = await call<JobQuestion>('POST', `/applications/${a.id}/questions`, {
        text,
        to_bank: !!save_to_bank,
      });
      return { added: jobQuestionOut(jq), application: `${a.company} · ${a.title}` };
    }),
  );

  server.registerTool(
    'link_question',
    {
      title: 'Link a bank question to an application',
      description:
        'Puts a bank question on an application, linked: it comes up on every call for the job and follows the bank question while unchanged there.',
      inputSchema: z.object({
        application: z.string(),
        question: z.string().describe('The bank question’s words (loosely) or id.'),
      }),
    },
    safe(async ({ application, question }) => {
      const c = await load();
      const a = findApp(c, application);
      const q = findQuestion(c, question);
      const dup = c.state.job_questions.find(
        (j) => j.application_id === a.id && j.question_id === q.id,
      );
      if (dup) return { already_there: jobQuestionOut(dup) };
      const jq = await call<JobQuestion>('POST', `/applications/${a.id}/questions`, {
        question_id: q.id,
      });
      return { linked: jobQuestionOut(jq), application: `${a.company} · ${a.title}` };
    }),
  );

  server.registerTool(
    'update_job_question',
    {
      title: 'Edit a question on an application',
      description:
        'Rewords one of an application’s questions, or moves it in the list (position). The bank question never changes. Rewording one linked from the bank makes it a job-only variant: the job keeps the new words and it stops following the bank. To reword it everywhere instead, use update_question.',
      inputSchema: z.object({
        application: z.string(),
        question: z.string().describe('Its words (loosely) or job question id.'),
        text: z.string().optional(),
        position: z.number().int().min(0).optional().describe('Its place in the list, from 0.'),
      }),
    },
    safe(async ({ application, question, text, position }) => {
      const c = await load();
      const jq = findJobQuestion(c, question, application);
      const next = await call<JobQuestion>('PATCH', `/job-questions/${jq.id}`, { text, position });
      return {
        updated: jobQuestionOut(next),
        ...(jq.question_id && !next.question_id
          ? {
              note: 'This is now a job-only variant: it no longer follows the bank question, which is unchanged.',
            }
          : {}),
      };
    }),
  );

  server.registerTool(
    'save_job_question_to_bank',
    {
      title: 'Save a job’s question to the bank',
      description:
        'Adds a job-only question to the bank and links the job’s question to it. One already linked needs nothing.',
      inputSchema: z.object({
        application: z.string(),
        question: z.string().describe('Its words (loosely) or job question id.'),
      }),
    },
    safe(async ({ application, question }) => {
      const c = await load();
      const jq = findJobQuestion(c, question, application);
      if (jq.question_id)
        return {
          note: 'Already linked to the bank; nothing to do.',
          bank_question: jq.question_id,
        };
      const next = await call<JobQuestion>('POST', `/job-questions/${jq.id}/to-bank`);
      return { saved: jobQuestionOut(next) };
    }),
  );

  server.registerTool(
    'remove_job_question',
    {
      title: 'Remove a question from an application',
      description:
        'Takes a question off an application. One linked from the bank is just unlinked (the bank keeps it). A job-only question is deleted for good: that is a hard delete, so confirm with the owner first. Answers already noted on past meetings stay.',
      inputSchema: z.object({
        application: z.string(),
        question: z.string().describe('Its words (loosely) or job question id.'),
      }),
      annotations: { destructiveHint: true },
    },
    safe(async ({ application, question }) => {
      const c = await load();
      const jq = findJobQuestion(c, question, application);
      await call('DELETE', `/job-questions/${jq.id}`);
      return jq.question_id
        ? { removed: jq.text, note: 'Taken off this job; the question stays in the bank.' }
        : { deleted: jq.text, note: 'It was only on this job, so it is deleted.' };
    }),
  );

  // A meeting's questions: the job's (on every call) and the meeting's own, with what was said.

  server.registerTool(
    'get_meeting_questions',
    {
      title: 'A meeting’s questions',
      description:
        'The questions for one meeting, as Call Mode shows them: the application’s questions (from: job) and the meeting’s own (from: meeting), each with whether it was asked and the answer noted.',
      inputSchema: z.object({ meeting: z.string().describe('The meeting’s event id.') }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ meeting }) => {
      const c = await load();
      const ev = findMeeting(c, meeting);
      return {
        meeting: ev.id,
        title: ev.title,
        when: whenIn(ev.occurred_at, c.tz),
        questions: meetingQuestions(c, ev).map(callQuestionOut),
      };
    }),
  );

  server.registerTool(
    'add_meeting_question',
    {
      title: 'Add a question to a meeting',
      description:
        'A question for one meeting only: new words (text), or a bank question (question). For one to ask on every call for the job, use add_job_question or link_question instead.',
      inputSchema: z.object({
        meeting: z.string().describe('The meeting’s event id.'),
        text: z.string().optional(),
        question: z.string().optional().describe('A bank question’s words (loosely) or id.'),
        save_to_bank: z.boolean().optional().describe('With text: also keep it in the bank.'),
      }),
    },
    safe(async ({ meeting, text, question, save_to_bank }) => {
      if (!text === !question) throw new ToolError('Pass text or question (a bank question).');
      const c = await load();
      const ev = findMeeting(c, meeting);
      const list = meetingQuestions(c, ev);
      let entry: CallQuestion;
      if (question) {
        const q = findQuestion(c, question);
        entry = {
          id: `q${crypto.randomUUID()}`,
          text: q.text,
          answer: null,
          asked: false,
          question_id: q.id,
        };
      } else {
        entry = { id: `q${crypto.randomUUID()}`, text: text!.trim(), answer: null, asked: false };
        if (save_to_bank) {
          const q = await call<Question>('POST', '/questions/from-text', { text: entry.text });
          entry.question_id = q.id;
        }
      }
      const dup = list.find((q) => norm(q.text) === norm(entry.text));
      if (dup) return { already_there: callQuestionOut(dup) };
      return saveMeetingQuestions(ev, [...list, entry]);
    }),
  );

  server.registerTool(
    'update_meeting_question',
    {
      title: 'Note an answer or change a meeting question',
      description:
        'On one meeting’s question: mark it asked, note what was said (answer), reword it (the meeting’s own only), save it to the bank, or remove it from the meeting. A job question comes up on every call: reword or remove it for the job with update_job_question or remove_job_question.',
      inputSchema: z.object({
        meeting: z.string().describe('The meeting’s event id.'),
        question: z.string().describe('Its id (from get_meeting_questions) or words.'),
        asked: z.boolean().optional(),
        answer: z.string().optional().describe('What was said; an empty string clears it.'),
        text: z.string().optional(),
        save_to_bank: z.boolean().optional(),
        remove: z.boolean().optional(),
      }),
    },
    safe(async ({ meeting, question, asked, answer, text, save_to_bank, remove }) => {
      const c = await load();
      const ev = findMeeting(c, meeting);
      const list = meetingQuestions(c, ev);
      const q = pick(
        list,
        question,
        (x) => [x.text],
        'question on that meeting',
        (x) => `“${x.text}” [id ${x.id}]`,
      );
      if ((remove || text !== undefined) && q.job_question_id)
        throw new ToolError(
          'That is one of the job’s questions (it comes up on every call). Change it with update_job_question or remove_job_question.',
        );
      if (remove)
        return saveMeetingQuestions(
          ev,
          list.filter((x) => x.id !== q.id),
        );
      const next: CallQuestion = { ...q };
      if (asked !== undefined) next.asked = asked;
      if (answer !== undefined) {
        next.answer = answer.trim() || null;
        if (answer.trim() && asked === undefined) next.asked = true;
      }
      if (text !== undefined && text.trim()) next.text = text.trim();
      if (save_to_bank && !next.question_id) {
        if (next.job_question_id) {
          const jq = await call<JobQuestion>(
            'POST',
            `/job-questions/${next.job_question_id}/to-bank`,
          );
          next.question_id = jq.question_id;
        } else {
          const bank = await call<Question>('POST', '/questions/from-text', { text: next.text });
          next.question_id = bank.id;
        }
      }
      return saveMeetingQuestions(
        ev,
        list.map((x) => (x.id === q.id ? next : x)),
      );
    }),
  );

  // ---------- files ----------

  server.registerTool(
    'upload_link',
    {
      title: 'Get an upload link',
      description:
        'A one-time link (30 minutes) the person opens to attach a resume, cover letter, transcript or offer letter to an application. Give them the link.',
      inputSchema: z.object({
        application: z.string(),
        kind: z.enum(FILE_KIND_KEYS).optional(),
        meeting: z.string().optional().describe('For a transcript: the meeting’s event id.'),
      }),
    },
    safe(async ({ application, kind, meeting }) => {
      const c = await load();
      const a = findApp(c, application);
      return call('POST', '/upload-links', {
        application_id: a.id,
        kind: kind ?? 'resume',
        event_id: meeting,
      });
    }),
  );

  server.registerTool(
    'add_text_file',
    {
      title: 'Save text as a file',
      description:
        'Saves text you already have (a call transcript, a cover letter draft) as a file on an application, readable later with get_file_text. It also adds a "File added" note to the timeline. Without an application it goes in the Files library on no job (link it later with link_file).',
      inputSchema: z.object({
        application: z.string().optional(),
        text: z.string(),
        kind: z.enum(FILE_KIND_KEYS).optional().describe('Default transcript.'),
        filename: z.string().optional(),
        meeting: z.string().optional().describe('For a transcript: the meeting’s event id.'),
        label: z.string().optional(),
      }),
    },
    safe(async ({ application, meeting, ...rest }) => {
      const c = await load();
      const a = application ? findApp(c, application) : null;
      const f = await call<FileRef>(
        'POST',
        a ? `/applications/${a.id}/text-files` : '/text-files',
        {
          ...rest,
          event_id: meeting,
        },
      );
      return { saved: { id: f.id, filename: f.filename, kind: f.kind } };
    }),
  );

  server.registerTool(
    'get_file_text',
    {
      title: 'Read a file',
      description:
        'The text of a transcript or other text file (by id, from get_application’s files).',
      inputSchema: z.object({
        file: z.string(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1000).max(200_000).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ file, offset, limit }) => {
      const { filename, text } = await call<{ filename: string; text: string }>(
        'GET',
        `/files/${file}/text`,
      );
      const from = offset ?? 0;
      const n = limit ?? 60_000;
      return {
        filename,
        total_chars: text.length,
        offset: from,
        text: text.slice(from, from + n),
        more: from + n < text.length,
      };
    }),
  );

  server.registerTool(
    'list_files',
    {
      title: 'List files',
      description:
        'Every file (the Files page), on jobs or on none, newest first, with the jobs each is on. Match by name or label, or narrow to a kind or an application.',
      inputSchema: z.object({
        query: z.string().optional(),
        kind: z.enum(FILE_KIND_KEYS).optional(),
        application: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ query, kind, application }) => {
      const c = await load();
      let pool = [...c.state.files].sort((x, y) => y.created_at.localeCompare(x.created_at));
      if (kind) pool = pool.filter((f) => f.kind === kind);
      if (application) {
        const a = findApp(c, application);
        pool = pool.filter((f) => f.application_ids.includes(a.id));
      }
      if (query) {
        const words = norm(query).split(' ').filter(Boolean);
        pool = pool.filter((f) =>
          words.every((w) => norm(`${f.label ?? ''} ${f.filename}`).includes(w)),
        );
      }
      return { count: pool.length, files: pool.slice(0, 50).map((f) => fileOut(f, c)) };
    }),
  );

  server.registerTool(
    'link_file',
    {
      title: 'Put a file on jobs',
      description:
        'Puts a file you already have (a resume sent to several jobs) on one or more applications. Each gets a "File added" note on its timeline; a job it’s already on is left as it is.',
      inputSchema: z.object({
        file: z.string().describe('Its label, filename or id (list_files).'),
        applications: z.array(z.string()).min(1),
      }),
    },
    safe(async ({ file, applications }) => {
      const c = await load();
      const f = findFile(c, file);
      let next = f;
      for (const key of applications) {
        const a = findApp(c, key);
        next = await call<FileRef>('POST', `/applications/${a.id}/files/${f.id}`);
      }
      return { file: fileOut(next, c) };
    }),
  );

  server.registerTool(
    'unlink_file',
    {
      title: 'Take a file off a job',
      description:
        'Takes a file off one application (its "File added" note there goes). The file stays in the library and on any other jobs. To delete the file itself, use delete_file.',
      inputSchema: z.object({
        file: z.string().describe('Its label, filename or id.'),
        application: z.string(),
      }),
    },
    safe(async ({ file, application }) => {
      const c = await load();
      const f = findFile(c, file);
      const a = findApp(c, application);
      if (!f.application_ids.includes(a.id))
        throw new ToolError(`${f.label ?? f.filename} isn’t on ${a.company} · ${a.title}.`);
      const next = await call<FileRef>('DELETE', `/applications/${a.id}/files/${f.id}`);
      return { file: fileOut(next, c) };
    }),
  );

  server.registerTool(
    'update_file',
    {
      title: 'Update a file',
      description:
        'Changes a file’s name (label, also its timeline title), its kind, or the meeting a transcript belongs to.',
      inputSchema: z.object({
        file: z.string().describe('Its label, filename or id.'),
        label: z.string().optional(),
        kind: z.enum(FILE_KIND_KEYS).optional(),
        meeting: z.string().nullable().optional().describe('A meeting’s event id; null for none.'),
      }),
    },
    safe(async ({ file, label, kind, meeting }) => {
      const c = await load();
      const f = findFile(c, file);
      const body: Record<string, unknown> = {};
      if (label !== undefined) body.label = label;
      if (kind !== undefined) body.kind = kind;
      if (meeting !== undefined) body.event_id = meeting;
      return { updated: fileOut(await call<FileRef>('PATCH', `/files/${f.id}`, body), c) };
    }),
  );

  server.registerTool(
    'delete_file',
    {
      title: 'Delete a file',
      description:
        'Hard delete, and it can’t be undone: the file itself, from every job it’s on, with its "File added" notes. Confirm with the owner first; to take it off one job only, use unlink_file.',
      inputSchema: z.object({ file: z.string().describe('Its label, filename or id.') }),
      annotations: { destructiveHint: true },
    },
    safe(async ({ file }) => {
      const c = await load();
      const f = findFile(c, file);
      await call('DELETE', `/files/${f.id}`);
      return {
        deleted: f.label ?? f.filename,
        was_on: f.application_ids.map((id) => appName(c, id)),
      };
    }),
  );

  // ---------- prompts ----------

  const ask = (text: string) => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
  });

  server.registerPrompt(
    'add_jobs',
    {
      title: 'Add jobs from links',
      description: 'Read each posting and add it as a Saved application.',
      argsSchema: z.object({ links: z.string().describe('One or more job posting links.') }),
    },
    ({ links }) =>
      ask(`Add these jobs to Knock Knock:\n${links}\n\nFor each link:
1. find_applications with the url. If it's already tracked, say so and skip it.
2. read_posting with its link (it reads the full posting, even pages built with JavaScript; if it can't, ask me to paste the text). Use the fields it states as read, and pull out title, company, comp (min, max, currency, period, or salary_text), location and work mode, seniority, reports-to, team, employment type, posted date, must-haves and nice-to-haves, and the full description text.
3. Fill in company basics you can find quickly and reliably: domain, website, HQ, size band, industry, funding stage. Don't guess; leave out what you can't find. If the company has no logo in Knock Knock yet and you can find its logo image quickly (its own site is best), attach it with set_company_logo; if you know its brand color, set the closest color too.
4. create_application with status saved and source set to where the link came from. List anything you inferred (not read) in inferred.
Finish with a one-line summary per job: company, title, comp, work mode.`),
  );

  server.registerPrompt(
    'sync_inbox',
    {
      title: 'Log what happened in my inbox',
      description:
        'Read recent email and calendar invites and write them to the right timelines, without duplicates.',
      argsSchema: z.object({
        since: z.string().optional().describe('How far back, e.g. "24 hours" (default 1 day).'),
      }),
    },
    ({ since }) =>
      ask(`Check my email and calendar from the last ${since || '24 hours'} for anything about my job applications, and log it in Knock Knock.

1. round_overview for the open applications, their companies and people.
2. Search my email for those companies, their domains and people, and for applications in general (confirmations, scheduling, rejections, offers). Hiring-site senders (greenhouse, lever, ashby, workday) don't show the company in the address: read the subject and body.
3. For each relevant email or invite, find_applications to pick the application. If it doesn't clearly match one, list it for me at the end instead of guessing.
4. Before writing, get_timeline around its date (days 3, same type). If it's already there, update it (add the join link, attendees, external_ref) rather than adding another.
5. Write it: log_email with a summary (not the whole email), category, key points and the message id as external_ref; log_meeting for invites with the calendar event id as external_ref. When an email changes the status ("thanks for applying" → applied, a scheduling email → screening or interviewing, a rejection → rejected), set_status with caused_by pointing at the email event.
6. Check each answer's nearby events for a duplicate you just made, and fix it.
Finish with what you logged, per application, and anything you couldn't place.`),
  );

  server.registerPrompt(
    'prep_interview',
    {
      title: 'Prep me for an interview',
      description: 'Who’s in the room, what to expect, and which stories to bring.',
      argsSchema: z.object({ application: z.string().describe('The company, named loosely.') }),
    },
    ({ application }) =>
      ask(`Prep me for my next interview with ${application} in Knock Knock.

1. get_application and find the next upcoming meeting: when, who, agenda.
2. From the timeline (earlier meetings and their debrief notes), say what each interviewer has already seen of me.
3. Read the must-haves and description. list_stories with the questions they're likely to ask; suggest 4–6 stories (linked ones first), each with the angle for this job.
4. Suggest three sharp questions to ask them: start from the application's questions (get_application) and the Question bank (list_questions).
Ask before linking new stories (link_story), saving angles (update_job_story) or adding questions (link_question, add_job_question).`),
  );

  server.registerPrompt(
    'debrief',
    {
      title: 'Debrief an interview',
      description: 'Turns your notes or a transcript into a debrief note under the meeting.',
      argsSchema: z.object({
        application: z.string(),
        notes: z
          .string()
          .optional()
          .describe('Your notes, or leave empty to use a saved transcript.'),
      }),
    },
    ({ application, notes }) =>
      ask(`Debrief my latest interview with ${application} in Knock Knock.${notes ? `\n\nMy notes:\n${notes}` : ''}

1. get_application; find the meeting that just happened (update_meeting state held if it's still scheduled). If there's a transcript file, read it with get_file_text.
2. Write a debrief note under the meeting (add_note with about_event): what they asked, how I answered, what landed, what didn't, open questions, and next steps.
3. Draft short thank-you notes for each interviewer, and ask before logging any I send.`),
  );

  server.registerPrompt(
    'weekly_review',
    {
      title: 'Weekly search review',
      description: 'What moved, what went quiet, and one thing to change next week.',
      argsSchema: z.object({}),
    },
    () =>
      ask(`Give me a review of my job search this week from Knock Knock.

1. round_overview. Count what was added, sent, and moved forward or closed in the last 7 days (get_application on the ones that moved).
2. List what's gone quiet (follow_up and maybe_ghosted) with a one-line suggested nudge for each.
3. Note anything waiting for a debrief and any interviews next week.
4. End with one concrete thing to change next week, with the reason. Don't change any data.`),
  );

  return server;
}

/** The OAuthProvider apiHandler for /mcp. Only reached with a valid token. */
export const mcpApiHandler = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    const origin = new URL(request.url).origin;
    const props = (ctx as ExecutionContext & { props?: { client?: unknown } }).props;
    const agent = typeof props?.client === 'string' ? props.client : 'Assistant';
    const call = apiCaller(origin, env, ctx, agent);
    const handler = createMcpHandler(() => buildServer(call));
    return handler.fetch(request);
  },
};
