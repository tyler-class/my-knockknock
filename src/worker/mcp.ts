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
import { searchStories, syncState, frameworkOf } from '@shared/logic/stories';
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
  Company,
  EmailData,
  FileRef,
  JobStory,
  MeetingData,
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
    'Stories: a story is just its framework’s parts (no hook, tags or probable questions). list_stories rounds the bank by the question being asked, matching titles, frameworks and the parts’ text. link_story copies a bank story to an application; edits to the copy stay with that job.',
    'Archived stories are left out of list_stories, round_overview and get_started. To find one, use list_archived_stories; if the owner asks to bring one back, call update_story with archived: false.',
    'To attach a file the person has (resume, transcript), call upload_link and give them the link; a file seen in the chat cannot be passed to a tool. For a transcript you already have as text, use add_text_file. Adding a file puts a "File added" note on the timeline (with file_id); change its time with update_event if the file belongs to an earlier moment.',
    'People have a role (recruiter, hiring_manager, interviewer, referrer or other); for other, put their actual role in other_role.',
    'Companies show their logo, or without one a monogram (their initial) on an ultramarine tile. set_company_logo attaches a logo from an image on the web (find the company’s own logo and pass the image’s address) and sets the monogram’s color: if you know the brand color you may pick the closest of the ten, otherwise leave the default.',
  ].join(' ') + GETTING_STARTED;

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
        'Everything about one application: posting fields, company basics, people, the timeline (upcoming meetings first, then newest first, with notes under the event they’re about), stories linked to it, and files.',
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
          sync: syncState(
            j,
            c.state.stories.find((s) => s.id === j.story_id),
          ),
          ...(j.angle ? { angle: j.angle } : {}),
        })),
        files: files.map((f) => ({
          id: f.id,
          kind: f.kind,
          filename: f.filename,
          label: f.label,
          added: whenIn(f.created_at, c.tz),
          readable_text: f.has_text,
        })),
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

  server.registerTool(
    'add_person',
    {
      title: 'Add a person',
      description:
        'A recruiter, hiring manager, interviewer or referrer on an application. Their email helps match future emails.',
      inputSchema: z.object({
        application: z.string(),
        name: z.string(),
        email: z.string().optional(),
        title: z.string().optional(),
        role: z.enum(PERSON_ROLE_KEYS).optional(),
        other_role: z
          .string()
          .optional()
          .describe('When role is other: their actual role, e.g. "Head of Talent".'),
        linkedin: z.string().optional(),
        notes: z.string().optional(),
      }),
    },
    safe(async ({ application, ...input }) => {
      const c = await load();
      const a = findApp(c, application);
      const dup = c.state.people.find(
        (p) =>
          p.application_ids.includes(a.id) &&
          ((input.email && p.email?.toLowerCase() === input.email.toLowerCase()) ||
            norm(p.name) === norm(input.name)),
      );
      if (dup) return { already_there: dup };
      return { added: await call('POST', `/applications/${a.id}/people`, input) };
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
      description: 'One bank story in full, and which applications have a copy of it.',
      inputSchema: z.object({ story: z.string().describe('Title or id.') }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ story }) => {
      const c = await load();
      const s = findStory(c, story);
      return {
        ...storyOut(s, c),
        version: s.version,
        copies: c.state.job_stories
          .filter((j) => j.story_id === s.id)
          .map((j) => {
            const a = c.state.applications.find((x) => x.id === j.application_id);
            return {
              job_story: j.id,
              application: a ? `${a.company} · ${a.title}` : j.application_id,
              sync: syncState(j, s),
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
        'Changes a bank story (its version goes up). Job copies don’t change until someone pulls. Also finds archived stories: pass archived: false to bring one back (only when the owner asks), or archived: true to archive one.',
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
        'Copies a bank story to an application, optionally with an angle (how to frame it for this job). Edits to the copy stay with that job.',
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
        'Edits the application’s copy of a story (its angle, title or sections). The bank story doesn’t change.',
      inputSchema: z.object({
        application: z.string(),
        story: z.string().describe('The copy’s title or job story id.'),
        angle: z.string().optional(),
        ...Object.fromEntries(Object.entries(storyFields).map(([k, v]) => [k, v.optional()])),
      }),
    },
    safe(
      async ({
        application,
        story,
        ...input
      }: { application: string; story: string } & Record<string, unknown>) => {
        const c = await load();
        const js = findJobStory(c, story, application);
        const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
        return {
          updated: storyOut(await call<JobStory>('PATCH', `/job-stories/${js.id}`, body), c),
        };
      },
    ),
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
        'Saves text you already have (a call transcript, a cover letter draft) as a file on an application, readable later with get_file_text. It also adds a "File added" note to the timeline.',
      inputSchema: z.object({
        application: z.string(),
        text: z.string(),
        kind: z.enum(FILE_KIND_KEYS).optional().describe('Default transcript.'),
        filename: z.string().optional(),
        meeting: z.string().optional().describe('For a transcript: the meeting’s event id.'),
        label: z.string().optional(),
      }),
    },
    safe(async ({ application, meeting, ...rest }) => {
      const c = await load();
      const a = findApp(c, application);
      const f = await call<FileRef>('POST', `/applications/${a.id}/text-files`, {
        ...rest,
        event_id: meeting,
      });
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
4. Suggest three sharp questions to ask them.
Ask before linking new stories (link_story) or saving angles (update_job_story).`),
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
