// Resumes, cover letters, transcripts, offer letters. Files live privately in R2 under
// files/<id>; D1 keeps the metadata, a SHA-256 (so you can prove what you sent), and the text of
// text files (transcripts) so assistants can read them over MCP.
import { Hono } from 'hono';
import { filePatch } from '@shared/schemas';
import type { FileKind } from '@shared/lookups';
import type { FileRef } from '@shared/types';
import { first, insertStmt, loadFile, newId, nowIso } from '../db';
import { ApiError, body, defined, notFound, type AppEnv } from './util';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Text kept for reading over MCP; longer transcripts are cut here. */
export const MAX_TEXT_CHARS = 400_000;

export const files = new Hono<AppEnv>();

/** The real type from the first bytes for binary files; text files by name. */
export function sniffFile(b: Uint8Array, filename: string): string | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, j) => b[i + j] === x);
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
  if (at(0, 0x50, 0x4b, 0x03, 0x04)) {
    if (/\.docx$/i.test(filename))
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return null;
  }
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  if (ext && ['txt', 'md', 'vtt', 'srt', 'csv', 'json'].includes(ext)) {
    // No NUL bytes in the first 8 KB: really text.
    if (!b.slice(0, 8192).includes(0)) return ext === 'vtt' ? 'text/vtt' : 'text/plain';
  }
  return null;
}

/** Plain text from a transcript: WebVTT and SRT cue numbers and timestamps removed. */
export function transcriptText(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (const l of lines) {
    const t = l.trim();
    if (!t || t === 'WEBVTT' || /^NOTE\b/.test(t) || /^\d+$/.test(t)) continue;
    if (/-->/.test(t)) continue;
    const clean = t.replace(/<[^>]+>/g, '');
    if (out[out.length - 1] !== clean) out.push(clean);
  }
  return out.join('\n');
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export interface StoreFile {
  applicationId: string | null;
  kind: FileKind;
  bytes: ArrayBuffer;
  filename: string;
  eventId?: string | null;
  label?: string | null;
}

export async function storeFile(env: Cloudflare.Env, a: StoreFile): Promise<FileRef> {
  const db = env.DB;
  if (
    a.applicationId &&
    !(await first(db, 'SELECT id FROM applications WHERE id = ?', a.applicationId))
  )
    throw notFound('Application');
  if (!a.bytes.byteLength) throw new ApiError(400, 'invalid', 'The file is empty.');
  if (a.bytes.byteLength > MAX_FILE_BYTES)
    throw new ApiError(413, 'too_large', 'That file is too big (20 MB max).');
  const filename = (a.filename || 'file').replace(/[\\/]/g, '_').slice(0, 200);
  const type = sniffFile(
    new Uint8Array(a.bytes, 0, Math.min(a.bytes.byteLength, 64 * 1024)),
    filename,
  );
  if (!type)
    throw new ApiError(
      415,
      'unsupported',
      'Use a PDF, Word (.docx), image, or text file (.txt, .md, .vtt, .srt).',
    );
  let text: string | null = null;
  if (type.startsWith('text/')) {
    const raw = new TextDecoder().decode(a.bytes);
    text = (/\.(vtt|srt)$/i.test(filename) ? transcriptText(raw) : raw).slice(0, MAX_TEXT_CHARS);
  }
  const id = newId();
  const key = `files/${id}`;
  await env.FILES.put(key, a.bytes, {
    httpMetadata: {
      contentType: type,
      contentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
  try {
    await insertStmt(db, 'files', {
      id,
      application_id: a.applicationId,
      event_id: a.eventId ?? null,
      kind: a.kind,
      r2_key: key,
      filename,
      content_type: type,
      size: a.bytes.byteLength,
      label: a.label ?? null,
      locked: 0,
      sha256: await sha256(a.bytes),
      text,
      created_at: nowIso(),
    }).run();
  } catch (e) {
    await env.FILES.delete(key);
    throw e;
  }
  // A resume uploaded to an application with none attached becomes the one it was sent with.
  if (a.kind === 'resume' && a.applicationId)
    await db
      .prepare('UPDATE applications SET resume_file_id = COALESCE(resume_file_id, ?) WHERE id = ?')
      .bind(id, a.applicationId)
      .run();
  return (await loadFile(db, id))!;
}

const KINDS = new Set(['resume', 'cover_letter', 'transcript', 'offer', 'posting', 'other']);

// POST /applications/:id/files?kind=resume  (raw body; X-Filename header)
files.post('/applications/:id/files', async (c) => {
  const kind = (c.req.query('kind') ?? 'other') as FileKind;
  if (!KINDS.has(kind)) throw new ApiError(400, 'invalid', 'Unknown file kind.');
  if (Number(c.req.header('Content-Length') ?? 0) > MAX_FILE_BYTES)
    throw new ApiError(413, 'too_large', 'That file is too big (20 MB max).');
  const name = c.req.header('X-Filename');
  const f = await storeFile(c.env, {
    applicationId: c.req.param('id'),
    kind,
    bytes: await c.req.arrayBuffer(),
    filename: name ? decodeURIComponent(name) : 'file',
    eventId: c.req.query('event_id') || null,
  });
  return c.json(f, 201);
});

/** Text pasted straight in (a transcript copied from Zoom, say). */
files.post('/applications/:id/text-files', async (c) => {
  const raw = (await c.req.json().catch(() => null)) as {
    text?: unknown;
    filename?: unknown;
    kind?: unknown;
    event_id?: unknown;
    label?: unknown;
  } | null;
  if (!raw || typeof raw.text !== 'string' || !raw.text.trim())
    throw new ApiError(400, 'invalid', 'Send the text.');
  const kind = (
    typeof raw.kind === 'string' && KINDS.has(raw.kind) ? raw.kind : 'transcript'
  ) as FileKind;
  const filename = typeof raw.filename === 'string' && raw.filename ? raw.filename : `${kind}.txt`;
  const f = await storeFile(c.env, {
    applicationId: c.req.param('id'),
    kind,
    bytes: new TextEncoder().encode(raw.text).buffer as ArrayBuffer,
    filename: /\.(txt|md|vtt|srt)$/i.test(filename) ? filename : `${filename}.txt`,
    eventId: typeof raw.event_id === 'string' ? raw.event_id : null,
    label: typeof raw.label === 'string' ? raw.label.slice(0, 200) : null,
  });
  return c.json(f, 201);
});

files.get('/files/:id', async (c) => {
  const f = await first<{ r2_key: string; filename: string; content_type: string }>(
    c.env.DB,
    'SELECT r2_key, filename, content_type FROM files WHERE id = ?',
    c.req.param('id'),
  );
  if (!f) throw notFound('File');
  const obj = await c.env.FILES.get(f.r2_key);
  if (!obj) throw notFound('File');
  const inline =
    c.req.query('inline') === '1' && /^(application\/pdf|image\/|text\/)/.test(f.content_type);
  return new Response(obj.body, {
    headers: {
      'Content-Type': f.content_type,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});

files.get('/files/:id/text', async (c) => {
  const r = await first<{ text: string | null; filename: string }>(
    c.env.DB,
    'SELECT text, filename FROM files WHERE id = ?',
    c.req.param('id'),
  );
  if (!r) throw notFound('File');
  if (r.text == null)
    throw new ApiError(
      409,
      'no_text',
      `No text was kept for ${r.filename}. Text is kept for .txt, .md, .vtt and .srt files.`,
    );
  return c.json({ filename: r.filename, text: r.text });
});

files.patch('/files/:id', async (c) => {
  const id = c.req.param('id');
  const prev = await loadFile(c.env.DB, id);
  if (!prev) throw notFound('File');
  const input = defined(await body(c, filePatch));
  const fields: Record<string, unknown> = { ...input };
  if (typeof input.locked === 'boolean') fields.locked = input.locked ? 1 : 0;
  const cols = Object.keys(fields);
  if (cols.length)
    await c.env.DB.prepare(
      `UPDATE files SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    )
      .bind(...cols.map((k) => fields[k]), id)
      .run();
  return c.json(await loadFile(c.env.DB, id));
});

files.delete('/files/:id', async (c) => {
  const f = await first<{ r2_key: string; locked: number }>(
    c.env.DB,
    'SELECT r2_key, locked FROM files WHERE id = ?',
    c.req.param('id'),
  );
  if (!f) throw notFound('File');
  if (f.locked)
    throw new ApiError(409, 'locked', 'That file is locked (it was sent). Unlock it first.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE applications SET resume_file_id = NULL WHERE resume_file_id = ?').bind(
      c.req.param('id'),
    ),
    c.env.DB.prepare('DELETE FROM files WHERE id = ?').bind(c.req.param('id')),
  ]);
  await c.env.FILES.delete(f.r2_key);
  return c.json({ ok: true });
});
