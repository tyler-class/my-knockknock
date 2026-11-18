import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_PROMPTS, MCP_PROMPTS } from '@shared/examples';
import pkg from '../../package.json';
import { ORIGIN, PASSWORD, session } from './helpers';

const REDIRECT = 'https://client.example/callback';

async function pkce() {
  const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(
    /[+/=]/g,
    '',
  );
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { verifier, challenge };
}

function cookies(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

async function connect(password = PASSWORD) {
  const reg = await SELF.fetch(`${ORIGIN}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Test Assistant',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
    }),
  });
  expect(reg.status).toBe(201);
  const client = (await reg.json()) as { client_id: string };
  const { verifier, challenge } = await pkce();
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    scope: 'jobs',
    resource: `${ORIGIN}/mcp`,
  });
  const page = await SELF.fetch(`${ORIGIN}/authorize?${q}`);
  expect(page.status).toBe(200);
  // A form-action CSP would block the browser from following the redirect back to the client.
  expect(page.headers.get('Content-Security-Policy') ?? '').not.toMatch(/form-action/);
  const html = await page.text();
  expect(html).toContain('Let Test Assistant use Knock Knock?');
  expect(html).toContain('client.example');
  const handle = /name="handle" value="([^"]+)"/.exec(html)![1]!;
  const form = (pw: string) =>
    new URLSearchParams({
      handle,
      decision: 'approve',
      password: pw,
      client_name: 'Test Assistant',
      redirect_host: 'client.example',
    });
  const post = (pw: string) =>
    SELF.fetch(`${ORIGIN}/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookies(page),
        'CF-Connecting-IP': '198.18.0.9',
      },
      body: form(pw),
    });
  if (password !== PASSWORD) return { res: await post(password) };
  const wrong = await post('nope');
  expect(wrong.status).toBe(401);
  expect(await wrong.text()).toContain('That password is not right.');
  const ok = await post(PASSWORD);
  expect(ok.status).toBe(302);
  const loc = new URL(ok.headers.get('Location')!);
  expect(loc.origin + loc.pathname).toBe(REDIRECT);
  expect(loc.searchParams.get('state')).toBe('xyz');
  const tok = await SELF.fetch(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: loc.searchParams.get('code')!,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
      resource: `${ORIGIN}/mcp`,
    }),
  });
  expect(tok.status).toBe(200);
  return { token: ((await tok.json()) as { access_token: string }).access_token };
}

let rpcId = 0;
async function rpc(token: string, method: string, params: unknown = {}) {
  const res = await SELF.fetch(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const body = await res.text();
  const json = body.startsWith('{') ? body : (/^data: (.*)$/m.exec(body)?.[1] ?? body);
  return {
    status: res.status,
    data: JSON.parse(json) as {
      result?: { content?: { text: string }[]; tools?: { name: string }[]; isError?: boolean };
      error?: unknown;
    },
  };
}

interface Result {
  result?: { content?: { text: string }[]; tools?: { name: string }[]; isError?: boolean };
}
async function tool<T = unknown>(token: string, name: string, args: unknown = {}) {
  const r = await rpc(token, 'tools/call', { name, arguments: args });
  const res = (r.data as Result).result!;
  const text = res.content![0]!.text;
  if (res.isError) return { error: text, data: null as T };
  return {
    error: null,
    data: (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as T,
  };
}

describe('MCP', () => {
  it('rejects requests without a token', async () => {
    const res = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toMatch(/resource_metadata=/);
  });

  it('runs the whole agent loop: add a job, log mail without duplicates, move status, stories, files', async () => {
    const { token } = (await connect()) as { token: string };
    const list = await rpc(token, 'tools/list');
    const names = list.data.result!.tools!.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'search_overview',
        'find_applications',
        'get_application',
        'get_timeline',
        'create_application',
        'set_status',
        'log_meeting',
        'update_meeting',
        'log_email',
        'add_note',
        'update_event',
        'delete_event',
        'list_stories',
        'list_archived_stories',
        'create_story',
        'link_story',
        'upload_link',
        'add_text_file',
        'get_file_text',
      ]),
    );
    // Stories aren't marked as told any more.
    expect(names).not.toContain('record_story_told');
    const prompts = await rpc(token, 'prompts/list');
    expect(
      (prompts.data.result as unknown as { prompts: { name: string }[] }).prompts.map(
        (p) => p.name,
      ),
    ).toEqual(MCP_PROMPTS.map((p) => p.name));
    const started = await tool<string>(token, 'get_started');
    expect(started.data).toContain(EXAMPLE_PROMPTS[0]!.prompt);

    // Bulk intake: a posting becomes a Saved application; the same link isn't added twice.
    const add = await tool<{ created: { id: string; status: string } }>(
      token,
      'create_application',
      {
        title: 'Sr. Manager, RevOps Systems',
        company: 'Copperleaf',
        url: 'https://boards.example.com/copperleaf/42',
        company_domain: 'copperleaf.example',
        salary_min: 175000,
        salary_max: 200000,
        work_mode: 'remote',
        seniority: 'Senior manager',
        reports_to: 'VP Revenue Ops',
        inferred: ['reports_to'],
        must_haves: ['Salesforce', 'CPQ'],
        source: 'LinkedIn',
      },
    );
    expect(add.error).toBeNull();
    expect(add.data.created.status).toBe('saved');
    const again = await tool<{ already_saved: boolean }>(token, 'create_application', {
      title: 'x',
      company: 'Copperleaf',
      url: 'https://boards.example.com/copperleaf/42?utm_source=x',
    });
    expect(again.data.already_saved).toBe(true);

    // "Thanks for applying": find it, read around the date, log the email, move to Applied.
    const found = await tool<{ applications: { id: string }[] }>(token, 'find_applications', {
      query: 'copperleaf.example',
      status: ['saved'],
    });
    expect(found.data.applications.map((a) => a.id)).toEqual([add.data.created.id]);
    const before = await tool<{ count: number }>(token, 'get_timeline', {
      application: 'Copperleaf',
      around: '2026-11-03',
      types: ['email'],
    });
    expect(before.data.count).toBe(0);
    const mail = await tool<{ logged: { id: string; logged_by: string }; nearby: unknown[] }>(
      token,
      'log_email',
      {
        application: 'copperleaf',
        direction: 'in',
        occurred_at: '2026-11-03 09:12',
        category: 'confirmation',
        subject: 'Thanks for applying',
        summary: 'Automated confirmation from the hiring site.',
        external_ref: 'gmail:111',
      },
    );
    expect(mail.error).toBeNull();
    expect(mail.data.logged.logged_by).toBe('Test Assistant');
    const dup = await tool(token, 'log_email', {
      application: 'copperleaf',
      direction: 'in',
      occurred_at: '2026-11-03 09:12',
      category: 'confirmation',
      summary: 'again',
      external_ref: 'gmail:111',
    });
    expect(dup.error).toMatch(/already logged.*Existing event id/s);
    const moved = await tool<{ application: { status: string }; logged: { caused_by: string } }>(
      token,
      'set_status',
      {
        application: 'Copperleaf',
        status: 'applied',
        occurred_at: '2026-11-03 09:12',
        caused_by: mail.data.logged.id,
      },
    );
    expect(moved.data.application.status).toBe('applied');
    expect(moved.data.logged.caused_by).toBe(mail.data.logged.id);

    // An interview the person already typed in: the agent sees it nearby and updates it instead.
    const manual = await tool<{ logged: { id: string } }>(token, 'log_meeting', {
      application: 'Copperleaf',
      title: 'Screen',
      starts_at: '2099-11-20 10:00',
    });
    const near = await tool<{ events: { id: string }[] }>(token, 'get_timeline', {
      application: 'Copperleaf',
      around: '2099-11-20',
      types: ['meeting'],
    });
    expect(near.data.events.map((e) => e.id)).toEqual([manual.data.logged.id]);
    const upd = await tool<{
      logged: { join_url: string; external_ref: string; attendees: unknown[] };
    }>(token, 'update_meeting', {
      event: manual.data.logged.id,
      join_url: 'https://zoom.us/j/9',
      attendees: [{ name: 'Dana Ruiz', title: 'Recruiter' }],
      external_ref: 'gcal:777',
    });
    expect(upd.data.logged).toMatchObject({
      join_url: 'https://zoom.us/j/9',
      external_ref: 'gcal:777',
    });

    // Stories: write one, find it by the question, link it.
    const st = await tool<{ created: { id: string } }>(token, 'create_story', {
      framework: 'STAR',
      title: 'Pushing back on a VP deadline',
      sections: {
        situation: 'A VP promised a date.',
        task: 'Say no without blocking.',
        action: 'Two plans side by side.',
        result: 'Shipped on time.',
      },
    });
    expect(st.error).toBeNull();
    // Found by the words in its parts (there are no probable questions any more).
    const hits = await tool<{ id: string; questions?: unknown; tags?: unknown }[]>(
      token,
      'list_stories',
      { query: 'when a VP promised a date you could not hit' },
    );
    expect(hits.data[0]).toMatchObject({ id: st.data.created.id });
    expect(hits.data[0]).not.toHaveProperty('questions');
    expect(hits.data[0]).not.toHaveProperty('tags');
    const linked = await tool<{ linked: { job_story: string } }>(token, 'link_story', {
      application: 'Copperleaf',
      story: 'pushing back',
      angle: 'Lead with the date.',
    });
    expect(linked.error).toBeNull();

    // Archiving takes a story out of list_stories; list_archived_stories finds it and says how
    // to bring it back, and update_story with archived: false restores it.
    const arch = await tool(token, 'update_story', { story: st.data.created.id, archived: true });
    expect(arch.error).toBeNull();
    const without = await tool<{ id: string }[]>(token, 'list_stories', { query: 'pushing back' });
    expect(without.data.map((h) => h.id)).not.toContain(st.data.created.id);
    const archivedList = await tool<{
      note: string;
      stories: { id: string; archived: boolean }[];
    }>(token, 'list_archived_stories', { query: 'pushing back' });
    expect(archivedList.data.stories).toEqual([
      expect.objectContaining({ id: st.data.created.id, archived: true }),
    ]);
    expect(archivedList.data.note).toMatch(/update_story.*archived: false/);
    const restored = await tool(token, 'update_story', {
      story: 'Pushing back on a VP deadline',
      archived: false,
    });
    expect(restored.error).toBeNull();
    const back = await tool<{ id: string }[]>(token, 'list_stories', { query: 'pushing back' });
    expect(back.data.map((h) => h.id)).toContain(st.data.created.id);

    // A transcript as text, read back.
    const file = await tool<{ saved: { id: string } }>(token, 'add_text_file', {
      application: 'Copperleaf',
      text: 'Dana: why RevOps?\nMe: because…',
      meeting: manual.data.logged.id,
    });
    const text = await tool<{ text: string }>(token, 'get_file_text', { file: file.data.saved.id });
    expect(text.data.text).toContain('why RevOps');

    const detail = await tool<{
      status: string;
      stories: { sync: string; angle: string }[];
      files: unknown[];
      inferred: string[];
    }>(token, 'get_application', { application: 'Copperleaf' });
    expect(detail.data).toMatchObject({ status: 'applied', inferred: ['reports_to'] });
    expect(detail.data.stories[0]).toMatchObject({ sync: 'in_sync', angle: 'Lead with the date.' });
    expect(detail.data.files).toHaveLength(1);

    const overview = await tool<{
      by_status: Record<string, number>;
      upcoming_meetings: unknown[];
    }>(token, 'search_overview');
    expect(overview.data.by_status.applied).toBeGreaterThanOrEqual(1);
    expect(overview.data.upcoming_meetings.length).toBeGreaterThanOrEqual(1);

    const ambiguous = await tool(token, 'get_application', { application: 'zzz no such company' });
    expect(ambiguous.error).toMatch(/No application matches/);
  });

  it('reports the package version as the server version', async () => {
    const { token } = (await connect()) as { token: string };
    const init = await rpc(token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    const info = (init.data.result as unknown as { serverInfo: { name: string; version: string } })
      .serverInfo;
    expect(info).toEqual({ name: 'knockknock', version: pkg.version });
  });

  it('find_applications looks in the current search unless all_searches is on', async () => {
    const api = await session();
    await api.post('/searches', { name: 'Past search' });
    const old = await api.post<{ id: string }>('/applications', {
      title: 'Ops lead',
      company: 'Zephyrine Freight',
    });
    expect(old.status).toBe(201);
    await api.post('/searches', { name: 'Now search' });
    const { token } = (await connect()) as { token: string };
    const here = await tool<{ count: number; in_past_searches?: number }>(
      token,
      'find_applications',
      { query: 'zephyrine' },
    );
    expect(here.data).toMatchObject({ count: 0, in_past_searches: 1 });
    const everywhere = await tool<{ count: number; applications: { id: string }[] }>(
      token,
      'find_applications',
      { query: 'zephyrine', all_searches: true },
    );
    expect(everywhere.data.count).toBe(1);
    expect(everywhere.data.applications.map((a) => a.id)).toEqual([old.data.id]);
  });
});
