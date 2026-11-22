import { describe, expect, it, vi } from 'vitest';
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

  it('keeps a monogram color from the palette, and null puts it back to ultramarine', async () => {
    const api = await session();
    const co = (await api.post<Company>('/companies', { name: 'The Copperleaf Group' })).data;
    expect(co.logo_color).toBeNull();
    const teal = await api.patch<Company>(`/companies/${co.id}`, { logo_color: 'teal' });
    expect(teal.data.logo_color).toBe('teal');
    const bad = await api.patch(`/companies/${co.id}`, { logo_color: '#ff00ff' });
    expect(bad.status).toBe(400);
    const back = await api.patch<Company>(`/companies/${co.id}`, { logo_color: null });
    expect(back.data.logo_color).toBeNull();
  });

  it('fetches a logo from an image address, checking it really is an image', async () => {
    const api = await session();
    const co = (await api.post<Company>('/companies', { name: 'Wombat Works' })).data;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const u = String(input instanceof Request ? input.url : input);
      if (u.endsWith('/logo.png'))
        return new Response(png, { headers: { 'Content-Type': 'application/octet-stream' } });
      if (u.endsWith('/about'))
        return new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } });
      return new Response('nope', { status: 404 });
    });
    try {
      const ok = await api.post<Company>(`/companies/${co.id}/logo-from-url`, {
        url: 'https://wombat.example/logo.png',
      });
      expect(ok.status).toBe(200);
      expect(ok.data.has_logo).toBe(true);
      const page = await api.post<{ message: string }>(`/companies/${co.id}/logo-from-url`, {
        url: 'https://wombat.example/about',
      });
      expect(page.status).toBe(400);
      expect(page.data.message).toMatch(/web page, not an image/);
      const missing = await api.post<{ message: string }>(`/companies/${co.id}/logo-from-url`, {
        url: 'https://wombat.example/missing.png',
      });
      expect(missing.data.message).toMatch(/answered 404/);
      const ftp = await api.post(`/companies/${co.id}/logo-from-url`, {
        url: 'ftp://x.example/a.png',
      });
      expect(ftp.status).toBe(400);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('deleting a company', () => {
  it('deletes its jobs and its people with it', async () => {
    const api = await session();
    const job = (await api.post<Application>('/applications', { title: 'X', company: 'Initech' }))
      .data;
    await api.post(`/applications/${job.id}/people`, { name: 'Bill', role: 'other' });
    expect((await api.del(`/companies/${job.company_id}`)).status).toBe(200);
    const state = (await api.get<AppState>('/state')).data;
    expect(state.companies.some((c) => c.id === job.company_id)).toBe(false);
    expect(state.applications.some((a) => a.id === job.id)).toBe(false);
    expect(state.people.some((p) => p.name === 'Bill')).toBe(false);
  });
});
