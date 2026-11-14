// One-time upload links. An assistant can't pass a file from the chat to a tool, so it hands
// out a link instead: open it on any device, pick the resume or transcript, and it lands on the
// application. The token in the link is the only credential; it lasts 30 minutes and allows a
// handful of uploads.
import { Hono } from 'hono';
import { uploadLinkInput } from '@shared/schemas';
import { fileKindLabel, type FileKind } from '@shared/lookups';
import { first, nowIso } from './db';
import { MAX_FILE_BYTES, storeFile } from './routes/files';
import { ApiError, body, type AppEnv } from './routes/util';

export const LINK_MINUTES = 30;
export const LINK_MAX_UPLOADS = 10;

const enc = new TextEncoder();
async function hash(token: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(token));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ---------- API (signed in, or internal for MCP) ----------

export const uploadLinks = new Hono<AppEnv>();

uploadLinks.post('/upload-links', async (c) => {
  const { application_id, kind, event_id } = await body(c, uploadLinkInput);
  const app = await first<{ company: string; title: string }>(
    c.env.DB,
    'SELECT company, title FROM applications WHERE id = ?',
    application_id,
  );
  if (!app) throw new ApiError(404, 'not_found', 'Application not found.');
  const token = newToken();
  const expires = new Date(Date.now() + LINK_MINUTES * 60_000).toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM upload_links WHERE expires_at < ?').bind(nowIso()),
    c.env.DB.prepare(
      'INSERT INTO upload_links (token_hash, application_id, kind, event_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(await hash(token), application_id, kind, event_id ?? null, expires, nowIso()),
  ]);
  const origin = new URL(c.req.url).origin;
  return c.json(
    {
      url: `${origin}/upload/${token}`,
      expires_at: expires,
      for: `${app.title} at ${app.company}`,
    },
    201,
  );
});

// ---------- public page ----------

interface Link {
  application_id: string;
  kind: FileKind;
  event_id: string | null;
  uploads: number;
  expires_at: string;
  company: string | null;
  title: string | null;
}

async function findLink(db: D1Database, token: string): Promise<Link | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const l = await first<Link>(
    db,
    `SELECT l.*, a.company, a.title FROM upload_links l
     LEFT JOIN applications a ON a.id = l.application_id
     WHERE l.token_hash = ?`,
    await hash(token),
  );
  if (!l || l.expires_at < nowIso() || l.uploads >= LINK_MAX_UPLOADS || !l.company) return null;
  return l;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function page(nonce: string, title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(title)} · Knock Knock</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style nonce="${nonce}">
:root{--bg:#ffffff;--surface:#ffffff;--ink:#0b0b0b;--soft:#4a4a46;--line:#0b0b0b;--accent:#ffe14d;--accent-ink:#0b0b0b;--tint:#fff6c7;--bad:#a3141a;--good:#0e6a2c;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0b;--surface:#141414;--ink:#f2f2ee;--soft:#b8b8b2;--line:#f2f2ee;--accent:#ffe14d;--accent-ink:#0b0b0b;--tint:#3a3412;--bad:#ff8a80;--good:#7ee29b;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;padding:24px max(16px,env(safe-area-inset-left))}
main{width:100%;max-width:400px;display:flex;flex-direction:column;gap:16px}
h1{font:900 26px/1.15 system-ui,sans-serif;margin:0;letter-spacing:-.01em}
p{margin:0;color:var(--soft)}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;min-height:52px;border-radius:8px;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);font:600 17px system-ui;cursor:pointer}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn[aria-disabled=true]{opacity:.5;pointer-events:none}
input{display:none}
#shots{display:flex;flex-direction:column;gap:6px}#shots div{padding:10px 12px;border:1.5px solid var(--line);border-radius:6px}
#msg.bad{color:var(--bad)}#msg.good{color:var(--good)}
.mark{width:44px;height:44px;border-radius:12px}
</style></head><body><main>
<img class="mark" src="/favicon.svg" alt="">
${body}
</main></body></html>`;
}

function html(body: string, nonce: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': `default-src 'none'; img-src 'self' blob:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'`,
    },
  });
}

export const uploadPage = new Hono<{ Bindings: Cloudflare.Env }>();

uploadPage.get('/upload/:token', async (c) => {
  const nonce = newToken();
  const link = await findLink(c.env.DB, c.req.param('token'));
  if (!link)
    return html(
      page(
        nonce,
        'Link expired',
        '<h1>This link has expired</h1><p>Ask your assistant for a new upload link.</p>',
      ),
      nonce,
      404,
    );
  const what = fileKindLabel(link.kind).toLowerCase();
  return html(
    page(
      nonce,
      `Add a ${what}`,
      `<h1>Add a ${what}</h1>
<p>For <strong>${esc(link.title!)}</strong> at <strong>${esc(link.company!)}</strong>. PDF, Word, or a text file (.txt, .md, .vtt, .srt).</p>
<label class="btn primary" id="pick">Choose file<input id="file" type="file" accept=".pdf,.docx,.txt,.md,.vtt,.srt,image/*" multiple></label>
<div id="shots"></div><p id="msg" role="status"></p>
<script nonce="${nonce}">
const file=document.getElementById('file'),msg=document.getElementById('msg'),shots=document.getElementById('shots'),pick=document.getElementById('pick');
file.addEventListener('change',async()=>{
  const fs=[...file.files];file.value='';if(!fs.length)return;
  pick.setAttribute('aria-disabled','true');msg.className='';
  let ok=0;
  for(const f of fs){
    msg.textContent='Uploading '+(ok+1)+' of '+fs.length+'…';
    try{
      const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':f.type||'application/octet-stream','X-Filename':encodeURIComponent(f.name)},body:f});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.message||'Upload failed.');
      const d=document.createElement('div');d.textContent=f.name;shots.append(d);ok++;
    }catch(e){msg.className='bad';msg.textContent=e.message||'Upload failed.';pick.removeAttribute('aria-disabled');return}
  }
  msg.className='good';msg.textContent=ok===1?'Added. You can close this page.':'Added '+ok+' files. You can close this page.';
  pick.removeAttribute('aria-disabled');pick.firstChild.textContent='Add another';
});
</script>`,
    ),
    nonce,
  );
});

uploadPage.post('/upload/:token', async (c) => {
  const origin = c.req.header('Origin');
  if (origin && new URL(origin).host !== new URL(c.req.url).host)
    return c.json({ message: 'Cross-site request blocked.' }, 403);
  const link = await findLink(c.env.DB, c.req.param('token'));
  if (!link) return c.json({ message: 'This link has expired. Ask for a new one.' }, 404);
  if (Number(c.req.header('Content-Length') ?? 0) > MAX_FILE_BYTES)
    return c.json({ message: 'That file is too big (20 MB max).' }, 413);
  // Count the upload first, so parallel requests can't exceed the limit.
  const claimed = await c.env.DB.prepare(
    'UPDATE upload_links SET uploads = uploads + 1 WHERE token_hash = ? AND uploads < ?',
  )
    .bind(await hash(c.req.param('token')), LINK_MAX_UPLOADS)
    .run();
  if (!claimed.meta.changes) return c.json({ message: 'This link has been used up.' }, 410);
  try {
    const name = c.req.header('X-Filename');
    const f = await storeFile(c.env, {
      applicationId: link.application_id,
      kind: link.kind,
      eventId: link.event_id,
      bytes: await c.req.arrayBuffer(),
      filename: name ? decodeURIComponent(name) : 'file',
    });
    return c.json(f, 201);
  } catch (e) {
    if (e instanceof ApiError) return c.json({ message: e.message }, e.status);
    throw e;
  }
});
