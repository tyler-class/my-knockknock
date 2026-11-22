import { describe, expect, it } from 'vitest';
import type { AppState, Application, Person, TimelineEvent } from '../../src/shared/types';
import { session } from './helpers';

interface Written {
  event: TimelineEvent | null;
  application: Application;
  nearby: TimelineEvent[];
}

describe('applications and their timelines', () => {
  it('creates in a first search, moves through statuses as events, and closes from a stage', async () => {
    const api = await session();
    const created = await api.post<Application>('/applications', {
      title: 'Principal CRM Architect',
      company: 'Fathom',
      url: 'https://jobs.example.com/fathom/123?utm_source=linkedin',
      salary_min: 215000,
      salary_max: 250000,
      must_haves: ['Apex', 'CPQ', 'Apex'],
      inferred: ['seniority'],
      seniority: 'Principal',
    });
    expect(created.status).toBe(201);
    const a = created.data;
    expect(a).toMatchObject({
      status: 'saved',
      must_haves: ['Apex', 'CPQ'],
      inferred: ['seniority'],
    });
    const state = (await api.get<AppState>('/state')).data;
    expect(state.searches.length).toBeGreaterThanOrEqual(1);
    expect(state.settings.current_search_id).toBe(a.search_id);
    expect(state.events.filter((e) => e.application_id === a.id).map((e) => e.type)).toEqual([
      'created',
    ]);

    // Same posting, tracking parameters ignored.
    const found = await api.get<{ applications: Application[] }>(
      `/applications?url=${encodeURIComponent('https://jobs.example.com/fathom/123')}`,
    );
    expect(found.data.applications.map((x) => x.id)).toEqual([a.id]);

    const applied = await api.post<Written>(`/applications/${a.id}/status`, {
      status: 'applied',
      occurred_at: '2026-10-14T15:00:00Z',
    });
    expect(applied.status).toBe(201);
    expect(applied.data.application).toMatchObject({ status: 'applied', applied_on: '2026-10-14' });
    expect(applied.data.event!.data).toMatchObject({ from: 'saved', to: 'applied' });

    // Unchanged status writes nothing.
    const again = await api.post<Written>(`/applications/${a.id}/status`, { status: 'applied' });
    expect(again.data.event).toBeNull();

    const screen = await api.post<Written>(`/applications/${a.id}/status`, {
      status: 'screening',
      occurred_at: '2026-10-19T15:00:00Z',
    });
    // Backfilled before the screening: lands in order, doesn't change the current status.
    const late = await api.post<Written>(`/applications/${a.id}/status`, {
      status: 'rejected',
      occurred_at: '2026-10-25T15:00:00Z',
      reason: 'Internal hire',
    });
    expect(late.data.application).toMatchObject({ status: 'rejected', closed_from: 'screening' });
    expect(late.data.nearby).toEqual([]);

    // Deleting the rejection recomputes.
    const del = await api.del<Written>(`/events/${late.data.event!.id}`);
    expect(del.data.application.status).toBe('screening');
    // The created event stays.
    const createdEvent = (
      await api.get<{ events: TimelineEvent[] }>(`/applications/${a.id}/timeline?types=created`)
    ).data.events[0]!;
    expect((await api.del(`/events/${createdEvent.id}`)).status).toBe(409);
    expect(screen.status).toBe(201);
  });

  it('logs meetings, emails and notes, refuses a repeated external_ref, and answers with what is nearby', async () => {
    const api = await session();
    const a = (
      await api.post<Application>('/applications', {
        title: 'Sr. Manager, RevOps',
        company: 'Copperleaf',
        status: 'applied',
      })
    ).data;
    const email = await api.post<Written>(`/applications/${a.id}/emails`, {
      direction: 'in',
      occurred_at: '2026-11-08T16:02:00Z',
      category: 'scheduling',
      subject: 'Panel confirmed',
      body: 'Dana confirmed a panel for Thursday.',
      counterpart_name: 'Dana Ruiz',
      key_points: ['90 minutes', 'Design exercise'],
      external_ref: 'gmail:abc123',
    });
    expect(email.status).toBe(201);
    expect(email.data.event).toMatchObject({
      type: 'email',
      title: 'Panel confirmed',
      source: 'manual',
      external_ref: 'gmail:abc123',
    });

    const dup = await api.post<{ error: string; details: { event_id: string } }>(
      `/applications/${a.id}/emails`,
      {
        direction: 'in',
        occurred_at: '2026-11-08T16:02:00Z',
        category: 'scheduling',
        external_ref: 'gmail:abc123',
      },
    );
    expect(dup.status).toBe(409);
    expect(dup.data).toMatchObject({
      error: 'duplicate',
      details: { event_id: email.data.event!.id },
    });

    const meeting = await api.post<Written>(`/applications/${a.id}/meetings`, {
      title: 'Panel interview',
      occurred_at: '2099-11-14T19:00:00Z',
      ends_at: '2099-11-14T20:30:00Z',
      kind: 'panel',
      join_url: 'https://zoom.us/j/1',
      attendees: [{ name: 'Priya Shah', title: 'VP RevOps' }],
    });
    expect(meeting.data.event!.data).toMatchObject({
      kind: 'panel',
      state: 'scheduled',
      attendees: [{ name: 'Priya Shah', title: 'VP RevOps', email: null }],
    });

    // A note under the meeting, then edits.
    const note = await api.post<Written>(`/applications/${a.id}/notes`, {
      body: 'Bring the event-bus story.',
      parent_id: meeting.data.event!.id,
    });
    expect(note.data.event!.parent_id).toBe(meeting.data.event!.id);
    const moved = await api.patch<Written>(`/events/${meeting.data.event!.id}`, {
      occurred_at: '2099-11-15T19:00:00Z',
      state: 'held',
    });
    expect(moved.data.event).toMatchObject({
      occurred_at: '2099-11-15T19:00:00.000Z',
      data: { state: 'held', kind: 'panel' },
    });

    // Around a date: only what's close.
    const near = await api.get<{ events: TimelineEvent[] }>(
      `/applications/${a.id}/timeline?around=2026-11-09&days=2&types=email`,
    );
    expect(near.data.events.map((e) => e.id)).toEqual([email.data.event!.id]);

    // Status caused by the email.
    const s = await api.post<Written>(`/applications/${a.id}/status`, {
      status: 'interviewing',
      caused_by: email.data.event!.id,
    });
    expect(s.data.event!.data).toMatchObject({
      caused_by: email.data.event!.id,
      to: 'interviewing',
    });
    const bad = await api.post(`/applications/${a.id}/status`, {
      status: 'offer',
      caused_by: 'nope',
    });
    expect(bad.status).toBe(400);
  });

  it('accepting closes the search only when asked, and lists the other open applications', async () => {
    const api = await session();
    const search = (await api.post<{ id: string }>('/searches', { name: 'Accept test' })).data;
    const one = (
      await api.post<Application>('/applications', {
        title: 'A',
        company: 'One',
        status: 'applied',
        search_id: search.id,
      })
    ).data;
    const two = (
      await api.post<Application>('/applications', {
        title: 'B',
        company: 'Two',
        status: 'applied',
        search_id: search.id,
      })
    ).data;
    await api.post(`/applications/${one.id}/status`, { status: 'accepted' });
    let state = (await api.get<AppState>('/state')).data;
    expect(state.searches.find((s) => s.id === search.id)).toMatchObject({ status: 'active' });
    // The owner said yes: mark the search Accepted too (already Accepted, so no new event).
    await api.post(`/applications/${one.id}/status`, { status: 'accepted', close_search: true });
    state = (await api.get<AppState>('/state')).data;
    expect(state.searches.find((s) => s.id === search.id)).toMatchObject({ status: 'accepted' });
    const others = await api.get<{ applications: Application[] }>(
      `/applications/${one.id}/others-open`,
    );
    expect(others.data.applications.map((x) => x.id)).toEqual([two.id]);
  });

  it('people, search by email, and deleting an application', async () => {
    const api = await session();
    const a = (
      await api.post<Application>('/applications', { title: 'Lead', company: 'Northwind Labs' })
    ).data;
    const p = await api.post<{ id: string }>(`/applications/${a.id}/people`, {
      name: 'Dana Ruiz',
      email: 'dana@northwind.example',
      role: 'recruiter',
    });
    expect(p.status).toBe(201);
    // "Other" carries the role in their own words; another role clears it.
    const o = await api.post<Person>(`/applications/${a.id}/people`, {
      name: 'Sam Lee',
      role: 'other',
      other_role: 'Head of Talent',
    });
    expect(o.data.other_role).toBe('Head of Talent');
    const r = await api.patch<Person>(`/people/${o.data.id}`, { role: 'interviewer' });
    expect(r.data.other_role).toBeNull();
    const hit = await api.get<{ applications: Application[] }>(
      '/applications?q=dana%40northwind.example',
    );
    expect(hit.data.applications.map((x) => x.id)).toEqual([a.id]);
    expect((await api.del(`/applications/${a.id}`)).status).toBe(200);
    const state = (await api.get<AppState>('/state')).data;
    // They work at the company, so they stay there (on no job now).
    expect(state.people.find((x) => x.id === p.data.id)).toMatchObject({ application_ids: [] });
  });
});
