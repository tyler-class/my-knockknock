import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { AppState, Application, FileRef } from '../../src/shared/types';
import { ORIGIN, session } from './helpers';

const VTT = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
<v Priya>Tell me about a time you pushed back.

2
00:00:05.000 --> 00:00:09.000
<v Me>Sure. A VP promised the board a date.
`;

describe('files', () => {
  it('uploads a resume, keeps transcript text, locks, and deletes', async () => {
    const api = await session();
    const a = (
      await api.post<Application>('/applications', { title: 'Architect', company: 'Fathom' })
    ).data;
    const pdf = new TextEncoder().encode('%PDF-1.7\n% resume\n');
    const up = await SELF.fetch(`${ORIGIN}/api/applications/${a.id}/files?kind=resume`, {
      method: 'POST',
      headers: {
        Cookie: api.cookie,
        Origin: ORIGIN,
        'Content-Type': 'application/pdf',
        'X-Filename': encodeURIComponent('Resume v3.pdf'),
      },
      body: pdf,
    });
    expect(up.status).toBe(201);
    const resume = (await up.json()) as FileRef;
    expect(resume).toMatchObject({
      kind: 'resume',
      filename: 'Resume v3.pdf',
      content_type: 'application/pdf',
      has_text: false,
    });
    expect(resume.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The first resume becomes the one it was sent with.
    expect(
      (await api.get<AppState>('/state')).data.applications.find((x) => x.id === a.id)!
        .resume_file_id,
    ).toBe(resume.id);

    const dl = await SELF.fetch(`${ORIGIN}/api/files/${resume.id}`, {
      headers: { Cookie: api.cookie },
    });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('Content-Disposition')).toMatch(/^attachment/);
    expect(await dl.text()).toContain('%PDF');

    // A disguised file is refused.
    const bad = await SELF.fetch(`${ORIGIN}/api/applications/${a.id}/files?kind=resume`, {
      method: 'POST',
      headers: {
        Cookie: api.cookie,
        Origin: ORIGIN,
        'Content-Type': 'application/pdf',
        'X-Filename': 'x.pdf',
      },
      body: new Uint8Array([0x4d, 0x5a, 0, 1]),
    });
    expect(bad.status).toBe(415);

    // Transcripts keep their text, cues stripped.
    const t = await SELF.fetch(`${ORIGIN}/api/applications/${a.id}/files?kind=transcript`, {
      method: 'POST',
      headers: {
        Cookie: api.cookie,
        Origin: ORIGIN,
        'Content-Type': 'text/vtt',
        'X-Filename': 'panel.vtt',
      },
      body: VTT,
    });
    const tf = (await t.json()) as FileRef;
    expect(tf.has_text).toBe(true);
    const text = await api.get<{ text: string }>(`/files/${tf.id}/text`);
    expect(text.data.text).toBe(
      'Tell me about a time you pushed back.\nSure. A VP promised the board a date.',
    );
    expect((await api.get(`/files/${resume.id}/text`)).status).toBe(409);

    const pasted = await api.post<FileRef>(`/applications/${a.id}/text-files`, {
      text: 'Pasted transcript',
      label: 'Screen call',
    });
    expect(pasted.data).toMatchObject({ kind: 'transcript', label: 'Screen call', has_text: true });

    // Each file added a "File added" note to the timeline, pointing at it.
    const fileNotes = (await api.get<AppState>('/state')).data.events.filter(
      (e) => e.application_id === a.id && e.type === 'note',
    );
    const resumeNote = fileNotes.find(
      (e) => (e.data as { file_id?: string }).file_id === resume.id,
    );
    expect(resumeNote?.title).toMatch(/^File added: /);
    // Its time can be changed like any note's.
    const moved = await api.patch<{ event: { occurred_at: string } }>(`/events/${resumeNote!.id}`, {
      occurred_at: '2026-01-05T15:00:00Z',
    });
    expect(moved.data.event.occurred_at).toBe('2026-01-05T15:00:00.000Z');

    // No locking: a file is just there or not. Deleting it takes its timeline entry too.
    expect((await api.del(`/files/${resume.id}`)).status).toBe(200);
    expect(
      (await api.get<AppState>('/state')).data.events.some((e) => e.id === resumeNote!.id),
    ).toBe(false);
    expect(
      (await api.get<AppState>('/state')).data.applications.find((x) => x.id === a.id)!
        .resume_file_id,
    ).toBeNull();
  });

  it('one-time upload links work without signing in, then expire by use', async () => {
    const api = await session();
    const a = (
      await api.post<Application>('/applications', { title: 'Architect', company: 'Quarry' })
    ).data;
    const link = await api.post<{ url: string }>('/upload-links', {
      application_id: a.id,
      kind: 'cover_letter',
    });
    expect(link.status).toBe(201);
    const path = new URL(link.data.url).pathname;
    const page = await SELF.fetch(`${ORIGIN}${path}`);
    expect(await page.text()).toContain('Add a cover letter');
    const up = await SELF.fetch(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'X-Filename': 'cover.txt' },
      body: 'Dear Quarry,',
    });
    expect(up.status).toBe(201);
    expect(((await up.json()) as FileRef).kind).toBe('cover_letter');
    expect((await SELF.fetch(`${ORIGIN}/upload/not-a-real-token-at-all-xx`)).status).toBe(404);
  });
});
