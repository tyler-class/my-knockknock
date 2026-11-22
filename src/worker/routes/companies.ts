import { Hono } from 'hono';
import { boardOrder, companyInput, companyLink, companyPatch, personInput } from '@shared/schemas';
import {
  createCompany,
  findCompanyByName,
  linkJob,
  loadCompany,
  updateCompany,
} from '../companies';
import { first, insertStmt, loadApplication, loadPeople, newId, nowIso } from '../db';
import { ApiError, body, defined, notFound, type AppEnv } from './util';

export const companies = new Hono<AppEnv>();

const exists = async (db: D1Database, table: 'applications' | 'companies', id: string) =>
  !!(await first(db, `SELECT id FROM ${table} WHERE id = ?`, id));

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

companies.post('/companies', async (c) => {
  const input = await body(c, companyInput);
  // The same name (ignoring case) is the same company.
  const found = await findCompanyByName(c.env.DB, input.name);
  return c.json(found ?? (await createCompany(c.env.DB, input)), found ? 200 : 201);
});

companies.patch('/companies/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await exists(c.env.DB, 'companies', id))) throw notFound('Company');
  const input = defined(await body(c, companyPatch));
  return c.json(await updateCompany(c.env.DB, id, input));
});

/** Point a job at a company: one that exists (company_id), or a new one (its name and details). */
companies.post('/applications/:id/company', async (c) => {
  const appId = c.req.param('id');
  if (!(await exists(c.env.DB, 'applications', appId))) throw notFound('Application');
  const input = await body(c, companyLink);
  let companyId: string;
  if ('company_id' in input) {
    if (!(await exists(c.env.DB, 'companies', input.company_id))) throw notFound('Company');
    companyId = input.company_id;
  } else {
    const found = await findCompanyByName(c.env.DB, input.name);
    companyId = (found ?? (await createCompany(c.env.DB, input))).id;
  }
  await linkJob(c.env.DB, appId, companyId);
  return c.json({
    application: await loadApplication(c.env.DB, appId),
    company: await loadCompany(c.env.DB, companyId),
  });
});

/** Someone at a company, on none of its jobs yet (added from the company's page). */
companies.post('/companies/:id/people', async (c) => {
  const id = c.req.param('id');
  if (!(await exists(c.env.DB, 'companies', id))) throw notFound('Company');
  const input = await body(c, personInput);
  if (input.role !== 'other') input.other_role = null;
  const pid = newId();
  const now = nowIso();
  await insertStmt(c.env.DB, 'people', {
    id: pid,
    application_id: null,
    company_id: id,
    ...input,
    created_at: now,
    updated_at: now,
  }).run();
  return c.json((await loadPeople(c.env.DB, pid))[0], 201);
});

// ---------- logo ----------

companies.post('/companies/:id/logo', async (c) => {
  const id = c.req.param('id');
  if (!(await exists(c.env.DB, 'companies', id))) throw notFound('Company');
  const type = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(type))
    throw new ApiError(400, 'invalid', 'Use a PNG, JPEG, WebP, GIF or SVG image.');
  const bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength) throw new ApiError(400, 'invalid', 'Send the image.');
  if (bytes.byteLength > MAX_LOGO_BYTES)
    throw new ApiError(413, 'too_large', 'That image is too big (2 MB max).');
  const key = `logos/${id}`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
  await c.env.DB.prepare(
    'UPDATE companies SET logo_key = ?, logo_type = ?, updated_at = ? WHERE id = ?',
  )
    .bind(key, type, new Date().toISOString(), id)
    .run();
  return c.json(await loadCompany(c.env.DB, id));
});

companies.delete('/companies/:id/logo', async (c) => {
  const id = c.req.param('id');
  const co = await c.env.DB.prepare('SELECT logo_key FROM companies WHERE id = ?')
    .bind(id)
    .first<{ logo_key: string | null }>();
  if (!co) throw notFound('Company');
  if (co.logo_key) await c.env.FILES.delete(co.logo_key);
  await c.env.DB.prepare(
    'UPDATE companies SET logo_key = NULL, logo_type = NULL, updated_at = ? WHERE id = ?',
  )
    .bind(new Date().toISOString(), id)
    .run();
  return c.json(await loadCompany(c.env.DB, id));
});

companies.get('/companies/:id/logo', async (c) => {
  const co = await c.env.DB.prepare('SELECT logo_key, logo_type FROM companies WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ logo_key: string | null; logo_type: string | null }>();
  if (!co?.logo_key) throw notFound('Logo');
  const obj = await c.env.FILES.get(co.logo_key);
  if (!obj) throw notFound('Logo');
  return new Response(obj.body, {
    headers: {
      'Content-Type': co.logo_type ?? 'application/octet-stream',
      // The app asks for it with ?v=<updated_at>, so a new logo is a new address.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      // An SVG logo can't run anything when opened directly.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
});

// ---------- board order ----------

/** A lane's jobs in their new order, as dragged: each gets its place (0, 1, 2…). */
companies.post('/applications/board-order', async (c) => {
  const { ids } = await body(c, boardOrder);
  await c.env.DB.batch(
    ids.map((id, i) =>
      c.env.DB.prepare('UPDATE applications SET board_position = ? WHERE id = ?').bind(i, id),
    ),
  );
  return c.json({ ok: true });
});
