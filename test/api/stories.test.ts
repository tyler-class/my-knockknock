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

  it('copies on link; unchanged copies follow the bank, an edited one becomes the job’s own', async () => {
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
    const b = (
      await api.post<Application>('/applications', { title: 'Architect', company: 'Quarry' })
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
    const js2 = (
      await api.post<JobStory>(`/applications/${b.id}/stories`, {
        story_id: s.id,
        angle: 'Keep me',
      })
    ).data;

    // The angle and the order are the job's own: changing them keeps the link.
    const angled = (
      await api.patch<JobStory>(`/job-stories/${js.id}`, { angle: 'For Leah', position: 3 })
    ).data;
    expect(angled).toMatchObject({ story_id: s.id, angle: 'For Leah', position: 3 });

    // Edit the bank: version goes up (saving it unchanged doesn't), and the linked copies follow,
    // each keeping its angle and place.
    const bank2 = (await api.patch<Story>(`/stories/${s.id}`, { title: 'Fourteen to one' })).data;
    expect(bank2.version).toBe(2);
    expect(
      (await api.patch<Story>(`/stories/${s.id}`, { title: 'Fourteen to one' })).data.version,
    ).toBe(2);
    let state = (await api.get<AppState>('/state')).data;
    const followed = state.job_stories.find((x) => x.id === js.id)!;
    expect(followed).toMatchObject({
      title: 'Fourteen to one',
      source_version: 2,
      angle: 'For Leah',
      position: 3,
      story_id: s.id,
    });
    expect(syncState(followed, bank2)).toBe('in_sync');

    // Edit the copy's content: it becomes this job's own, and the bank doesn't change.
    const edited = (
      await api.patch<JobStory>(`/job-stories/${js.id}`, {
        sections: { ...followed.sections, result: 'Sev-1s to zero in two quarters.' },
      })
    ).data;
    expect(edited).toMatchObject({ story_id: null, source_version: null, angle: 'For Leah' });
    expect(edited.sections.result).toBe('Sev-1s to zero in two quarters.');
    expect(syncState(edited, undefined)).toBe('job_only');
    state = (await api.get<AppState>('/state')).data;
    const bank3 = state.stories.find((x) => x.id === s.id)!;
    expect(bank3).toMatchObject({ version: 2 });
    expect(bank3.sections.result).toBe('Sev-1s to zero.');

    // The bank changes again: the detached copy keeps its words; the other job's follows.
    await api.patch<Story>(`/stories/${s.id}`, { title: 'Event bus, 14 integrations' });
    state = (await api.get<AppState>('/state')).data;
    expect(state.job_stories.find((x) => x.id === js.id)!.title).toBe('Fourteen to one');
    expect(state.job_stories.find((x) => x.id === js2.id)).toMatchObject({
      title: 'Event bus, 14 integrations',
      angle: 'Keep me',
      source_version: 3,
    });

    // Push and pull are gone: a linked copy is always the bank's words.
    expect((await api.post(`/job-stories/${js2.id}/push`)).status).toBe(404);
    expect((await api.post(`/job-stories/${js2.id}/pull`)).status).toBe(404);

    // Save the job's own story to the bank: a new bank story, linked.
    const forked = (
      await api.post<{ job_story: JobStory; story: Story }>(`/job-stories/${js.id}/save-as-new`, {
        once: true,
      })
    ).data;
    expect(forked.story.id).not.toBe(s.id);
    expect(forked.job_story.story_id).toBe(forked.story.id);
    expect(forked.story.sections.result).toBe('Sev-1s to zero in two quarters.');

    // Stories aren't marked as told any more: the route is gone.
    const tell = await api.post(`/job-stories/${js2.id}/tells`, { heard_by: ['Dana'] });
    expect(tell.status).toBe(404);

    // Deleting the bank story keeps the copies, as the job's own.
    await api.del(`/stories/${s.id}`);
    state = (await api.get<AppState>('/state')).data;
    const kept = state.job_stories.find((x) => x.id === js2.id)!;
    expect(kept.story_id).toBeNull();
    expect(kept.title).toBe('Event bus, 14 integrations');
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
