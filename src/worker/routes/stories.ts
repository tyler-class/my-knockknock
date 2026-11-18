// The story bank (templates), custom frameworks, and stories copied to jobs.
//
// Linking a bank story to a job copies it (job_stories). The copy is edited freely; the bank
// only changes on push. Pull replaces the copy with the bank's current version; "save as new"
// turns the copy into a new bank story. See src/shared/logic/stories.ts for the sync states.
import { Hono } from 'hono';
import {
  frameworkInput,
  frameworkPatch,
  jobStoryInput,
  jobStoryPatch,
  linkStoryInput,
  storyInput,
  storyPatch,
} from '@shared/schemas';
import { BUILTIN_KEYS, storyExtras } from '@shared/frameworks';
import { contentHash, frameworkOf, switchFramework } from '@shared/logic/stories';
import type { Framework, Story } from '@shared/types';
import {
  encode,
  first,
  insertStmt,
  loadFrameworks,
  loadJobStory,
  loadStory,
  newId,
  nowIso,
  toFramework,
  updateStmt,
} from '../db';
import { ApiError, body, defined, notFound, type AppEnv } from './util';

export const stories = new Hono<AppEnv>();

async function framework(db: D1Database, key: string): Promise<Framework> {
  const f = frameworkOf(key, await loadFrameworks(db));
  if (!f) throw new ApiError(400, 'invalid', `No story framework “${key}”.`);
  return f;
}

/**
 * Openers (Introduction, Why this job, Why I'm looking) don't ask for questions; a new one
 * answers its framework's usual questions, so Call Mode still finds it.
 */
const defaultQuestions = (questions: string[], f: Framework) =>
  questions.length || storyExtras(f.group).includes('questions') ? questions : f.questions;

/** Only sections the framework has, trimmed; empty ones dropped. */
function clean(sections: Record<string, string>, f: Framework | { sections: { key: string }[] }) {
  const keys = new Set(f.sections.map((s) => s.key));
  return Object.fromEntries(
    Object.entries(sections)
      .filter(([k, v]) => keys.has(k) && v.trim())
      .map(([k, v]) => [k, v.trim()]),
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'custom';

// ---------- frameworks ----------

stories.post('/frameworks', async (c) => {
  const input = await body(c, frameworkInput);
  let key = `custom_${slug(input.name)}`;
  if (await first(c.env.DB, 'SELECT key FROM frameworks WHERE key = ?', key))
    key = `${key}_${crypto.randomUUID().slice(0, 4)}`;
  const now = nowIso();
  await insertStmt(c.env.DB, 'frameworks', {
    key,
    ...encode(input),
    created_at: now,
    updated_at: now,
  }).run();
  return c.json(
    toFramework((await first(c.env.DB, 'SELECT * FROM frameworks WHERE key = ?', key))!),
    201,
  );
});

stories.patch('/frameworks/:key', async (c) => {
  const key = c.req.param('key');
  if (BUILTIN_KEYS.includes(key))
    throw new ApiError(409, 'conflict', 'Built-in frameworks can’t be changed. Make a custom one.');
  const input = defined(await body(c, frameworkPatch));
  if (!(await first(c.env.DB, 'SELECT key FROM frameworks WHERE key = ?', key)))
    throw notFound('Framework');
  if (Object.keys(input).length)
    await updateStmt(c.env.DB, 'frameworks', key, encode(input), 'key').run();
  return c.json(
    toFramework((await first(c.env.DB, 'SELECT * FROM frameworks WHERE key = ?', key))!),
  );
});

stories.delete('/frameworks/:key', async (c) => {
  const key = c.req.param('key');
  if (BUILTIN_KEYS.includes(key)) throw new ApiError(409, 'conflict', 'Built-in frameworks stay.');
  const used = await first<{ n: number }>(
    c.env.DB,
    'SELECT (SELECT COUNT(*) FROM stories WHERE framework_key = ?1) + (SELECT COUNT(*) FROM job_stories WHERE framework_key = ?1) AS n',
    key,
  );
  if (used && used.n > 0)
    throw new ApiError(
      409,
      'conflict',
      `${used.n} stories use this framework. Move them to another one first.`,
    );
  await c.env.DB.prepare('DELETE FROM frameworks WHERE key = ?').bind(key).run();
  return c.json({ ok: true });
});

// ---------- bank stories ----------

stories.post('/stories', async (c) => {
  const input = await body(c, storyInput);
  const f = await framework(c.env.DB, input.framework_key);
  const id = newId();
  const now = nowIso();
  await insertStmt(c.env.DB, 'stories', {
    id,
    ...encode({
      ...input,
      sections: clean(input.sections, f),
      questions: defaultQuestions(input.questions, f),
    }),
    version: 1,
    created_at: now,
    updated_at: now,
  }).run();
  return c.json(await loadStory(c.env.DB, id), 201);
});

stories.patch('/stories/:id', async (c) => {
  const id = c.req.param('id');
  const prev = await loadStory(c.env.DB, id);
  if (!prev) throw notFound('Story');
  const input = defined(await body(c, storyPatch));
  const fields: Record<string, unknown> = { ...input };
  if (input.framework_key && input.framework_key !== prev.framework_key) {
    const [from, to] = await Promise.all([
      framework(c.env.DB, prev.framework_key).catch(
        () => ({ sections: [] }) as unknown as Framework,
      ),
      framework(c.env.DB, input.framework_key),
    ]);
    const moved = switchFramework(
      input.sections ?? prev.sections,
      from.sections,
      to.sections,
      input.notes ?? prev.notes,
    );
    fields.sections = moved.sections;
    fields.notes = moved.notes;
  } else if (input.sections) {
    fields.sections = clean(input.sections, await framework(c.env.DB, prev.framework_key));
  }
  const next: Story = { ...prev, ...(fields as Partial<Story>) };
  // The version goes up only when the content a copy would care about changes.
  if (contentHash(next) !== contentHash(prev) || next.framework_key !== prev.framework_key)
    fields.version = prev.version + 1;
  if (Object.keys(fields).length) await updateStmt(c.env.DB, 'stories', id, encode(fields)).run();
  return c.json(await loadStory(c.env.DB, id));
});

stories.delete('/stories/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await loadStory(c.env.DB, id))) throw notFound('Story');
  // Job copies stay (they're yours); they just lose their link to the bank.
  await c.env.DB.prepare('DELETE FROM stories WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// ---------- job copies ----------

async function nextPosition(db: D1Database, applicationId: string) {
  const r = await first<{ p: number | null }>(
    db,
    'SELECT MAX(position) AS p FROM job_stories WHERE application_id = ?',
    applicationId,
  );
  return (r?.p ?? -1) + 1;
}

function copyFields(s: Story, f: Framework) {
  return {
    story_id: s.id,
    source_version: s.version,
    framework_key: s.framework_key,
    section_defs: f.sections,
    title: s.title,
    hook: s.hook,
    tags: s.tags,
    sections: s.sections,
    questions: s.questions,
    notes: s.notes,
    base_hash: contentHash(s),
  };
}

stories.post('/applications/:id/stories', async (c) => {
  const appId = c.req.param('id');
  if (!(await first(c.env.DB, 'SELECT id FROM applications WHERE id = ?', appId)))
    throw notFound('Application');
  const raw: unknown = await c.req.json().catch(() => null);
  const db = c.env.DB;
  const id = newId();
  const now = nowIso();
  const position = await nextPosition(db, appId);
  if (raw && typeof raw === 'object' && 'story_id' in raw) {
    // Link from the bank: a copy.
    const { story_id, angle } = linkStoryInput.parse(raw);
    const s = await loadStory(db, story_id);
    if (!s) throw notFound('Story');
    const dup = await first(
      db,
      'SELECT id FROM job_stories WHERE application_id = ? AND story_id = ?',
      appId,
      s.id,
    );
    if (dup)
      throw new ApiError(409, 'duplicate', 'That story is already linked to this application.', {
        job_story_id: dup.id,
      });
    const f = await framework(db, s.framework_key);
    await insertStmt(db, 'job_stories', {
      id,
      application_id: appId,
      ...encode(copyFields(s, f)),
      angle: angle ?? null,
      position,
      created_at: now,
      updated_at: now,
    }).run();
  } else {
    // A job-only story.
    const r = jobStoryInput.safeParse(raw);
    if (!r.success)
      throw new ApiError(400, 'invalid', r.error.issues[0]?.message ?? 'Invalid input.');
    const input = r.data;
    const f = await framework(db, input.framework_key);
    const sections = clean(input.sections, f);
    input.questions = defaultQuestions(input.questions, f);
    await insertStmt(db, 'job_stories', {
      id,
      application_id: appId,
      story_id: null,
      source_version: null,
      ...encode({ ...input, sections, section_defs: f.sections }),
      base_hash: contentHash({ ...input, sections }),
      position,
      created_at: now,
      updated_at: now,
    }).run();
  }
  return c.json(await loadJobStory(db, id), 201);
});

stories.patch('/job-stories/:id', async (c) => {
  const id = c.req.param('id');
  const prev = await loadJobStory(c.env.DB, id);
  if (!prev) throw notFound('Story');
  const input = defined(await body(c, jobStoryPatch));
  const fields: Record<string, unknown> = { ...input };
  if (input.framework_key && input.framework_key !== prev.framework_key) {
    const to = await framework(c.env.DB, input.framework_key);
    const moved = switchFramework(
      input.sections ?? prev.sections,
      prev.section_defs,
      to.sections,
      input.notes ?? prev.notes,
    );
    Object.assign(fields, {
      sections: moved.sections,
      notes: moved.notes,
      section_defs: to.sections,
    });
  } else if (input.sections) {
    fields.sections = clean(input.sections, { sections: prev.section_defs });
  }
  if (Object.keys(fields).length)
    await updateStmt(c.env.DB, 'job_stories', id, encode(fields)).run();
  return c.json(await loadJobStory(c.env.DB, id));
});

stories.delete('/job-stories/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await loadJobStory(c.env.DB, id))) throw notFound('Story');
  await c.env.DB.prepare('DELETE FROM job_stories WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

/** Replace the copy with the bank's current version (the angle stays). */
stories.post('/job-stories/:id/pull', async (c) => {
  const js = await loadJobStory(c.env.DB, c.req.param('id'));
  if (!js) throw notFound('Story');
  const s = js.story_id ? await loadStory(c.env.DB, js.story_id) : null;
  if (!s) throw new ApiError(409, 'conflict', 'This copy has no bank story to pull from.');
  const f = await framework(c.env.DB, s.framework_key);
  await updateStmt(c.env.DB, 'job_stories', js.id, encode(copyFields(s, f))).run();
  return c.json({ job_story: await loadJobStory(c.env.DB, js.id), story: s });
});

/** Make the bank story match this copy (a new version). Other jobs' copies don't change. */
stories.post('/job-stories/:id/push', async (c) => {
  const db = c.env.DB;
  const js = await loadJobStory(db, c.req.param('id'));
  if (!js) throw notFound('Story');
  const s = js.story_id ? await loadStory(db, js.story_id) : null;
  if (!s)
    throw new ApiError(
      409,
      'conflict',
      'This copy has no bank story. Save it as a new story instead.',
    );
  const version = s.version + 1;
  await updateStmt(
    db,
    'stories',
    s.id,
    encode({
      framework_key: js.framework_key,
      title: js.title,
      hook: js.hook,
      tags: js.tags,
      sections: js.sections,
      questions: js.questions,
      notes: js.notes,
      version,
    }),
  ).run();
  await updateStmt(db, 'job_stories', js.id, {
    source_version: version,
    base_hash: contentHash(js),
  }).run();
  return c.json({ job_story: await loadJobStory(db, js.id), story: await loadStory(db, s.id) });
});

/** Turn this copy into a new bank story, and link the copy to it. */
stories.post('/job-stories/:id/save-as-new', async (c) => {
  const db = c.env.DB;
  const js = await loadJobStory(db, c.req.param('id'));
  if (!js) throw notFound('Story');
  const id = newId();
  const now = nowIso();
  const fwExists = await framework(db, js.framework_key)
    .then(() => true)
    .catch(() => false);
  if (!fwExists)
    throw new ApiError(409, 'conflict', 'Its framework no longer exists. Switch it first.');
  await insertStmt(db, 'stories', {
    id,
    ...encode({
      framework_key: js.framework_key,
      title: js.title,
      hook: js.hook,
      tags: js.tags,
      sections: js.sections,
      questions: js.questions,
      notes: js.notes,
    }),
    version: 1,
    created_at: now,
    updated_at: now,
  }).run();
  await updateStmt(db, 'job_stories', js.id, {
    story_id: id,
    source_version: 1,
    base_hash: contentHash(js),
  }).run();
  return c.json({ job_story: await loadJobStory(db, js.id), story: await loadStory(db, id) }, 201);
});
