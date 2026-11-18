// Searches, applications, their timelines and the people on them.
//
// Status is never a plain field: changing it writes a status event, and the application's
// status column is recomputed from the timeline (db.ts refreshApplication). Every timeline write
// answers with the event, the application and what's nearby on its timeline, so an assistant can
// spot a duplicate it just made and fix it in the same turn.
import { Hono } from 'hono';
import type { z } from 'zod';
import { isOpen } from '@shared/lookups';
import {
  applicationInput,
  applicationPatch,
  emailInput,
  emailPatch,
  meetingInput,
  meetingPatch,
  noteInput,
  notePatch,
  personInput,
  personPatch,
  searchInput,
  searchPatch,
  statusInput,
} from '@shared/schemas';
import { deriveStatus } from '@shared/logic/status';
import { nearby } from '@shared/logic/timeline';
import { EVENT_TYPES, type EventType } from '@shared/lookups';
import type { EmailData, MeetingData, StatusData, TimelineEvent } from '@shared/types';
import { agentName, isInternal } from '../auth';
import {
  all,
  currentSearchId,
  encode,
  first,
  insertStmt,
  loadApplication,
  loadApplications,
  loadEvent,
  loadEvents,
  newId,
  nowIso,
  refreshApplication,
  saveSetting,
  toPerson,
  toSearch,
  updateStmt,
} from '../db';
import { ApiError, body, defined, notFound, type AppEnv, type Ctx } from './util';

export const applications = new Hono<AppEnv>();

const exists = async (db: D1Database, table: string, id: string) =>
  !!(await first(db, `SELECT id FROM ${table} WHERE id = ?`, id));

/** Who wrote it: the assistant on an MCP request, else the person in the app. */
const by = (c: Ctx) =>
  isInternal(c.env)
    ? { source: 'agent', source_name: agentName(c.env) }
    : { source: 'manual', source_name: null };

// ---------- searches ----------

applications.post('/searches', async (c) => {
  const input = await body(c, searchInput);
  const id = newId();
  const now = nowIso();
  await insertStmt(c.env.DB, 'searches', {
    id,
    ...input,
    started_on: input.started_on ?? now.slice(0, 10),
    created_at: now,
    updated_at: now,
  }).run();
  await saveSetting(c.env.DB, 'current_search_id', id);
  return c.json(toSearch((await first(c.env.DB, 'SELECT * FROM searches WHERE id = ?', id))!), 201);
});

applications.patch('/searches/:id', async (c) => {
  const id = c.req.param('id');
  const input = defined(await body(c, searchPatch));
  if (!(await exists(c.env.DB, 'searches', id))) throw notFound('Search');
  if (input.status && input.status !== 'active' && !('ended_on' in input))
    input.ended_on = nowIso().slice(0, 10);
  if (Object.keys(input).length) await updateStmt(c.env.DB, 'searches', id, input).run();
  return c.json(toSearch((await first(c.env.DB, 'SELECT * FROM searches WHERE id = ?', id))!));
});

applications.delete('/searches/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await exists(c.env.DB, 'searches', id))) throw notFound('Search');
  // Its applications (and their timelines) go too; the app confirms first.
  await c.env.DB.prepare('DELETE FROM searches WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// ---------- applications ----------

/** Same posting already saved? (By URL, ignoring tracking parameters and a trailing slash.) */
export function canonicalUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()])
      if (/^(utm_|ref$|source$|gh_src$|trk|lever-source|src$)/i.test(k)) x.searchParams.delete(k);
    x.hash = '';
    return x.toString().replace(/\/$/, '');
  } catch {
    return u;
  }
}

applications.get('/applications', async (c) => {
  // A plain search for assistants: company, title, domain, URL or a person's email.
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const status = c.req.query('status');
  const url = canonicalUrl(c.req.query('url'));
  let list = await loadApplications(c.env.DB);
  if (url) list = list.filter((a) => canonicalUrl(a.url) === url);
  if (status) {
    const want = status.split(',');
    list = list.filter(
      (a) => want.includes(a.status) || (want.includes('open') && isOpen(a.status)),
    );
  }
  if (q) {
    const people = await all<{ application_id: string; hay: string }>(
      c.env.DB,
      "SELECT application_id, lower(name || ' ' || coalesce(email, '')) AS hay FROM people",
    );
    const words = q.split(/\s+/);
    list = list.filter((a) => {
      const hay = [
        a.company,
        a.title,
        a.company_domain ?? '',
        a.url ?? '',
        ...people.filter((p) => p.application_id === a.id).map((p) => p.hay),
      ]
        .join(' ')
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  return c.json({ applications: list });
});

applications.get('/applications/:id', async (c) => {
  const app = await loadApplication(c.env.DB, c.req.param('id'));
  if (!app) throw notFound('Application');
  return c.json(app);
});

applications.post('/applications', async (c) => {
  const { status, occurred_at, search_id, ...input } = await body(c, applicationInput);
  const db = c.env.DB;
  const sid = search_id ?? (await currentSearchId(db));
  if (!(await exists(db, 'searches', sid)))
    throw new ApiError(400, 'invalid', 'That search no longer exists.');
  const id = newId();
  const now = nowIso();
  const at = occurred_at ?? now;
  const created: StatusData = { from: null, to: status, reason: null, caused_by: null };
  await db.batch([
    insertStmt(db, 'applications', {
      id,
      search_id: sid,
      status,
      ...encode({ ...input, url: input.url }),
      applied_on: input.applied_on ?? (status !== 'saved' ? at.slice(0, 10) : null),
      created_at: now,
      updated_at: now,
      last_activity_at: at < now ? at : now,
    }),
    insertStmt(db, 'events', {
      id: newId(),
      application_id: id,
      type: 'created',
      occurred_at: at,
      title: null,
      body: null,
      ...by(c),
      data: JSON.stringify(created),
      created_at: now,
      updated_at: now,
    }),
  ]);
  await refreshApplication(db, id);
  return c.json(await loadApplication(db, id), 201);
});

applications.patch('/applications/:id', async (c) => {
  const id = c.req.param('id');
  const input = defined(await body(c, applicationPatch));
  if (!(await exists(c.env.DB, 'applications', id))) throw notFound('Application');
  if (input.search_id && !(await exists(c.env.DB, 'searches', input.search_id)))
    throw new ApiError(400, 'invalid', 'That search no longer exists.');
  if (Object.keys(input).length)
    await updateStmt(c.env.DB, 'applications', id, encode(input)).run();
  return c.json(await loadApplication(c.env.DB, id));
});

applications.delete('/applications/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await exists(c.env.DB, 'applications', id))) throw notFound('Application');
  // Its timeline, people and story copies go too; its files stay in your library.
  await c.env.DB.prepare('DELETE FROM applications WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// ---------- timeline ----------

/** What a timeline write answers with. */
async function written(c: Ctx, event: TimelineEvent | null, applicationId: string, status = 200) {
  await refreshApplication(c.env.DB, applicationId);
  const [application, events] = await Promise.all([
    loadApplication(c.env.DB, applicationId),
    loadEvents(c.env.DB, applicationId),
  ]);
  const near = event
    ? nearby(
        events.filter((e) => e.id !== event.id),
        event.occurred_at,
        3,
      ).slice(0, 8)
    : [];
  return c.json({ event, application, nearby: near }, status as 200 | 201);
}

async function insertEvent(
  c: Ctx,
  applicationId: string,
  type: EventType,
  fields: {
    occurred_at: string;
    title?: string | null;
    body?: string | null;
    external_ref?: string | null;
    parent_id?: string | null;
    data: object;
  },
): Promise<TimelineEvent> {
  const id = newId();
  const now = nowIso();
  try {
    await insertStmt(c.env.DB, 'events', {
      id,
      application_id: applicationId,
      type,
      occurred_at: fields.occurred_at,
      title: fields.title ?? null,
      body: fields.body ?? null,
      ...by(c),
      external_ref: fields.external_ref ?? null,
      parent_id: fields.parent_id ?? null,
      data: JSON.stringify(fields.data),
      created_at: now,
      updated_at: now,
    }).run();
  } catch (e) {
    if (/UNIQUE constraint failed/i.test((e as Error).message) && fields.external_ref) {
      const prev = await first<{ id: string }>(
        c.env.DB,
        'SELECT id FROM events WHERE application_id = ? AND external_ref = ?',
        applicationId,
        fields.external_ref,
      );
      throw new ApiError(
        409,
        'duplicate',
        'That was already logged on this application (same external_ref). Update the existing event instead.',
        { event_id: prev?.id },
      );
    }
    throw e;
  }
  return (await loadEvent(c.env.DB, id))!;
}

async function needApp(c: Ctx) {
  const id = c.req.param('id')!;
  if (!(await exists(c.env.DB, 'applications', id))) throw notFound('Application');
  return id;
}

applications.get('/applications/:id/timeline', async (c) => {
  const id = await needApp(c);
  let events = await loadEvents(c.env.DB, id);
  const types = (c.req.query('types') ?? '')
    .split(',')
    .filter((t): t is EventType => (EVENT_TYPES as readonly string[]).includes(t));
  const around = c.req.query('around');
  if (around) {
    const at = Date.parse(around);
    if (Number.isNaN(at)) throw new ApiError(400, 'invalid', 'around must be a date or timestamp.');
    const days = Math.min(Math.max(Number(c.req.query('days') ?? 3) || 3, 0), 60);
    events = nearby(events, new Date(at).toISOString(), days, types.length ? types : undefined);
  } else if (types.length) events = events.filter((e) => types.includes(e.type));
  return c.json({ events });
});

applications.post('/applications/:id/status', async (c) => {
  const id = await needApp(c);
  const input = await body(c, statusInput);
  const db = c.env.DB;
  const at = input.occurred_at ?? nowIso();
  if (
    input.caused_by &&
    !(await first(
      db,
      'SELECT id FROM events WHERE id = ? AND application_id = ?',
      input.caused_by,
      id,
    ))
  )
    throw new ApiError(400, 'invalid', 'caused_by must be an event on this application.');
  const events = await loadEvents(db, id);
  const before = deriveStatus(events.filter((e) => e.occurred_at <= at)).status;
  const current = deriveStatus(events).status;
  // Marking the search Accepted (when asked) works even if the job is already Accepted.
  const closeSearch = async () => {
    if (input.status !== 'accepted' || !input.close_search) return;
    const app = await loadApplication(db, id);
    await db
      .prepare(
        "UPDATE searches SET status = 'accepted', ended_on = COALESCE(ended_on, ?), updated_at = ? WHERE id = ?",
      )
      .bind(at.slice(0, 10), nowIso(), app!.search_id)
      .run();
  };
  if (current === input.status && !input.occurred_at) {
    await closeSearch();
    return written(c, null, id);
  }
  const data: StatusData = {
    from: before,
    to: input.status,
    reason: input.reason,
    caused_by: input.caused_by ?? null,
  };
  const event = await insertEvent(c, id, 'status', {
    occurred_at: at,
    external_ref: input.external_ref,
    data,
  });
  if (input.status !== 'saved' && (isOpen(input.status) || input.status === 'accepted')) {
    await db
      .prepare('UPDATE applications SET applied_on = COALESCE(applied_on, ?) WHERE id = ?')
      .bind(at.slice(0, 10), id)
      .run();
  }
  // Accepting doesn't close the search by itself: the app (or an assistant) asks first, then
  // passes close_search. Other open applications are listed so you can decline them; nothing is
  // declined without asking.
  await closeSearch();
  return written(c, event, id, 201);
});

/** Other open applications in the same search: what accepting an offer leaves to decline. */
applications.get('/applications/:id/others-open', async (c) => {
  const app = await loadApplication(c.env.DB, c.req.param('id'));
  if (!app) throw notFound('Application');
  const others = (await loadApplications(c.env.DB)).filter(
    (a) => a.search_id === app.search_id && a.id !== app.id && isOpen(a.status),
  );
  return c.json({ applications: others });
});

function meetingData(input: z.output<typeof meetingInput>): MeetingData {
  return {
    kind: input.kind,
    state: input.state ?? (Date.parse(input.occurred_at) > Date.now() ? 'scheduled' : 'held'),
    ends_at: input.ends_at,
    timezone: input.timezone,
    join_url: input.join_url,
    location: input.location,
    attendees: input.attendees.map((a) => ({ name: a.name, title: a.title, email: a.email })),
    agenda: input.agenda,
  };
}

applications.post('/applications/:id/meetings', async (c) => {
  const id = await needApp(c);
  const input = await body(c, meetingInput);
  const event = await insertEvent(c, id, 'meeting', {
    occurred_at: input.occurred_at,
    title: input.title,
    body: input.body,
    external_ref: input.external_ref,
    data: meetingData(input),
  });
  return written(c, event, id, 201);
});

applications.post('/applications/:id/emails', async (c) => {
  const id = await needApp(c);
  const { occurred_at, body: summary, external_ref, subject, ...rest } = await body(c, emailInput);
  const data: EmailData = { ...rest, subject };
  const event = await insertEvent(c, id, 'email', {
    occurred_at,
    title: subject,
    body: summary,
    external_ref,
    data,
  });
  return written(c, event, id, 201);
});

applications.post('/applications/:id/notes', async (c) => {
  const id = await needApp(c);
  const input = await body(c, noteInput);
  if (input.parent_id) {
    const parent = await loadEvent(c.env.DB, input.parent_id);
    if (!parent || parent.application_id !== id)
      throw new ApiError(400, 'invalid', 'parent_id must be an event on this application.');
  }
  const event = await insertEvent(c, id, 'note', {
    occurred_at: input.occurred_at ?? nowIso(),
    title: input.title,
    body: input.body,
    external_ref: input.external_ref,
    parent_id: input.parent_id ?? null,
    data: {},
  });
  return written(c, event, id, 201);
});

applications.patch('/events/:id', async (c) => {
  const ev = await loadEvent(c.env.DB, c.req.param('id'));
  if (!ev) throw notFound('Event');
  const fields: Record<string, unknown> = {};
  if (ev.type === 'meeting') {
    const {
      title,
      occurred_at,
      body: b,
      external_ref,
      ...rest
    } = defined(await body(c, meetingPatch));
    Object.assign(fields, defined({ title, occurred_at, body: b, external_ref }));
    fields.data = JSON.stringify({ ...(ev.data as MeetingData), ...rest });
  } else if (ev.type === 'email') {
    const {
      occurred_at,
      body: b,
      external_ref,
      subject,
      ...rest
    } = defined(await body(c, emailPatch));
    Object.assign(fields, defined({ occurred_at, body: b, external_ref }));
    if (subject !== undefined) fields.title = subject;
    fields.data = JSON.stringify({
      ...(ev.data as EmailData),
      ...rest,
      ...(subject !== undefined ? { subject } : {}),
    });
  } else if (ev.type === 'note') {
    const input = defined(await body(c, notePatch));
    if (input.parent_id) {
      const parent = await loadEvent(c.env.DB, input.parent_id);
      if (!parent || parent.application_id !== ev.application_id || parent.id === ev.id)
        throw new ApiError(400, 'invalid', 'parent_id must be another event on this application.');
    }
    Object.assign(fields, input);
  } else {
    // Status and created events: only when it happened and the reason can change.
    const input = defined(
      await body(c, statusInput.pick({ occurred_at: true, reason: true }).partial()),
    );
    if (input.occurred_at) fields.occurred_at = input.occurred_at;
    if ('reason' in input)
      fields.data = JSON.stringify({ ...(ev.data as StatusData), reason: input.reason ?? null });
  }
  if (Object.keys(fields).length) {
    try {
      await updateStmt(c.env.DB, 'events', ev.id, fields).run();
    } catch (e) {
      if (/UNIQUE constraint failed/i.test((e as Error).message))
        throw new ApiError(
          409,
          'duplicate',
          'Another event on this application has that external_ref.',
        );
      throw e;
    }
  }
  return written(c, await loadEvent(c.env.DB, ev.id), ev.application_id);
});

applications.delete('/events/:id', async (c) => {
  const ev = await loadEvent(c.env.DB, c.req.param('id'));
  if (!ev) throw notFound('Event');
  if (ev.type === 'created')
    throw new ApiError(409, 'conflict', 'The created event stays; delete the application instead.');
  // Notes under it go too (ON DELETE CASCADE).
  await c.env.DB.prepare('DELETE FROM events WHERE id = ?').bind(ev.id).run();
  return written(c, null, ev.application_id);
});

// ---------- people ----------

applications.post('/applications/:id/people', async (c) => {
  const id = await needApp(c);
  const input = await body(c, personInput);
  if (input.role !== 'other') input.other_role = null;
  const pid = newId();
  const now = nowIso();
  await insertStmt(c.env.DB, 'people', {
    id: pid,
    application_id: id,
    ...input,
    created_at: now,
    updated_at: now,
  }).run();
  return c.json(toPerson((await first(c.env.DB, 'SELECT * FROM people WHERE id = ?', pid))!), 201);
});

applications.patch('/people/:id', async (c) => {
  const id = c.req.param('id');
  const input = defined(await body(c, personPatch));
  if (!(await exists(c.env.DB, 'people', id))) throw notFound('Person');
  // Only "other" carries its own words.
  if (input.role && input.role !== 'other') input.other_role = null;
  if (Object.keys(input).length) await updateStmt(c.env.DB, 'people', id, input).run();
  return c.json(toPerson((await first(c.env.DB, 'SELECT * FROM people WHERE id = ?', id))!));
});

applications.delete('/people/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await exists(c.env.DB, 'people', id))) throw notFound('Person');
  await c.env.DB.prepare('DELETE FROM people WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});
