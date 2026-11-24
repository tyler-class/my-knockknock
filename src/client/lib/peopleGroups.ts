// People to pick from when linking someone to a job, a meeting or an email: everyone you have,
// in groups: at the job's company, on the job, then everyone else (a third-party recruiter, say).
import type { Person } from '@shared/types';
import type { Data } from './queries';

export interface PeopleGroup {
  label: string;
  people: Person[];
}

export function groupPeople(
  data: Data,
  appId: string | null,
  q: string,
  /** People not to offer (already on the job, or already in the meeting). */
  skip: (p: Person) => boolean = () => false,
): PeopleGroup[] {
  const app = appId ? data.appById.get(appId) : undefined;
  const ql = q.trim().toLowerCase();
  const company = data.state.companies.find((c) => c.id === app?.company_id);
  const coName = (id: string | null) => data.state.companies.find((c) => c.id === id)?.name ?? '';
  const pool = data.state.people
    .filter((p) => !skip(p))
    .filter(
      (p) =>
        !ql ||
        `${p.name} ${p.title ?? ''} ${p.email ?? ''} ${coName(p.company_id)}`
          .toLowerCase()
          .includes(ql),
    )
    .sort((x, y) => x.name.localeCompare(y.name));
  const onJob = (p: Person) => !!appId && p.application_ids.includes(appId);
  const atCompany = (p: Person) => !!company && p.company_id === company.id && !onJob(p);
  const groups: PeopleGroup[] = [
    {
      label: `At ${company?.name ?? app?.company ?? 'this company'}`,
      people: pool.filter(atCompany),
    },
    { label: 'On this job', people: pool.filter(onJob) },
    { label: 'All people', people: pool.filter((p) => !onJob(p) && !atCompany(p)) },
  ];
  return groups.filter((g) => g.people.length > 0);
}
