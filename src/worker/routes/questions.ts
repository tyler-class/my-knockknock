// Questions to ask in interviews: a bank reused across jobs and meetings, and each job's own
// list (copied from the bank, or written just for it). A meeting's own questions, and what was
// said on each call, live on the meeting (its data.questions).
import { Hono } from 'hono';
import { jobQuestionInput, jobQuestionPatch, questionInput, questionPatch } from '@shared/schemas';
import {
  encode,
  first,
  insertStmt,
  newId,
  nowIso,
  toJobQuestion,
  toQuestion,
  updateStmt,
} from '../db';
import { body, defined, notFound, type AppEnv } from './util';

export const questions = new Hono<AppEnv>();

const loadQuestion = async (db: D1Database, id: string) => {
  const r = await first(db, 'SELECT * FROM questions WHERE id = ?', id);
  return r ? toQuestion(r) : null;
};
const loadJobQuestion = async (db: D1Database, id: string) => {
  const r = await first(db, 'SELECT * FROM job_questions WHERE id = ?', id);
  return r ? toJobQuestion(r) : null;
};

async function addToBank(db: D1Database, text: string) {
  const id = newId();
  const now = nowIso();
  await insertStmt(db, 'questions', {
    id,
    text,
    tags: '[]',
    notes: null,
    archived: 0,
    created_at: now,
    updated_at: now,
  }).run();
  return id;
}

// ---------- the bank ----------

questions.post('/questions', async (c) => {
  const input = await body(c, questionInput);
  const id = newId();
  const now = nowIso();
  await insertStmt(c.env.DB, 'questions', {
    id,
    ...encode(input),
    archived: 0,
    created_at: now,
    updated_at: now,
  }).run();
  return c.json(await loadQuestion(c.env.DB, id), 201);
});

questions.patch('/questions/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await loadQuestion(c.env.DB, id))) throw notFound('Question');
  const input = defined(await body(c, questionPatch));
  if (Object.keys(input).length) await updateStmt(c.env.DB, 'questions', id, encode(input)).run();
  return c.json(await loadQuestion(c.env.DB, id));
});

/** Out of the bank. Jobs that use it keep their copies. */
questions.delete('/questions/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await loadQuestion(c.env.DB, id))) throw notFound('Question');
  await c.env.DB.prepare('DELETE FROM questions WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// ---------- a job's questions ----------

/** On a job: one from the bank, or one written for it (kept in the bank too, if asked). */
questions.post('/applications/:id/questions', async (c) => {
  const appId = c.req.param('id');
  const db = c.env.DB;
  if (!(await first(db, 'SELECT id FROM applications WHERE id = ?', appId)))
    throw notFound('Application');
  const input = await body(c, jobQuestionInput);
  let questionId: string | null = null;
  let text: string;
  if ('question_id' in input) {
    const q = await loadQuestion(db, input.question_id);
    if (!q) throw notFound('Question');
    questionId = q.id;
    text = q.text;
  } else {
    text = input.text;
    if (input.to_bank) questionId = await addToBank(db, text);
  }
  const pos = await first<{ p: number | null }>(
    db,
    'SELECT MAX(position) AS p FROM job_questions WHERE application_id = ?',
    appId,
  );
  const id = newId();
  const now = nowIso();
  await insertStmt(db, 'job_questions', {
    id,
    application_id: appId,
    question_id: questionId,
    text,
    position: (pos?.p ?? -1) + 1,
    created_at: now,
    updated_at: now,
  }).run();
  return c.json(await loadJobQuestion(db, id), 201);
});

questions.patch('/job-questions/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await loadJobQuestion(c.env.DB, id))) throw notFound('Question');
  const input = defined(await body(c, jobQuestionPatch));
  if (Object.keys(input).length) await updateStmt(c.env.DB, 'job_questions', id, input).run();
  return c.json(await loadJobQuestion(c.env.DB, id));
});

questions.delete('/job-questions/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM job_questions WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

/** A job's own question kept in the bank too (to reuse on other jobs). */
questions.post('/job-questions/:id/to-bank', async (c) => {
  const jq = await loadJobQuestion(c.env.DB, c.req.param('id'));
  if (!jq) throw notFound('Question');
  if (!jq.question_id) {
    const qid = await addToBank(c.env.DB, jq.text);
    await updateStmt(c.env.DB, 'job_questions', jq.id, { question_id: qid }).run();
  }
  return c.json(await loadJobQuestion(c.env.DB, jq.id));
});

/** A meeting's own question kept in the bank too: returns the bank question. */
questions.post('/questions/from-text', async (c) => {
  const input = await body(c, questionInput);
  const id = await addToBank(c.env.DB, input.text);
  return c.json(await loadQuestion(c.env.DB, id), 201);
});
