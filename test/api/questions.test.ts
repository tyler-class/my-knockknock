import { describe, expect, it } from 'vitest';
import type { AppState, Application, JobQuestion, Question } from '../../src/shared/types';
import { session } from './helpers';

describe('questions', () => {
  it('keeps a bank, links bank questions to a job, and keeps job-only ones out of it', async () => {
    const api = await session();
    const a = (await api.post<Application>('/applications', { title: 'PM', company: 'Qco' })).data;

    const bank = await api.post<Question>('/questions', { text: 'What does success look like?' });
    expect(bank.status).toBe(201);

    // From the bank: a copy on the job, pointing back at it.
    const linked = await api.post<JobQuestion>(`/applications/${a.id}/questions`, {
      question_id: bank.data.id,
    });
    expect(linked.data).toMatchObject({ question_id: bank.data.id, text: bank.data.text });

    // Just for this job: not in the bank.
    const own = await api.post<JobQuestion>(`/applications/${a.id}/questions`, {
      text: 'How is the team organized?',
    });
    expect(own.data.question_id).toBeNull();
    let state = (await api.get<AppState>('/state')).data;
    expect(state.questions.map((q) => q.text)).toEqual(['What does success look like?']);

    // Kept in the bank after all.
    const kept = await api.post<JobQuestion>(`/job-questions/${own.data.id}/to-bank`, {});
    expect(kept.data.question_id).toBeTruthy();
    state = (await api.get<AppState>('/state')).data;
    expect(state.questions).toHaveLength(2);

    // Out of the bank: the job keeps its copy.
    await api.del(`/questions/${bank.data.id}`);
    state = (await api.get<AppState>('/state')).data;
    const onJob = state.job_questions.filter((j) => j.application_id === a.id);
    expect(onJob.map((j) => j.text)).toEqual([
      'What does success look like?',
      'How is the team organized?',
    ]);
    expect(onJob[0]!.question_id).toBeNull();
  });

  it('stores a meeting’s questions, with what was said', async () => {
    const api = await session();
    const a = (await api.post<Application>('/applications', { title: 'PM', company: 'Mco' })).data;
    const m = await api.post<{ event: { id: string; data: { questions: unknown[] } } }>(
      `/applications/${a.id}/meetings`,
      {
        title: 'Screen',
        occurred_at: '2030-01-01T10:00:00Z',
        questions: [{ id: 'q1', text: 'Why now?', answer: null, asked: false }],
      },
    );
    expect(m.status).toBe(201);
    const id = m.data.event.id;
    await api.patch(`/events/${id}`, {
      questions: [{ id: 'q1', text: 'Why now?', answer: 'Funding round', asked: true }],
    });
    const state = (await api.get<AppState>('/state')).data;
    const ev = state.events.find((e) => e.id === id)!;
    expect((ev.data as { questions: unknown[] }).questions).toEqual([
      { id: 'q1', text: 'Why now?', answer: 'Funding round', asked: true },
    ]);
  });
});

describe('a job’s copy of a bank question', () => {
  it('follows the bank until it is reworded on the job, then is the job’s own', async () => {
    const api = await session();
    const a = (await api.post<Application>('/applications', { title: 'PM', company: 'Fco' })).data;
    const b = (await api.post<Application>('/applications', { title: 'PM', company: 'Gco' })).data;
    const q = (await api.post<Question>('/questions', { text: 'What would I own?' })).data;
    const ja = (
      await api.post<JobQuestion>(`/applications/${a.id}/questions`, { question_id: q.id })
    ).data;
    const jb = (
      await api.post<JobQuestion>(`/applications/${b.id}/questions`, { question_id: q.id })
    ).data;

    // Moving it keeps the link.
    const moved = (await api.patch<JobQuestion>(`/job-questions/${ja.id}`, { position: 5 })).data;
    expect(moved).toMatchObject({ question_id: q.id, position: 5 });
    // The same words again change nothing.
    expect(
      (await api.patch<JobQuestion>(`/job-questions/${ja.id}`, { text: q.text })).data.question_id,
    ).toBe(q.id);

    // The bank's new words reach both copies.
    await api.patch(`/questions/${q.id}`, { text: 'What would I own in the first year?' });
    let state = (await api.get<AppState>('/state')).data;
    expect(state.job_questions.filter((j) => j.question_id === q.id).map((j) => j.text)).toEqual([
      'What would I own in the first year?',
      'What would I own in the first year?',
    ]);

    // Reworded on job A: it's A's own now, and the bank stays as it was.
    const own = (
      await api.patch<JobQuestion>(`/job-questions/${ja.id}`, { text: 'What would I own day one?' })
    ).data;
    expect(own).toMatchObject({ question_id: null, text: 'What would I own day one?' });
    state = (await api.get<AppState>('/state')).data;
    expect(state.questions.find((x) => x.id === q.id)!.text).toBe(
      'What would I own in the first year?',
    );

    // The bank changes again: only B's copy follows.
    await api.patch(`/questions/${q.id}`, { text: 'What will I own?' });
    state = (await api.get<AppState>('/state')).data;
    expect(state.job_questions.find((j) => j.id === ja.id)!.text).toBe('What would I own day one?');
    expect(state.job_questions.find((j) => j.id === jb.id)).toMatchObject({
      text: 'What will I own?',
      question_id: q.id,
    });
  });
});

describe('saving a job story to the bank', () => {
  it('makes one bank story however many times it is pressed', async () => {
    const api = await session();
    const a = (await api.post<Application>('/applications', { title: 'PM', company: 'Sco' })).data;
    const js = (
      await api.post<{ id: string }>(`/applications/${a.id}/stories`, {
        framework_key: 'star',
        title: 'Only here',
      })
    ).data;
    const first = await api.post<{ story: { id: string } }>(`/job-stories/${js.id}/save-as-new`, {
      once: true,
    });
    const again = await api.post<{ story: { id: string } }>(`/job-stories/${js.id}/save-as-new`, {
      once: true,
    });
    expect(again.data.story.id).toBe(first.data.story.id);
    const state = (await api.get<AppState>('/state')).data;
    expect(state.stories.filter((s) => s.title === 'Only here')).toHaveLength(1);
  });
});
