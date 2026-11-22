import type { Application, EventData, TimelineEvent } from '@shared/types';
import type { EventType, Status } from '@shared/lookups';

let n = 0;
export function ev(
  type: EventType,
  occurred_at: string,
  data: Partial<EventData> | Record<string, unknown> = {},
  extra: Partial<TimelineEvent> = {},
): TimelineEvent {
  n++;
  return {
    id: `e${n}`,
    application_id: 'a1',
    type,
    occurred_at,
    title: null,
    body: null,
    source: 'manual',
    source_name: null,
    external_ref: null,
    parent_id: null,
    data: data as EventData,
    created_at: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

export const st = (
  to: Status,
  at: string,
  from: Status | null = null,
  extra: Partial<TimelineEvent> = {},
) => ev('status', at, { from, to, reason: null, caused_by: null }, extra);
export const created = (to: Status, at: string, extra: Partial<TimelineEvent> = {}) =>
  ev('created', at, { from: null, to, reason: null, caused_by: null }, extra);

export function app(o: Partial<Application> = {}): Application {
  return {
    id: 'a1',
    search_id: 's1',
    status: 'saved',
    closed_from: null,
    title: 'Principal CRM Architect',
    company: 'Fathom',
    company_domain: null,
    company_website: null,
    company_linkedin: null,
    company_hq: null,
    company_size: null,
    company_industry: null,
    company_funding: null,
    url: null,
    source: null,
    location: null,
    work_mode: null,
    seniority: null,
    reports_to: null,
    team: null,
    employment_type: null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    salary_text: null,
    posted_on: null,
    description: null,
    must_haves: [],
    nice_to_haves: [],
    inferred: [],
    applied_on: null,
    resume_file_id: null,
    notes: null,
    created_at: '2026-10-01T12:00:00.000Z',
    updated_at: '2026-10-01T12:00:00.000Z',
    last_activity_at: '2026-10-01T12:00:00.000Z',
    board_position: null,
    company_id: null,
    ...o,
  };
}
