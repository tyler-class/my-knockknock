import { Hono } from 'hono';
import {
  boardOrder,
  companyInput,
  companyLink,
  companyPatch,
  logoFromUrl,
  personInput,
} from '@shared/schemas';
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

const LOGO_TYPE = /^image\/(png|jpeg|webp|gif|svg\+xml)$/;

/** What an image really is, from its first bytes (a server's Content-Type is often wrong). */
function sniffImage(bytes: Uint8Array): string | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return 'image/gif';
  const ascii = (from: number, n: number) => String.fromCharCode(...bytes.slice(from, from + n));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  const head = new TextDecoder().decode(bytes.slice(0, 1024)).toLowerCase();
  if (/<svg[\s>]/.test(head) && !/<html[\s>]/.test(head)) return 'image/svg+xml';
  return null;
}

/** Saves a company's logo (replacing any it had) and returns the company. */
async function storeLogo(env: Cloudflare.Env, id: string, bytes: ArrayBuffer, type: string) {
  if (!bytes.byteLength) throw new ApiError(400, 'invalid', 'Send the image.');
  if (bytes.byteLength > MAX_LOGO_BYTES)
    throw new ApiError(413, 'too_large', 'That image is too big (2 MB max).');
  const key = `logos/${id}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
  await env.DB.prepare(
    'UPDATE companies SET logo_key = ?, logo_type = ?, updated_at = ? WHERE id = ?',
  )
    .bind(key, type, new Date().toISOString(), id)
    .run();
  return loadCompany(env.DB, id);
}

companies.post('/companies/:id/logo', async (c) => {
  const id = c.req.param('id');
  if (!(await exists(c.env.DB, 'companies', id))) throw notFound('Company');
  const type = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!LOGO_TYPE.test(type))
    throw new ApiError(400, 'invalid', 'Use a PNG, JPEG, WebP, GIF or SVG image.');
  return c.json(await storeLogo(c.env, id, await c.req.arrayBuffer(), type));
});

/**
 * A logo from an image's address on the web (assistants use this: they find the image, Knock
 * Knock fetches it). A data: URL with the image in base64 works too.
 */
companies.post('/companies/:id/logo-from-url', async (c) => {
  const id = c.req.param('id');
  if (!(await exists(c.env.DB, 'companies', id))) throw notFound('Company');
  const { url } = await body(c, logoFromUrl);
  let bytes: ArrayBuffer;
  // What the server said it was sending (only used to explain a refusal).
  let declared = '';
  const data = /^data:image\/[\w.+-]+;base64,(.*)$/is.exec(url);
  if (data) {
    try {
      bytes = Uint8Array.from(atob(data[1]!.replace(/\s/g, '')), (ch) => ch.charCodeAt(0))
        .buffer as ArrayBuffer;
    } catch {
      throw new ApiError(400, 'invalid', 'That data URL isn’t valid base64.');
    }
  } else {
    if (!/^https?:\/\//i.test(url))
      throw new ApiError(400, 'invalid', 'Use an http(s) link to the image, or a data: URL.');
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: 'image/*,*/*;q=0.8', 'User-Agent': 'KnockKnock/1 (logo fetch)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ApiError(400, 'fetch_failed', 'Couldn’t reach that link to fetch the image.');
    }
    if (!res.ok)
      throw new ApiError(
        400,
        'fetch_failed',
        `Fetching the image failed (the site answered ${res.status}).`,
      );
    if (Number(res.headers.get('Content-Length') ?? 0) > MAX_LOGO_BYTES)
      throw new ApiError(413, 'too_large', 'That image is too big (2 MB max).');
    declared = (res.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
    bytes = await res.arrayBuffer();
  }
  // Only what the bytes say counts: a page or error served as image/png isn't a logo.
  const type = sniffImage(new Uint8Array(bytes));
  if (!type)
    throw new ApiError(
      400,
      'invalid',
      declared.startsWith('text/html')
        ? 'That link is a web page, not an image. Use the address of the image itself.'
        : 'That isn’t a PNG, JPEG, WebP, GIF or SVG image.',
    );
  return c.json(await storeLogo(c.env, id, bytes, type));
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
