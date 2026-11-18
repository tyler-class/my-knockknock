import { describe, expect, it } from 'vitest';
import type { AppState, Application, JobStory, Story } from '../../src/shared/types';
import { syncState } from '../../src/shared/logic/stories';
import { session } from './helpers';

describe('story bank and job copies', () => {
  it('a story is just its parts: no questions are added for it', async () => {
    const api = await session();
    const intro = (
      await api.post<Story>('/stories', {
        framework_key: 'intro',
        title: 'My intro',
        sections: { present: 'I build CRMs.' },
      })
    ).data;
    expect(intro.sections).toEqual({ present: 'I build CRMs.' });
    expect(intro.questions).toEqual([]);
  });

  it('copies on link, tracks edits and versions, pushes, pulls and saves as new', async () => {
    const api = await session();
    const s = (
      await api.post<Story>('/stories', {
        framework_key: 'star',
        title: 'Event bus for 14 integrations',
        sections: {
          situation: 'Fourteen brittle integrations.',
          action: 'One bus.',
          result: 'Sev-1s to zero.',
          bogus: 'dropped',
        },
      })
    ).data;
    expect(s.version).toBe(1);
    expect(Object.keys(s.sections).sort()).toEqual(['action', 'result', 'situation']);
    const a = (
      await api.post<Application>('/applications', { title: 'Architect', company: 'Fathom' })
    ).data;

    const js = (
      await api.post<JobStory>(`/applications/${a.id}/stories`, {
        story_id: s.id,
        angle: 'For Owen',
      })
    ).data;
    expect(js).toMatchObject({
      story_id: s.id,
      source_version: 1,
      angle: 'For Owen',
      title: s.title,
    });
    expect(syncState(js, s)).toBe('in_sync');
    expect((await api.post(`/applications/${a.id}/stories`, { story_id: s.id })).status).toBe(409);

    // Edit the copy: the bank doesn't change.
    const edited = (
      await api.patch<JobStory>(`/job-stories/${js.id}`, {
        sections: { ...js.sections, result: 'Sev-1s to zero in two quarters.' },
      })
    ).data;
    const bank1 = (await api.get<AppState>('/state')).data.stories.find((x) => x.id === s.id)!;
    expect(syncState(edited, bank1)).toBe('edited');
    expect(bank1.sections.result).toBe('Sev-1s to zero.');

    // Edit the bank: version goes up; saving it unchanged doesn't.
    const bank2 = (await api.patch<Story>(`/stories/${s.id}`, { title: 'Fourteen to one' })).data;
    expect(bank2.version).toBe(2);
    expect(
      (await api.patch<Story>(`/stories/${s.id}`, { title: 'Fourteen to one' })).data.version,
    ).toBe(2);
    expect(syncState(edited, bank2)).toBe('both');

    // Push: the bank takes the copy's content as v3; the copy is in sync.
    const pushed = (
      await api.post<{ job_story: JobStory; story: Story }>(`/job-stories/${js.id}/push`)
    ).data;
    expect(pushed.story).toMatchObject({ version: 3, title: s.title });
    expect(pushed.story.sections.result).toBe('Sev-1s to zero in two quarters.');
    expect(syncState(pushed.job_story, pushed.story)).toBe('in_sync');

    // A second job's copy, then the bank changes: pull brings it up to date, angle kept.
    const b = (
      await api.post<Application>('/applications', { title: 'Architect', company: 'Quarry' })
    ).data;
    const js2 = (
      await api.post<JobStory>(`/applications/${b.id}/stories`, {
        story_id: s.id,
        angle: 'Keep me',
      })
    ).data;
    const bank4 = (
      await api.patch<Story>(`/stories/${s.id}`, { title: 'Event bus, 14 integrations' })
    ).data;
    expect(syncState(js2, bank4)).toBe('bank_newer');
    const pulled = (await api.post<{ job_story: JobStory }>(`/job-stories/${js2.id}/pull`)).data
      .job_story;
    expect(pulled).toMatchObject({
      title: 'Event bus, 14 integrations',
      angle: 'Keep me',
      source_version: 4,
    });

    // Save a copy as a new bank story.
    const forked = (
      await api.post<{ job_story: JobStory; story: Story }>(`/job-stories/${js2.id}/save-as-new`)
    ).data;
    expect(forked.story.id).not.toBe(s.id);
    expect(forked.job_story.story_id).toBe(forked.story.id);

    // Stories aren't marked as told any more: the route is gone.
    const tell = await api.post(`/job-stories/${js2.id}/tells`, { heard_by: ['Dana'] });
    expect(tell.status).toBe(404);

    // Deleting the bank story keeps the copies.
    await api.del(`/stories/${s.id}`);
    const state = (await api.get<AppState>('/state')).data;
    const kept = state.job_stories.find((x) => x.id === js.id)!;
    expect(kept.story_id).toBeNull();
    expect(syncState(kept, undefined)).toBe('source_gone');
  });

  it('switches frameworks without losing text, and supports custom frameworks', async () => {
    const api = await session();
    const s = (
      await api.post<Story>('/stories', {
        framework_key: 'star',
        title: 'Switch me',
        sections: { situation: 'Ctx', task: 'Mine', action: 'Did', result: 'Won' },
      })
    ).data;
    const car = (await api.patch<Story>(`/stories/${s.id}`, { framework_key: 'car' })).data;
    expect(car.sections).toEqual({ action: 'Did', result: 'Won' });
    expect(car.notes).toContain('Situation: Ctx');

    const fw = await api.post<{ key: string; sections: { key: string }[] }>('/frameworks', {
      name: 'PAR',
      sections: [
        { key: 'problem', label: 'Problem' },
        { key: 'action', label: 'Action' },
        { key: 'result', label: 'Result' },
      ],
    });
    expect(fw.status).toBe(201);
    const frameworks = (await api.get<AppState>('/state')).data.frameworks;
    expect(frameworks.map((f) => f.key)).toEqual(
      expect.arrayContaining(['star', 'intro', 'why_job', fw.data.key]),
    );
    const par = (
      await api.post<Story>('/stories', {
        framework_key: fw.data.key,
        title: 'PAR one',
        sections: { problem: 'P' },
      })
    ).data;
    expect(par.sections).toEqual({ problem: 'P' });
    expect((await api.del(`/frameworks/${fw.data.key}`)).status).toBe(409);
    expect((await api.patch('/frameworks/star', { name: 'Mine' })).status).toBe(409);
    expect((await api.post('/stories', { framework_key: 'nope', title: 'x' })).status).toBe(400);
  });
});
