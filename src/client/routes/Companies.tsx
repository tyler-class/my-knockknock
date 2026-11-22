// Companies: each its own record, with the jobs you have there. A job looks its company up; the
// company's details (website, HQ, size…) and logo are kept and edited here, once, for every job
// at it.
import { Link, useParams } from 'react-router';
import type { Company } from '@shared/types';
import { useActions, useData, type Data } from '../lib/queries';
import { compLabel } from '../lib/format';
import { Icon } from '../components/Icon';
import { ComboEdit, LineEdit } from '../components/edit';
import { INDUSTRIES, personRoleLabel } from '@shared/lookups';
import { useSheets } from '../sheets/context';
import { CompanyLogo } from '../components/CompanyLogo';
import { CompanyLogoEdit, LogoMark } from '../components/CompanyFields';
import { StatusChip } from '../components/StatusChip';
import { PageHeader } from '../components/ui';
import { companyFacts } from '../lib/company';

const jobsAt = (data: Data, id: string) =>
  data.state.applications.filter((a) => a.company_id === id);

/** Every company, with how many jobs you have at each (across all searches). */
export function Companies() {
  const data = useData();
  if (!data) return null;
  const list = [...data.state.companies].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PageHeader title="Companies" icon="building" />
      <div className="card list">
        {list.map((c) => {
          const n = jobsAt(data, c.id).length;
          const facts = companyFacts(c);
          return (
            <Link key={c.id} to={`/c/${c.id}`} className="prow co-row">
              <span className="co-mark">
                <CompanyLogo company={c} size={36} />
              </span>
              <span className="row-text">
                <strong>{c.name}</strong>
                {facts && <span className="sub ell">{facts}</span>}
              </span>
              <span className="pill">
                {n} {n === 1 ? 'job' : 'jobs'}
              </span>
            </Link>
          );
        })}
        {!list.length && (
          <p className="empty">No companies yet. Add a job and its company appears here.</p>
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
        <Link className="linkish" to="/companies">
          ‹ Companies
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
            <div className="kvs">
              <LineEdit label="Company Name" full required value={c.name} onSave={save('name')} />
              <LineEdit label="Website" url value={c.website ?? ''} onSave={save('website')} />
              <LineEdit label="LinkedIn" url value={c.linkedin ?? ''} onSave={save('linkedin')} />
              <LineEdit label="Headquarters" value={c.hq ?? ''} onSave={save('hq')} />
              <LineEdit label="Size" value={c.size ?? ''} onSave={save('size')} />
              <ComboEdit
                label="Industry"
                value={c.industry ?? ''}
                options={INDUSTRIES}
                onSave={save('industry')}
              />
              <LineEdit label="Funding" value={c.funding ?? ''} onSave={save('funding')} />
            </div>
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
                    {data.state.searches.length > 1 && (
                      <span className="pill">
                        {data.state.searches.find((s) => s.id === a.search_id)?.name}
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
                className="person"
                onClick={() => sheets.person(null, p.id, c.id)}
              >
                <span className="avatar">
                  {p.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span className="row-text">
                  <strong>{p.name}</strong>
                  <span className="sub">
                    {[
                      personRoleLabel(p),
                      p.title,
                      ...p.application_ids.map((id) => data.appById.get(id)?.title),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </button>
            ))}
            {!people.length && <p className="sub">No one yet.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
