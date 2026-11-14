// Adding and editing applications, changing status, people, and searches.
import { useState } from 'react';
import {
  OPEN_STATUSES,
  CLOSED_STATUSES,
  PERSON_ROLES,
  SALARY_PERIODS,
  SOURCES,
  WORK_MODES,
  isOpen,
  statusLabel,
  type PersonRole,
  type SalaryPeriod,
  type Status,
  type WorkMode,
} from '@shared/lookups';
import type { Application, Person, Search } from '@shared/types';
import { useActions, type Data } from '../lib/queries';
import { fromLocalInput, toLocalInput } from '../lib/format';
import {
  ChoiceInput,
  ConfirmButton,
  Field,
  Select,
  Sheet,
  SlideToggle,
  TagInput,
} from '../components/ui';
import { StatusChip } from '../components/StatusChip';
import { useSheets } from './context';
import { useNavigate } from 'react-router';

const num = (s: string) => {
  const v = Number(s.replace(/[^0-9.]/g, ''));
  return s.trim() === '' || !Number.isFinite(v) ? null : v;
};
const str = (n: number | null | undefined) => (n == null ? '' : String(n));

type Form = Record<
  | 'title'
  | 'company'
  | 'url'
  | 'source'
  | 'location'
  | 'seniority'
  | 'reports_to'
  | 'team'
  | 'employment_type'
  | 'salary_min'
  | 'salary_max'
  | 'salary_currency'
  | 'salary_text'
  | 'posted_on'
  | 'company_domain'
  | 'company_website'
  | 'company_linkedin'
  | 'company_hq'
  | 'company_size'
  | 'company_industry'
  | 'company_funding'
  | 'description'
  | 'notes',
  string
>;

function formOf(a?: Application): Form {
  return {
    title: a?.title ?? '',
    company: a?.company ?? '',
    url: a?.url ?? '',
    source: a?.source ?? '',
    location: a?.location ?? '',
    seniority: a?.seniority ?? '',
    reports_to: a?.reports_to ?? '',
    team: a?.team ?? '',
    employment_type: a?.employment_type ?? '',
    salary_min: str(a?.salary_min),
    salary_max: str(a?.salary_max),
    salary_currency: a?.salary_currency ?? 'USD',
    salary_text: a?.salary_text ?? '',
    posted_on: a?.posted_on ?? '',
    company_domain: a?.company_domain ?? '',
    company_website: a?.company_website ?? '',
    company_linkedin: a?.company_linkedin ?? '',
    company_hq: a?.company_hq ?? '',
    company_size: a?.company_size ?? '',
    company_industry: a?.company_industry ?? '',
    company_funding: a?.company_funding ?? '',
    description: a?.description ?? '',
    notes: a?.notes ?? '',
  };
}

export function ApplicationSheet({ data, id }: { data: Data; id?: string }) {
  const a = id ? data.appById.get(id) : undefined;
  const sheets = useSheets();
  const act = useActions();
  const nav = useNavigate();
  const [f, setF] = useState<Form>(() => formOf(a));
  const [mode, setMode] = useState<WorkMode | null>(a?.work_mode ?? null);
  const [period, setPeriod] = useState<SalaryPeriod>(a?.salary_period ?? 'year');
  const [must, setMust] = useState<string[]>(a?.must_haves ?? []);
  const [nice, setNice] = useState<string[]>(a?.nice_to_haves ?? []);
  const [status, setStatus] = useState<'saved' | 'applied'>('saved');
  const [company, setCompany] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const inp = (k: keyof Form, placeholder?: string, type = 'text') => (
    <input className="in" type={type} value={f[k]} onChange={set(k)} placeholder={placeholder} />
  );

  async function save() {
    if (!f.title.trim() || !f.company.trim()) return;
    setBusy(true);
    const body = {
      ...f,
      salary_min: num(f.salary_min),
      salary_max: num(f.salary_max),
      salary_period: num(f.salary_min) != null || num(f.salary_max) != null ? period : null,
      posted_on: f.posted_on || null,
      work_mode: mode,
      must_haves: must,
      nice_to_haves: nice,
    };
    const r = a
      ? await act.patch<Application>(`/applications/${a.id}`, body, 'Saved')
      : await act.post<Application>('/applications', { ...body, status }, 'Added');
    setBusy(false);
    if (!r) return;
    sheets.close();
    if (!a) nav(`/a/${r.id}`);
  }

  return (
    <Sheet
      title={a ? 'Edit application' : 'Add a job'}
      sub={
        a
          ? `${a.company} · ${a.title}`
          : 'Faster: paste the link to your assistant and it fills all of this in.'
      }
      onClose={sheets.close}
      footer={
        <>
          {a && (
            <ConfirmButton
              className="left"
              confirm="Delete it and its timeline?"
              onConfirm={async () => {
                if (await act.del(`/applications/${a.id}`, 'Deleted')) {
                  sheets.close();
                  nav('/pipeline');
                }
              }}
            >
              Delete
            </ConfirmButton>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={busy || !f.title.trim() || !f.company.trim()}
            onClick={save}
          >
            {a ? 'Save' : 'Save application'}
          </button>
        </>
      }
    >
      <Field label="Job link">{inp('url', 'https://…', 'url')}</Field>
      <div className="two">
        <Field label="Company">{inp('company', 'Fathom Systems')}</Field>
        <Field label="Title">{inp('title', 'Principal CRM Architect')}</Field>
      </div>
      {!a && (
        <Field label="Status">
          <SlideToggle
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              ['saved', 'Saved, not sent'],
              ['applied', 'Applied today'],
            ]}
          />
        </Field>
      )}
      <Field label="Pay">
        <div className="three">
          <input
            className="in"
            inputMode="numeric"
            value={f.salary_min}
            onChange={set('salary_min')}
            placeholder="Min"
            aria-label="Minimum"
          />
          <input
            className="in"
            inputMode="numeric"
            value={f.salary_max}
            onChange={set('salary_max')}
            placeholder="Max"
            aria-label="Maximum"
          />
          <Select
            value={period}
            onChange={(v) => setPeriod(v as SalaryPeriod)}
            groups={[{ options: SALARY_PERIODS.map((p) => ({ value: p, label: `per ${p}` })) }]}
          />
        </div>
      </Field>
      <Field label="Pay as written (optional)">
        {inp('salary_text', '$205k + 15% bonus + equity')}
      </Field>
      <Field label="Work mode">
        <SlideToggle
          label="Work mode"
          value={mode}
          onChange={setMode}
          allowClear
          options={WORK_MODES.map((w) => [w.key, w.label] as const)}
        />
      </Field>
      <div className="two">
        <Field label="Location">{inp('location', 'Remote (US)')}</Field>
        <Field label="Seniority">{inp('seniority', 'Principal IC')}</Field>
        <Field label="Reports to">{inp('reports_to', 'VP Revenue Ops')}</Field>
        <Field label="Team">{inp('team', '6 people')}</Field>
        <Field label="Type">{inp('employment_type', 'Full-time')}</Field>
        <Field label="Posted">{inp('posted_on', '', 'date')}</Field>
      </div>
      <Field label="Source">
        <ChoiceInput
          small
          options={SOURCES}
          value={f.source}
          onChange={(v) => setF((p) => ({ ...p, source: v }))}
        />
      </Field>
      <Field label="Must-haves">
        <TagInput
          value={must}
          onChange={setMust}
          suggestions={[]}
          placeholder="Add one, press Enter"
        />
      </Field>
      <Field label="Nice-to-haves">
        <TagInput
          value={nice}
          onChange={setNice}
          suggestions={[]}
          placeholder="Add one, press Enter"
        />
      </Field>
      <button
        type="button"
        className="btn ghost sm"
        onClick={() => setCompany((v) => !v)}
        aria-expanded={company}
      >
        {company ? 'Hide' : 'Show'} company details
      </button>
      {company && (
        <div className="two" style={{ marginTop: 12 }}>
          <Field label="Domain">{inp('company_domain', 'fathom.com')}</Field>
          <Field label="Website">{inp('company_website', 'https://…', 'url')}</Field>
          <Field label="LinkedIn">{inp('company_linkedin', 'https://…', 'url')}</Field>
          <Field label="HQ">{inp('company_hq', 'Denver, CO')}</Field>
          <Field label="Size">{inp('company_size', '501–1,000')}</Field>
          <Field label="Industry">{inp('company_industry', 'Logistics SaaS')}</Field>
          <Field label="Funding">{inp('company_funding', 'Series D')}</Field>
        </div>
      )}
      <Field label="Job description" className="mt">
        <textarea
          className="in"
          rows={6}
          value={f.description}
          onChange={set('description')}
          placeholder="Paste the posting: it disappears later."
        />
      </Field>
      <Field label="Notes">
        <textarea className="in" rows={3} value={f.notes} onChange={set('notes')} />
      </Field>
    </Sheet>
  );
}

const STATUS_CHOICES: Status[] = [...OPEN_STATUSES, 'accepted', ...CLOSED_STATUSES];

export function StatusSheet({ data, appId, to }: { data: Data; appId: string; to?: Status }) {
  const a = data.appById.get(appId);
  const sheets = useSheets();
  const act = useActions();
  const [next, setNext] = useState<Status | null>(to ?? null);
  const [when, setWhen] = useState(toLocalInput(new Date().toISOString()));
  const [reason, setReason] = useState('');
  const others = data.state.applications.filter(
    (x) => a && x.search_id === a.search_id && x.id !== a.id && isOpen(x.status),
  );
  const [decline, setDecline] = useState<string[]>(others.map((o) => o.id));
  const [busy, setBusy] = useState(false);
  if (!a) return null;

  async function save() {
    if (!next || !a) return;
    setBusy(true);
    const ok = await act.post(`/applications/${a.id}/status`, {
      status: next,
      occurred_at: fromLocalInput(when) ?? undefined,
      reason: reason || null,
    });
    if (ok && next === 'accepted')
      for (const id of decline)
        await act.post(`/applications/${id}/status`, {
          status: 'declined',
          reason: `Accepted ${a.company}`,
        });
    setBusy(false);
    if (ok) sheets.close();
  }

  return (
    <Sheet
      title="Change status"
      sub={
        <>
          {a.company} · now <StatusChip status={a.status} small />
        </>
      }
      onClose={sheets.close}
      footer={
        <button type="button" className="btn primary" disabled={!next || busy} onClick={save}>
          {next ? `Move to ${statusLabel(next)}` : 'Pick one'}
        </button>
      }
    >
      <div className="status-pick" role="radiogroup" aria-label="New status">
        {STATUS_CHOICES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={next === s}
            className="status-opt"
            onClick={() => setNext(s)}
            disabled={s === a.status}
          >
            <StatusChip status={s} />
          </button>
        ))}
      </div>
      <p className="hint">
        Every change is a status event on the timeline. Closing records the stage it closed from.
      </p>
      <div className="two" style={{ marginTop: 16 }}>
        <Field label="When">
          <input
            className="in"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Why (optional)">
        <textarea
          className="in"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="“Went with an internal candidate.”"
        />
      </Field>
      {next === 'accepted' && others.length > 0 && (
        <div className="callout">
          <strong>You’re in. Close the other doors?</strong>
          <p className="sub">These are still open in this search. Checked ones become Declined.</p>
          {others.map((o) => (
            <label key={o.id} className="check">
              <input
                type="checkbox"
                checked={decline.includes(o.id)}
                onChange={(e) =>
                  setDecline((d) => (e.target.checked ? [...d, o.id] : d.filter((x) => x !== o.id)))
                }
              />
              {o.company} · {o.title} <StatusChip status={o.status} small />
            </label>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export function PersonSheet({ data, appId, id }: { data: Data; appId: string; id?: string }) {
  const p: Person | undefined = data.state.people.find((x) => x.id === id);
  const sheets = useSheets();
  const act = useActions();
  const [name, setName] = useState(p?.name ?? '');
  const [email, setEmail] = useState(p?.email ?? '');
  const [title, setTitle] = useState(p?.title ?? '');
  const [role, setRole] = useState<PersonRole>(p?.role ?? 'recruiter');
  const [linkedin, setLinkedin] = useState(p?.linkedin ?? '');
  const [notes, setNotes] = useState(p?.notes ?? '');
  async function save() {
    const body = { name, email, title, role, linkedin, notes };
    const ok = p
      ? await act.patch(`/people/${p.id}`, body)
      : await act.post(`/applications/${appId}/people`, body);
    if (ok) sheets.close();
  }
  return (
    <Sheet
      title={p ? 'Edit person' : 'Add a person'}
      onClose={sheets.close}
      footer={
        <>
          {p && (
            <ConfirmButton
              className="left"
              confirm="Remove?"
              onConfirm={async () => (await act.del(`/people/${p.id}`)) && sheets.close()}
            >
              Remove
            </ConfirmButton>
          )}
          <button type="button" className="btn primary" disabled={!name.trim()} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="two">
        <Field label="Name">
          <input className="in" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Title">
          <input
            className="in"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="VP Revenue Ops"
          />
        </Field>
      </div>
      <Field label="Role">
        <SlideToggle
          label="Role"
          value={role}
          onChange={setRole}
          options={PERSON_ROLES.map((r) => [r.key, r.label] as const)}
        />
      </Field>
      <Field label="Email">
        <input
          className="in"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="LinkedIn">
        <input
          className="in"
          type="url"
          value={linkedin}
          onChange={(e) => setLinkedin(e.target.value)}
          placeholder="https://…"
        />
      </Field>
      <Field label="Notes">
        <textarea
          className="in"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
    </Sheet>
  );
}

export function SearchSheet({ data, id }: { data: Data; id?: string }) {
  const s: Search | undefined = data.state.searches.find((x) => x.id === id);
  const sheets = useSheets();
  const act = useActions();
  const [name, setName] = useState(s?.name ?? '');
  const [goal, setGoal] = useState(str(s?.weekly_goal ?? 10));
  const [status, setStatus] = useState<Search['status']>(s?.status ?? 'active');
  const [notes, setNotes] = useState(s?.notes ?? '');
  const count = data.state.applications.filter((a) => a.search_id === id).length;
  async function save() {
    const body = { name, weekly_goal: num(goal), status, notes };
    const ok = s ? await act.patch(`/searches/${s.id}`, body) : await act.post('/searches', body);
    if (ok) sheets.close();
  }
  return (
    <Sheet
      title={s ? 'Edit search' : 'Start a search'}
      sub={
        s ? `${count} applications` : 'A stretch of looking for work. New applications go into it.'
      }
      onClose={sheets.close}
      footer={
        <>
          {s && (
            <ConfirmButton
              className="left"
              confirm={`Delete it and ${count} applications?`}
              onConfirm={async () =>
                (await act.del(`/searches/${s.id}`, 'Deleted')) && sheets.close()
              }
            >
              Delete
            </ConfirmButton>
          )}
          {s && data.state.settings.current_search_id !== s.id && (
            <button
              type="button"
              className="btn"
              onClick={async () =>
                (await act.saveSettings({ current_search_id: s.id })) && sheets.close()
              }
            >
              Switch to it
            </button>
          )}
          <button type="button" className="btn primary" disabled={!name.trim()} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <Field label="Name">
        <input
          className="in"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Fall 2026"
        />
      </Field>
      <Field label="Weekly goal (applications)">
        <input
          className="in"
          inputMode="numeric"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
      </Field>
      {s && (
        <Field label="Status">
          <SlideToggle
            label="Search status"
            value={status}
            onChange={setStatus}
            options={[
              ['active', 'Active'],
              ['accepted', 'Accepted'],
              ['ended', 'Ended'],
            ]}
          />
        </Field>
      )}
      <Field label="Notes">
        <textarea
          className="in"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What you're looking for, your number, your walk-away."
        />
      </Field>
    </Sheet>
  );
}
