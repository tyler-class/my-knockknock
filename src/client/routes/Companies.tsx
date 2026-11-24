// Companies: each its own record, with the jobs you have there. A job looks its company up; the
// company's details (website, HQ, size…) and logo are kept and edited here, once, for every job
// at it.
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { Company } from '@shared/types';
import { useActions, useData, type Data } from '../lib/queries';
import { compLabel } from '../lib/format';
import { Icon } from '../components/Icon';
import { ComboEdit, LineEdit } from '../components/edit';
import { INDUSTRIES, OPEN_STATUSES, personRoleLabel } from '@shared/lookups';
import { useSheets } from '../sheets/context';
import { CompanyLogo } from '../components/CompanyLogo';
import { CompanyLogoEdit, LogoMark } from '../components/CompanyFields';
import { StatusChip } from '../components/StatusChip';
import { ConfirmButton, PageHeader } from '../components/ui';
import { companyFacts } from '../lib/company';
import { SearchBox, TrackerTabs } from './Directory';
import { useState } from 'react';
import { FilledFirst } from '../components/FilledFirst';

const jobsAt = (data: Data, id: string) =>
  data.state.applications.filter((a) => a.company_id === id);

/** "4 jobs · 2 active", or "3 active jobs" when every one is still open. */
function jobsLabel(all: number, active: number): string {
  if (all !== active) return `${all} ${all === 1 ? 'job' : 'jobs'} · ${active} active`;
  return `${all} active ${all === 1 ? 'job' : 'jobs'}`;
}

/** A website as a short address: "acme.com" for https://www.acme.com/. */
const shortSite = (url: string) =>
  url
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');

/** Every company, with how many jobs you have at each (across all rounds). */
export function Companies() {
  const data = useData();
  const [q, setQ] = useState('');
  if (!data) return null;
  const ql = q.trim().toLowerCase();
  const list = [...data.state.companies]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(
      (c) =>
        !ql ||
        [c.name, c.website, c.hq, c.industry].filter(Boolean).join(' ').toLowerCase().includes(ql),
    );
  return (
    <>
      <PageHeader title="Companies" icon="building" />
      <TrackerTabs />
      <SearchBox q={q} setQ={setQ} placeholder="Search companies" />
      <div className="card list">
        {list.map((c) => {
          const jobs = jobsAt(data, c.id);
          const active = jobs.filter((a) => OPEN_STATUSES.includes(a.status)).length;
          // Where and how big under the name; the website and industry as pills.
          const facts = companyFacts({ ...c, industry: null });
          return (
            <Link key={c.id} to={`/c/${c.id}`} className="prow co-row">
              <span className="co-mark">
                <CompanyLogo company={c} size={36} />
              </span>
              <span className="row-text">
                <strong>{c.name}</strong>
                {facts && <span className="sub ell">{facts}</span>}
                {(c.website || c.industry) && (
                  <span className="prow-pills">
                    {c.website && (
                      // Opens the site (in a new tab), not the company.
                      <span
                        role="link"
                        tabIndex={0}
                        className="pill co-site"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.currentTarget as HTMLElement).click();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          window.open(
                            /^[a-z]+:\/\//i.test(c.website!) ? c.website! : `https://${c.website}`,
                            '_blank',
                            'noopener,noreferrer',
                          );
                        }}
                      >
                        <Icon name="link" size={12} />
                        {shortSite(c.website)}
                      </span>
                    )}
                    {c.industry && <span className="pill">{c.industry}</span>}
                  </span>
                )}
              </span>
              <span className="pill">{jobsLabel(jobs.length, active)}</span>
            </Link>
          );
        })}
        {!list.length && (
          <p className="empty">
            {ql ? 'Nothing matches.' : 'No companies yet. Add a job and its company appears here.'}
          </p>
        )}
      </div>
    </>
  );
}

/** One company: its details and logo (edited in place), and the jobs you have there. */
export function CompanyPage() {
  const { id = '' } = useParams();
  const data = useData();
  const act = useActions();
  const sheets = useSheets();
  const nav = useNavigate();
  // Opened from a job (its Open company button): where the back link goes, and its name.
  const from = (useLocation().state as { from?: { href: string; label: string } } | null)?.from;
  if (!data) return null;
  const c = data.state.companies.find((x) => x.id === id);
  if (!c)
    return (
      <div className="empty">
        That company is gone. <Link to="/companies">Back to Companies</Link>
      </div>
    );
  const save = (field: keyof Company) => (v: string) =>
    act.patch(`/companies/${c.id}`, { [field]: v || null });
  const jobs = jobsAt(data, c.id);
  const people = data.state.people.filter((p) => p.company_id === c.id);
  return (
    <div className="app-page">
      <div className="crumbs">
        {/* Opened from a job: back to that job; otherwise to Companies. */}
        <Link className="linkish" to={from?.href ?? '/companies'}>
          ‹ {from?.label ?? 'Companies'}
        </Link>
      </div>
      <section className="card app-head co-head">
        <div className="co-head-top">
          <LogoMark company={c} />
          <div className="row-text">
            <span className="lbl co-kind">Company</span>
            <h1 className="title">{c.name}</h1>
            {companyFacts(c) && <p className="sub">{companyFacts(c)}</p>}
          </div>
          {!c.has_logo && <CompanyLogoEdit company={c} />}
        </div>
      </section>
      <div className="details">
        <div className="details-col">
          <section className="card">
            <div className="card-h">
              <h2 className="sec-title">
                <Icon name="building" size={18} /> Company Details
              </h2>
            </div>
            {/* One column: the details filled in, then Show more for the empty ones. */}
            <FilledFirst
              fields={[
                {
                  key: 'name',
                  filled: true,
                  el: (
                    <LineEdit
                      label="Company Name"
                      full
                      required
                      value={c.name}
                      onSave={save('name')}
                    />
                  ),
                },
                {
                  key: 'website',
                  filled: !!c.website,
                  el: (
                    <LineEdit
                      label="Website"
                      url
                      value={c.website ?? ''}
                      onSave={save('website')}
                    />
                  ),
                },
                {
                  key: 'linkedin',
                  filled: !!c.linkedin,
                  el: (
                    <LineEdit
                      label="LinkedIn"
                      url
                      value={c.linkedin ?? ''}
                      onSave={save('linkedin')}
                    />
                  ),
                },
                {
                  key: 'hq',
                  filled: !!c.hq,
                  el: <LineEdit label="Headquarters" value={c.hq ?? ''} onSave={save('hq')} />,
                },
                {
                  key: 'size',
                  filled: !!c.size,
                  el: <LineEdit label="Size" value={c.size ?? ''} onSave={save('size')} />,
                },
                {
                  key: 'industry',
                  filled: !!c.industry,
                  el: (
                    <ComboEdit
                      label="Industry"
                      value={c.industry ?? ''}
                      options={INDUSTRIES}
                      onSave={save('industry')}
                    />
                  ),
                },
                {
                  key: 'funding',
                  filled: !!c.funding,
                  el: <LineEdit label="Funding" value={c.funding ?? ''} onSave={save('funding')} />,
                },
              ]}
            />
          </section>
        </div>
        <div className="details-col">
          <section className="card">
            <div className="card-h">
              <h2 className="sec-title">
                <Icon name="briefcase" size={18} /> Jobs Here
              </h2>
              <span className="count">{jobs.length}</span>
            </div>
            {jobs.map((a) => (
              <Link key={a.id} to={`/a/${a.id}`} className="prow">
                <span className="row-text">
                  <strong>{a.title}</strong>
                  <span className="prow-pills">
                    <StatusChip status={a.status} small />
                    {compLabel(a) && <span className="pill">{compLabel(a)}</span>}
                    {data.state.rounds.length > 1 && (
                      <span className="pill">
                        {data.state.rounds.find((s) => s.id === a.round_id)?.name}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            ))}
            {!jobs.length && <p className="sub">No jobs here right now.</p>}
          </section>
          <section className="card">
            <div className="card-h">
              <h2 className="sec-title">
                <Icon name="user" size={18} /> People
              </h2>
              <button
                type="button"
                className="linkish"
                onClick={() => sheets.person(null, undefined, c.id)}
              >
                + Add
              </button>
            </div>
            {people.map((p) => (
              <button
                key={p.id}
                type="button"
                // An outlined card, like the jobs here.
                className="person prow dir-row"
                onClick={() => sheets.person(null, p.id, c.id)}
              >
                <span className="co-mark person-mark">
                  {p.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span className="row-text">
                  <strong>{p.name}</strong>
                  {(personRoleLabel(p) || p.title) && (
                    <span className="prow-pills">
                      {personRoleLabel(p) && <span className="pill">{personRoleLabel(p)}</span>}
                      {p.title && <span className="pill">{p.title}</span>}
                    </span>
                  )}
                </span>
              </button>
            ))}
            {!people.length && <p className="sub">No one yet.</p>}
          </section>
        </div>
      </div>
      {/* Deleting a company takes everything under it; the popup says how much. */}
      <div className="del-row">
        <ConfirmButton
          solid
          confirm={deleteQuestion(c.name, jobs.length, people.length)}
          onConfirm={async () => {
            if (await act.del(`/companies/${c.id}`, `Deleted ${c.name}`)) nav('/companies');
          }}
        >
          Delete company
        </ConfirmButton>
      </div>
    </div>
  );
}

/** "Delete Acme? This also deletes its 3 jobs (with their timelines) and 2 people." */
function deleteQuestion(name: string, jobs: number, people: number): string {
  const parts = [
    jobs ? `its ${jobs} ${jobs === 1 ? 'job' : 'jobs'} (with their timelines)` : null,
    people ? `${people} ${people === 1 ? 'person' : 'people'}` : null,
  ].filter(Boolean);
  return parts.length
    ? `Delete ${name}? This also deletes ${parts.join(' and ')}.`
    : `Delete ${name}?`;
}
