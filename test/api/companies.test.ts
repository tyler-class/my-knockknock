import { describe, expect, it } from 'vitest';
import type { AppState, Application, Company, Person } from '../../src/shared/types';
import { session } from './helpers';

describe('companies', () => {
  it('links jobs at the same company to one record, and keeps their copies in step', async () => {
    const api = await session();
    const one = (
      await api.post<Application>('/applications', {
        title: 'Staff Engineer',
        company: 'Northwind',
        company_domain: 'northwind.example',
        company_hq: 'Lisbon',
      })
    ).data;
    // The same name, any case: the same company; a new job fills only what it doesn't know yet.
    const two = (
      await api.post<Application>('/applications', {
        title: 'Principal Engineer',
        company: '  northwind ',
        company_hq: 'Porto',
        company_size: '1200',
      })
    ).data;
    expect(two.company_id).toBe(one.company_id);
    let state = (await api.get<AppState>('/state')).data;
    const co = state.companies.find((c) => c.id === one.company_id)!;
    expect(co).toMatchObject({
      name: 'Northwind',
      website: 'https://northwind.example',
      hq: 'Lisbon',
      size: '1200',
    });

    // A detail changed from either job is the company's, for both jobs.
    await api.patch(`/applications/${two.id}`, { company_industry: 'Logistics' });
    await api.patch(`/companies/${co.id}`, { hq: 'Madrid' });
    state = (await api.get<AppState>('/state')).data;
    for (const id of [one.id, two.id]) {
      const a = state.applications.find((x) => x.id === id)!;
      expect(a).toMatchObject({
        company: 'Northwind',
        company_industry: 'Logistics',
        company_hq: 'Madrid',
        company_domain: 'northwind.example',
      });
    }

    // Moving a job to another company (by name) makes that company; the first keeps its details.
    const moved = (await api.patch<Application>(`/applications/${two.id}`, { company: 'Contoso' }))
      .data;
    expect(moved.company_id).not.toBe(one.company_id);
    expect(moved.company_hq).toBeNull();
    // A job alone at its company: a new name corrects the company's name, details kept.
    await api.patch(`/applications/${two.id}`, { company_hq: 'Oslo' });
    const renamed = (
      await api.patch<Application>(`/applications/${two.id}`, { company: 'Contoso Ltd' })
    ).data;
    expect(renamed).toMatchObject({ company_id: moved.company_id, company_hq: 'Oslo' });

    // Linking back to an existing company by id.
    const back = await api.post<{ application: Application; company: Company }>(
      `/applications/${two.id}/company`,
      { company_id: one.company_id },
    );
    expect(back.data.application).toMatchObject({ company: 'Northwind', company_hq: 'Madrid' });
  });

  it('keeps a lane order you set, and clears it when a job changes lane', async () => {
    const api = await session();
    const ids: string[] = [];
    for (const t of ['A', 'B', 'C'])
      ids.push((await api.post<Application>('/applications', { title: t, company: t })).data.id);
    await api.post('/applications/board-order', { ids: [ids[2], ids[0], ids[1]] });
    let state = (await api.get<AppState>('/state')).data;
    const pos = (id: string) => state.applications.find((a) => a.id === id)!.board_position;
    expect([pos(ids[2]!), pos(ids[0]!), pos(ids[1]!)]).toEqual([0, 1, 2]);
    await api.post(`/applications/${ids[0]}/status`, { status: 'applied' });
    state = (await api.get<AppState>('/state')).data;
    expect(pos(ids[0]!)).toBeNull();
    expect(pos(ids[2]!)).toBe(0);
  });
});

describe('people at companies', () => {
  it('puts people at the job’s company, on several of its jobs, and keeps them when a job goes', async () => {
    const api = await session();
    const one = (await api.post<Application>('/applications', { title: 'PM', company: 'Globex' }))
      .data;
    const two = (
      await api.post<Application>('/applications', { title: 'PM II', company: 'Globex' })
    ).data;
    const priya = (
      await api.post<Person>(`/applications/${one.id}/people`, { name: 'Priya', role: 'recruiter' })
    ).data;
    expect(priya).toMatchObject({ company_id: one.company_id, application_ids: [one.id] });

    // The same person, added to another job at the company.
    const linked = (await api.post<Person>(`/applications/${two.id}/people/${priya.id}`, {})).data;
    expect(linked.application_ids.sort()).toEqual([one.id, two.id].sort());

    // Deleting the first job keeps her (still on the second).
    await api.del(`/applications/${one.id}`);
    let state = (await api.get<AppState>('/state')).data;
    expect(state.people.find((p) => p.id === priya.id)?.application_ids).toEqual([two.id]);

    // Off her last job: still at the company.
    await api.del(`/applications/${two.id}/people/${priya.id}`);
    state = (await api.get<AppState>('/state')).data;
    expect(state.people.find((p) => p.id === priya.id)).toMatchObject({
      company_id: one.company_id,
      application_ids: [],
    });

    // Someone added at the company itself, on no job yet; a job can then pick them.
    const sam = (
      await api.post<Person>(`/companies/${one.company_id}/people`, { name: 'Sam', role: 'other' })
    ).data;
    expect(sam).toMatchObject({
      company_id: one.company_id,
      application_id: null,
      application_ids: [],
    });
    const onJob = (await api.post<Person>(`/applications/${two.id}/people/${sam.id}`, {})).data;
    expect(onJob.application_ids).toEqual([two.id]);
    // Deleting that job leaves them at the company.
    await api.del(`/applications/${two.id}`);
    state = (await api.get<AppState>('/state')).data;
    expect(state.people.find((p) => p.id === sam.id)?.company_id).toBe(one.company_id);
  });
});
