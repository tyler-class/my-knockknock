import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_PROMPTS, MCP_PROMPTS } from '@shared/examples';
import type { AppState } from '../../src/shared/types';
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
        'round_overview',
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
      stories: { from_bank: boolean; angle: string }[];
      files: unknown[];
      inferred: string[];
    }>(token, 'get_application', { application: 'Copperleaf' });
    expect(detail.data).toMatchObject({ status: 'applied', inferred: ['reports_to'] });
    expect(detail.data.stories[0]).toMatchObject({ from_bank: true, angle: 'Lead with the date.' });
    expect(detail.data.files).toHaveLength(1);

    const overview = await tool<{
      by_status: Record<string, number>;
      upcoming_meetings: unknown[];
    }>(token, 'round_overview');
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

  it('find_applications looks in the current search unless all_rounds is on', async () => {
    const api = await session();
    await api.post('/rounds', { name: 'Past search' });
    const old = await api.post<{ id: string }>('/applications', {
      title: 'Ops lead',
      company: 'Zephyrine Freight',
    });
    expect(old.status).toBe(201);
    await api.post('/rounds', { name: 'Now search' });
    const { token } = (await connect()) as { token: string };
    const here = await tool<{ count: number; in_past_rounds?: number }>(
      token,
      'find_applications',
      { query: 'zephyrine' },
    );
    expect(here.data).toMatchObject({ count: 0, in_past_rounds: 1 });
    const everywhere = await tool<{ count: number; applications: { id: string }[] }>(
      token,
      'find_applications',
      { query: 'zephyrine', all_rounds: true },
    );
    expect(everywhere.data.count).toBe(1);
    expect(everywhere.data.applications.map((a) => a.id)).toEqual([old.data.id]);
  });

  it('set_company_logo attaches a logo from a data URL and sets the monogram color', async () => {
    const api = await session();
    await api.post('/applications', { title: 'PM', company: 'The Quokka Company' });
    const { token } = (await connect()) as { token: string };
    const colored = await tool<{ logo: string; monogram: string; color: string }>(
      token,
      'set_company_logo',
      { company: 'quokka', color: 'teal' },
    );
    expect(colored.data).toMatchObject({ logo: 'none', monogram: 'Q', color: 'teal' });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle r="4"/></svg>';
    const withLogo = await tool<{ logo: string }>(token, 'set_company_logo', {
      company: 'The Quokka Company',
      image_url: `data:image/svg+xml;base64,${btoa(svg)}`,
    });
    expect(withLogo.data.logo).toBe('uploaded');
    const app = await tool<{ company_mark: { logo: string } }>(token, 'get_application', {
      application: 'quokka',
    });
    expect(app.data.company_mark.logo).toBe('uploaded');
    const notImage = await tool(token, 'set_company_logo', {
      company: 'quokka',
      image_url: `data:image/png;base64,${btoa('<html><body>hi</body></html>')}`,
    });
    expect(notImage.error).toMatch(/isn’t a PNG/);
    const back = await tool<{ logo: string; color: string }>(token, 'set_company_logo', {
      company: 'quokka',
      remove_logo: true,
      color: 'default',
    });
    expect(back.data).toMatchObject({ logo: 'none', color: 'ultramarine' });
  });

  it('questions: bank, job-only and linked, rewording detaches, removing unlinks or deletes', async () => {
    const api = await session();
    await api.post('/applications', { title: 'Staff PM', company: 'Larkspur Labs' });
    const { token } = (await connect()) as { token: string };
    const names = (await rpc(token, 'tools/list')).data.result!.tools!.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_questions',
        'list_archived_questions',
        'get_question',
        'create_question',
        'update_question',
        'delete_question',
        'add_job_question',
        'link_question',
        'update_job_question',
        'save_job_question_to_bank',
        'remove_job_question',
        'get_meeting_questions',
        'add_meeting_question',
        'update_meeting_question',
      ]),
    );
    expect(names).not.toContain('sync_job_story');

    const bank = await tool<{ created: { id: string } }>(token, 'create_question', {
      text: 'What does success look like in the first 90 days?',
    });
    expect(bank.error).toBeNull();
    const again = await tool<{ already_there: unknown }>(token, 'create_question', {
      text: 'what does success look like in the first 90 days',
    });
    expect(again.data.already_there).toBeTruthy();
    const found = await tool<{ questions: { id: string }[] }>(token, 'list_questions', {
      query: 'success 90 days',
    });
    expect(found.data.questions[0]!.id).toBe(bank.data.created.id);

    // Linked from the bank, and one just for the job.
    const linked = await tool<{ linked: { id: string; from_bank: boolean } }>(
      token,
      'link_question',
      { application: 'Larkspur', question: 'success first 90' },
    );
    expect(linked.data.linked.from_bank).toBe(true);
    const own = await tool<{ added: { id: string; from_bank: boolean } }>(
      token,
      'add_job_question',
      { application: 'Larkspur', text: 'How is the PM team organized?' },
    );
    expect(own.data.added.from_bank).toBe(false);
    let app = await tool<{ questions: { text: string; from_bank: boolean }[] }>(
      token,
      'get_application',
      { application: 'Larkspur' },
    );
    expect(app.data.questions.map((q) => [q.text, q.from_bank])).toEqual([
      ['What does success look like in the first 90 days?', true],
      ['How is the PM team organized?', false],
    ]);

    // The bank's new words reach the linked one; rewording it on the job makes it job-only and
    // leaves the bank alone.
    await tool(token, 'update_question', {
      question: bank.data.created.id,
      text: 'What does success look like in 90 days?',
    });
    app = await tool(token, 'get_application', { application: 'Larkspur' });
    expect(app.data.questions[0]).toMatchObject({
      text: 'What does success look like in 90 days?',
      from_bank: true,
    });
    const reworded = await tool<{ updated: { from_bank: boolean }; note: string }>(
      token,
      'update_job_question',
      {
        application: 'Larkspur',
        question: 'success 90',
        text: 'What would make this hire a win by March?',
      },
    );
    expect(reworded.data.updated.from_bank).toBe(false);
    expect(reworded.data.note).toMatch(/job-only/);
    const kept = await tool<{ text: string; on_jobs: string[] }>(token, 'get_question', {
      question: bank.data.created.id,
    });
    expect(kept.data).toMatchObject({
      text: 'What does success look like in 90 days?',
      on_jobs: [],
    });
    // Moving one doesn't detach it.
    const relinked = await tool<{ linked: { id: string } }>(token, 'link_question', {
      application: 'Larkspur',
      question: bank.data.created.id,
    });
    const moved = await tool<{ updated: { from_bank: boolean; position: number } }>(
      token,
      'update_job_question',
      { application: 'Larkspur', question: relinked.data.linked.id, position: 0 },
    );
    expect(moved.data.updated).toMatchObject({ from_bank: true, position: 0 });

    // Save the job-only one to the bank.
    const saved = await tool<{ saved: { from_bank: boolean } }>(
      token,
      'save_job_question_to_bank',
      { application: 'Larkspur', question: 'PM team organized' },
    );
    expect(saved.data.saved.from_bank).toBe(true);

    // Removing: a linked one is unlinked (the bank keeps it), a job-only one is deleted.
    const unlinked = await tool<{ removed: string }>(token, 'remove_job_question', {
      application: 'Larkspur',
      question: relinked.data.linked.id,
    });
    expect(unlinked.data.removed).toBeTruthy();
    const gone = await tool<{ deleted: string }>(token, 'remove_job_question', {
      application: 'Larkspur',
      question: 'win by March',
    });
    expect(gone.data.deleted).toBe('What would make this hire a win by March?');
    const state = (await api.get<AppState>('/state')).data;
    expect(state.questions.map((q) => q.text)).toEqual(
      expect.arrayContaining(['What does success look like in 90 days?']),
    );
    expect(
      state.questions.find((q) => q.text === 'What would make this hire a win by March?'),
    ).toBeUndefined();

    // Archive, find in the archive, bring back, then delete from the bank.
    await tool(token, 'update_question', { question: bank.data.created.id, archived: true });
    const live = await tool<{ questions: { id: string }[] }>(token, 'list_questions', {});
    expect(live.data.questions.map((q) => q.id)).not.toContain(bank.data.created.id);
    const archived = await tool<{ note: string; questions: { id: string; archived: boolean }[] }>(
      token,
      'list_archived_questions',
      {},
    );
    expect(archived.data.questions).toEqual([
      expect.objectContaining({ id: bank.data.created.id, archived: true }),
    ]);
    expect(archived.data.note).toMatch(/update_question.*archived: false/);
    await tool(token, 'update_question', { question: bank.data.created.id, archived: false });
    const del = await tool<{ deleted: string }>(token, 'delete_question', {
      question: bank.data.created.id,
    });
    expect(del.error).toBeNull();
    expect((await tool(token, 'get_question', { question: bank.data.created.id })).error).toMatch(
      /No bank question/,
    );

    // A meeting's questions: the job's come up, a meeting-only one is added, an answer noted.
    const m = await tool<{ logged: { id: string } }>(token, 'log_meeting', {
      application: 'Larkspur',
      title: 'Hiring manager',
      starts_at: '2099-01-10 10:00',
    });
    const mq = await tool<{ questions: { id: string; text: string; from: string }[] }>(
      token,
      'get_meeting_questions',
      { meeting: m.data.logged.id },
    );
    expect(mq.data.questions).toEqual([
      expect.objectContaining({ text: 'How is the PM team organized?', from: 'job' }),
    ]);
    const added = await tool<{ questions: { text: string; from: string }[] }>(
      token,
      'add_meeting_question',
      { meeting: m.data.logged.id, text: 'What did the last PM leave unfinished?' },
    );
    expect(added.data.questions.map((q) => q.from)).toEqual(['job', 'meeting']);
    const answered = await tool<{ questions: { text: string; asked: boolean; answer?: string }[] }>(
      token,
      'update_meeting_question',
      { meeting: m.data.logged.id, question: 'PM team organized', answer: 'Three pods.' },
    );
    expect(answered.data.questions[0]).toMatchObject({ asked: true, answer: 'Three pods.' });
    const noRemove = await tool(token, 'update_meeting_question', {
      meeting: m.data.logged.id,
      question: 'PM team organized',
      remove: true,
    });
    expect(noRemove.error).toMatch(/remove_job_question/);
    const removed = await tool<{ questions: unknown[] }>(token, 'update_meeting_question', {
      meeting: m.data.logged.id,
      question: 'last PM',
      remove: true,
    });
    expect(removed.data.questions).toHaveLength(1);
  });

  it('stories: job-only stories, saving to the bank, editing detaches, removing and deleting', async () => {
    const api = await session();
    await api.post('/applications', { title: 'Director', company: 'Brightwater Mills' });
    const { token } = (await connect()) as { token: string };
    const bankStory = await tool<{ created: { id: string } }>(token, 'create_story', {
      framework: 'star',
      title: 'Rescuing the Q3 launch',
      sections: { situation: 'A slipping launch.', result: 'Shipped a week early.' },
    });
    await tool(token, 'link_story', {
      application: 'Brightwater',
      story: 'Rescuing the Q3',
      angle: 'Stress the vendor.',
    });

    // The angle alone keeps it linked; changing its parts makes it job-only, bank unchanged.
    const angled = await tool<{ updated: { from_bank: boolean } }>(token, 'update_job_story', {
      application: 'Brightwater',
      story: 'Rescuing the Q3',
      angle: 'Stress the budget.',
    });
    expect(angled.data.updated.from_bank).toBe(true);
    const edited = await tool<{ updated: { from_bank: boolean }; note: string }>(
      token,
      'update_job_story',
      {
        application: 'Brightwater',
        story: 'Rescuing the Q3',
        sections: { situation: 'A slipping launch.', result: 'Shipped two weeks early.' },
      },
    );
    expect(edited.data.updated.from_bank).toBe(false);
    expect(edited.data.note).toMatch(/job-only/);
    const bank = await tool<{ sections: { key: string; text: string }[]; copies: unknown[] }>(
      token,
      'get_story',
      { story: bankStory.data.created.id },
    );
    expect(bank.data.sections.find((x) => x.key === 'result')!.text).toBe('Shipped a week early.');
    expect(bank.data.copies).toEqual([]);
    const full = await tool<{ angle: string; from_bank: boolean }>(token, 'get_job_story', {
      application: 'Brightwater',
      story: 'Rescuing the Q3',
    });
    expect(full.data).toMatchObject({ angle: 'Stress the budget.', from_bank: false });

    // A story just for this job, then saved to the bank.
    const own = await tool<{ created: { id: string; from_bank: boolean } }>(
      token,
      'create_job_story',
      {
        application: 'Brightwater',
        framework: 'Why this job',
        title: 'Why Brightwater',
        angle: 'Mills, not software.',
      },
    );
    expect(own.error).toBeNull();
    expect(own.data.created.from_bank).toBe(false);
    const saved = await tool<{ saved: { id: string } }>(token, 'save_job_story_to_bank', {
      application: 'Brightwater',
      story: 'Why Brightwater',
    });
    expect(saved.error).toBeNull();
    const twice = await tool<{ note: string }>(token, 'save_job_story_to_bank', {
      application: 'Brightwater',
      story: 'Why Brightwater',
    });
    expect(twice.data.note).toMatch(/Already linked/);

    // Removing a linked one unlinks it (the bank keeps it); a job-only one is deleted.
    const unlinked = await tool<{ removed: string }>(token, 'remove_job_story', {
      application: 'Brightwater',
      story: 'Why Brightwater',
    });
    expect(unlinked.data.removed).toBe('Why Brightwater');
    expect((await tool(token, 'get_story', { story: 'Why Brightwater' })).error).toBeNull();
    const deleted = await tool<{ deleted: string }>(token, 'remove_job_story', {
      application: 'Brightwater',
      story: 'Rescuing the Q3',
    });
    expect(deleted.data.deleted).toBe('Rescuing the Q3 launch');
    const app = await tool<{ stories: unknown[] }>(token, 'get_application', {
      application: 'Brightwater',
    });
    expect(app.data.stories).toEqual([]);

    // Deleting from the bank.
    const gone = await tool(token, 'delete_story', { story: saved.data.saved.id });
    expect(gone.error).toBeNull();
    expect((await tool(token, 'get_story', { story: saved.data.saved.id })).error).toMatch(
      /No bank story/,
    );
  });

  it('people and companies: add at a company, reuse, link, update, remove from a job, delete', async () => {
    const api = await session();
    await api.post('/applications', { title: 'Head of Ops', company: 'Tidewell' });
    await api.post('/applications', { title: 'Ops Director', company: 'Tidewell' });
    const { token } = (await connect()) as { token: string };

    // Someone at the company on no job yet.
    const atCo = await tool<{ added: { id: string; company: string; applications: unknown[] } }>(
      token,
      'add_person',
      {
        company: 'Tidewell',
        name: 'Priya Natarajan',
        email: 'priya@tidewell.example',
        role: 'recruiter',
      },
    );
    expect(atCo.error).toBeNull();
    expect(atCo.data.added).toMatchObject({ company: 'Tidewell', applications: [] });
    // Adding her to a job reuses her rather than making a second Priya.
    const reused = await tool<{ linked: { id: string; applications: { name: string }[] } }>(
      token,
      'add_person',
      { application: 'Tidewell Head of Ops', name: 'Priya Natarajan' },
    );
    expect(reused.data.linked.id).toBe(atCo.data.added.id);
    const onBoth = await tool<{ linked: { applications: unknown[] } }>(token, 'link_person', {
      person: 'priya@tidewell.example',
      application: 'Tidewell Ops Director',
    });
    expect(onBoth.data.linked.applications).toHaveLength(2);

    const upd = await tool<{ updated: Record<string, unknown> }>(token, 'update_person', {
      person: 'Priya',
      role: 'other',
      other_role: 'Head of Talent',
      notes: 'Prefers Tuesdays.',
    });
    expect(upd.data.updated).toMatchObject({
      role: 'other',
      role_label: 'Head of Talent',
      email: 'priya@tidewell.example',
      notes: 'Prefers Tuesdays.',
    });

    // An agency recruiter on a job, at another company.
    const agency = await tool<{ added: { company: string } }>(token, 'add_person', {
      application: 'Tidewell Head of Ops',
      company: 'Northstar Search',
      name: 'Sam Okafor',
    });
    expect(agency.data.added.company).toBe('Northstar Search');

    // Off one job: she stays at the company and on the other job.
    const off = await tool<{ note: string }>(token, 'remove_person_from_job', {
      person: 'Priya',
      application: 'Tidewell Head of Ops',
    });
    expect(off.data.note).toMatch(/stays at Tidewell/);
    const co = await tool<{
      jobs: unknown[];
      people: { name: string; applications: unknown[] }[];
    }>(token, 'get_company', { company: 'Tidewell' });
    expect(co.data.jobs).toHaveLength(2);
    expect(co.data.people).toEqual([
      expect.objectContaining({ name: 'Priya Natarajan', applications: [expect.anything()] }),
    ]);
    const people = await tool<{ count: number }>(token, 'find_people', { query: 'northstar' });
    expect(people.data.count).toBe(1);

    // Company details go to every job there.
    await tool(token, 'update_company', {
      company: 'Tidewell',
      hq: 'Portland, ME',
      size: '201–500',
    });
    const job = await tool<{ company_hq: string }>(token, 'get_application', {
      application: 'Tidewell Ops Director',
    });
    expect(job.data.company_hq).toBe('Portland, ME');
    const made = await tool<{ created: { name: string } }>(token, 'create_company', {
      name: 'Juniper Freight',
      website: 'juniper.example',
    });
    expect(made.data.created.name).toBe('Juniper Freight');

    // Moving someone between companies, off one, and to one that's new.
    const moved = await tool<{ moved: { company: string } }>(token, 'set_person_company', {
      person: 'Priya',
      company: 'juniper freight',
    });
    expect(moved.data.moved.company).toBe('Juniper Freight');
    const offCo = await tool<{ removed_from: string }>(token, 'set_person_company', {
      person: 'Priya',
      remove: true,
    });
    expect(offCo.data.removed_from).toBe('Juniper Freight');
    const back = await tool<{ moved: { company: string } }>(token, 'set_person_company', {
      person: 'Priya',
      company: 'Tidewell',
    });
    expect(back.data.moved.company).toBe('Tidewell');
    const fresh = await tool<{ moved: { company: string }; note: string }>(
      token,
      'set_person_company',
      { person: 'Sam Okafor', company: 'Brightline Talent' },
    );
    expect(fresh.data.moved.company).toBe('Brightline Talent');
    expect(fresh.data.note).toMatch(/new company/);

    // Deleting a person, a job and a company.
    expect((await tool(token, 'delete_person', { person: 'Sam Okafor' })).error).toBeNull();
    const delJob = await tool<{ deleted: string }>(token, 'delete_application', {
      application: 'Tidewell Ops Director',
    });
    expect(delJob.data.deleted).toBe('Tidewell · Ops Director');
    // Her job went, but she stays at the company.
    const after = await tool<{ people: { name: string }[] }>(token, 'get_company', {
      company: 'Tidewell',
    });
    expect(after.data.people.map((p) => p.name)).toEqual(['Priya Natarajan']);
    const delCo = await tool<{ jobs_deleted: string[]; people_deleted: string[] }>(
      token,
      'delete_company',
      { company: 'Tidewell' },
    );
    expect(delCo.data).toMatchObject({
      jobs_deleted: ['Head of Ops'],
      people_deleted: ['Priya Natarajan'],
    });
  });

  it('files: a file on no job, linked to several, renamed, unlinked and deleted', async () => {
    const api = await session();
    await api.post('/applications', { title: 'PM', company: 'Ostrander' });
    await api.post('/applications', { title: 'PM', company: 'Velloway' });
    const { token } = (await connect()) as { token: string };
    const f = await tool<{ saved: { id: string } }>(token, 'add_text_file', {
      text: 'Resume, plain text.',
      kind: 'resume',
      filename: 'resume-2026.txt',
    });
    expect(f.error).toBeNull();
    const linked = await tool<{ file: { applications: unknown[] } }>(token, 'link_file', {
      file: f.data.saved.id,
      applications: ['Ostrander', 'Velloway'],
    });
    expect(linked.data.file.applications).toHaveLength(2);
    const renamed = await tool<{ updated: { label: string } }>(token, 'update_file', {
      file: 'resume-2026',
      label: 'Resume (ops)',
    });
    expect(renamed.data.updated.label).toBe('Resume (ops)');
    const off = await tool<{ file: { applications: unknown[] } }>(token, 'unlink_file', {
      file: 'Resume (ops)',
      application: 'Velloway',
    });
    expect(off.data.file.applications).toHaveLength(1);
    const listed = await tool<{ count: number }>(token, 'list_files', {
      kind: 'resume',
      query: 'ops',
    });
    expect(listed.data.count).toBe(1);
    const del = await tool<{ was_on: string[] }>(token, 'delete_file', { file: 'Resume (ops)' });
    expect(del.data.was_on).toEqual(['Ostrander · PM']);
    expect((await tool<{ count: number }>(token, 'list_files', { query: 'ops' })).data.count).toBe(
      0,
    );
  });
});
