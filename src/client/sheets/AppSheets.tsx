// Adding and editing applications, changing status, people, and rounds.
import { useState } from 'react';
import { burst } from '../components/Brand';
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
  EMPLOYMENT_TYPES,
  personRoleLabel,
} from '@shared/lookups';
import type { Application, Company, Person, Round, TimelineEvent } from '@shared/types';
import { api, uploadFile } from '../lib/api';
import { useActions, useData, type Data } from '../lib/queries';
import { CompanyChooser, type NewCompany } from '../components/CompanyFields';
import { useToast } from '../components/Toast';
import { fromLocalInput, toLocalInput } from '../lib/format';
import {
  AutoTextarea,
  ConfirmButton,
  Field,
  Select,
  Sheet,
  SlideToggle,
  TagInput,
  SearchClear,
  cx,
} from '../components/ui';
import { StatusChip, StatusIcon } from '../components/StatusChip';
import { StageBar } from '../components/StageBar';
import { DateTimeField } from '../components/DateTimePicker';
import { useSheets } from './context';
import { Icon } from '../components/Icon';
import { useNavigate } from 'react-router';
import { payRange } from '@shared/logic/pay';

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

const EMPTY_FORM: Form = {
  title: '',
  company: '',
  url: '',
  source: '',
  location: '',
  seniority: '',
  reports_to: '',
  team: '',
  employment_type: '',
  salary_min: '',
  salary_max: '',
  salary_currency: 'USD',
  salary_text: '',
  posted_on: '',
  company_domain: '',
  company_website: '',
  company_linkedin: '',
  company_hq: '',
  company_size: '',
  company_industry: '',
  company_funding: '',
  description: '',
  notes: '',
};

/** Adding a job. An existing application is edited in place on its page. */
export function ApplicationSheet() {
  const sheets = useSheets();
  const act = useActions();
  const nav = useNavigate();
  const [f, setF] = useState<Form>(EMPTY_FORM);
  const [mode, setMode] = useState<WorkMode | null>(null);
  const [period, setPeriod] = useState<SalaryPeriod>('year');
  const [must, setMust] = useState<string[]>([]);
  const [nice, setNice] = useState<string[]>([]);
  const [status, setStatus] = useState<'saved' | 'applied'>('saved');
  const [busy, setBusy] = useState(false);
  // The company: one of yours, or a new one filled in here (made when the job is added).
  const [picked, setPicked] = useState<Company | null>(null);
  const [fresh, setFresh] = useState<NewCompany | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const companyName = picked?.name ?? fresh?.name.trim() ?? '';
  const data = useData();
  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  // Links are plain text fields (the server adds https://), so "fathom.com" is fine.
  const inp = (k: keyof Form, type = 'text') => (
    <input
      className="in"
      type={type === 'url' ? 'text' : type}
      {...(type === 'url' ? { inputMode: 'url', autoCapitalize: 'off', spellCheck: false } : {})}
      value={f[k]}
      onChange={set(k)}
    />
  );

  async function save() {
    if (!f.title.trim() || !companyName) return;
    setBusy(true);
    // A new company is added first, then the job is linked to it (or to the one picked).
    let companyId = picked?.id;
    if (!companyId && fresh) {
      const c = await act.post<Company>('/companies', {
        name: fresh.name.trim(),
        website: fresh.website || null,
        linkedin: fresh.linkedin || null,
        hq: fresh.hq || null,
        size: fresh.size || null,
        industry: fresh.industry || null,
        funding: fresh.funding || null,
      });
      if (!c) return setBusy(false);
      companyId = c.id;
      // Its logo, if one was chosen (a failed upload leaves the company without one).
      if (logo) await act.run(() => uploadFile(`/companies/${c.id}/logo`, logo));
    }
    const [salaryMin, salaryMax] = payRange(f.salary_min, f.salary_max);
    const job = Object.fromEntries(
      Object.entries(f).filter(([k]) => !k.startsWith('company')),
    ) as Partial<Form>;
    const body = {
      ...job,
      company: companyName,
      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_period: salaryMin != null || salaryMax != null ? period : null,
      posted_on: f.posted_on || null,
      work_mode: mode,
      must_haves: must,
      nice_to_haves: nice,
    };
    const r = await act.post<Application>('/applications', { ...body, status }, 'Added');
    if (r && companyId && r.company_id !== companyId)
      await act.post(`/applications/${r.id}/company`, { company_id: companyId });
    setBusy(false);
    if (!r) return;
    sheets.close();
    nav(`/a/${r.id}`);
  }

  return (
    <Sheet
      title="Add a Job"
      icon="briefcase"
      onClose={sheets.close}
      footer={
        <>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !f.title.trim() || !companyName}
            onClick={save}
          >
            Save application
          </button>
        </>
      }
    >
      {/* Grouped like a job's page: the job, its pay, the role, what it asks for, the posting. */}
      <h3 className="form-sec">
        <Icon name="briefcase" size={16} /> The Job
      </h3>
      <Field label="Title">{inp('title')}</Field>
      <Field label="Company">
        <CompanyChooser
          companies={data?.state.companies ?? []}
          picked={picked}
          onPick={setPicked}
          fresh={fresh}
          onFresh={setFresh}
          logo={logo}
          onLogo={setLogo}
        />
      </Field>
      <Field label="Job link">{inp('url', 'url')}</Field>
      <div className="two">
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
        <Field label="Source">
          <Select
            value={f.source}
            onChange={(v) => setF((p) => ({ ...p, source: v }))}
            placeholder="Not set"
            groups={[
              {
                options: [
                  { value: '', label: 'Not set' },
                  ...SOURCES.map((s) => ({ value: s, label: s })),
                ],
              },
            ]}
          />
        </Field>
      </div>

      <h3 className="form-sec">
        <Icon name="coin" size={16} /> Pay
      </h3>
      <div className="pay-range">
        <label className="mini-l">
          Min
          <input
            className="in"
            inputMode="decimal"
            value={f.salary_min}
            onChange={set('salary_min')}
          />
        </label>
        <label className="mini-l">
          Max
          <input
            className="in"
            inputMode="decimal"
            value={f.salary_max}
            onChange={set('salary_max')}
          />
        </label>
        <div className="mini-l">
          Per
          <Select
            value={period}
            onChange={(v) => setPeriod(v as SalaryPeriod)}
            groups={[{ options: SALARY_PERIODS.map((p) => ({ value: p, label: p })) }]}
          />
        </div>
      </div>
      <Field label="Notes on pay (bonus, equity…)">{inp('salary_text')}</Field>

      <h3 className="form-sec">
        <Icon name="user" size={16} /> The Role
      </h3>
      <div className="two">
        <Field label="Employment type">
          <Select
            value={f.employment_type}
            onChange={(v) => setF((p) => ({ ...p, employment_type: v }))}
            placeholder="Not set"
            groups={[
              {
                options: [
                  { value: '', label: 'Not set' },
                  ...EMPLOYMENT_TYPES.map((v) => ({ value: v, label: v })),
                ],
              },
            ]}
          />
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
        <Field label="Location">{inp('location')}</Field>
        <Field label="Team">{inp('team')}</Field>
        <Field label="Reports to">{inp('reports_to')}</Field>
      </div>

      <h3 className="form-sec">
        <Icon name="check" size={16} /> Qualifications
      </h3>
      <Field label="Required qualifications">
        <TagInput
          value={must}
          onChange={setMust}
          suggestions={[]}
          placeholder="Add one, press Enter"
        />
      </Field>
      <Field label="Preferred qualifications">
        <TagInput
          value={nice}
          onChange={setNice}
          suggestions={[]}
          placeholder="Add one, press Enter"
        />
      </Field>

      <h3 className="form-sec">
        <Icon name="file" size={16} /> Description and Notes
      </h3>
      <Field label="Full job description">
        <textarea className="in" rows={6} value={f.description} onChange={set('description')} />
      </Field>
      <Field label="Notes">
        <AutoTextarea className="in" rows={3} value={f.notes} onChange={set('notes')} />
      </Field>
    </Sheet>
  );
}

interface Written {
  event: TimelineEvent | null;
  application: Application;
}

/** The ways an application ends: the Closed stage. */
const CLOSE_TYPES: Status[] = ['accepted', ...CLOSED_STATUSES];

export function StatusSheet({
  data,
  appId,
  to,
}: {
  data: Data;
  appId: string;
  /** A status to start on, or 'closed' to start on Closed (pick how it ended). */
  to?: Status | 'closed';
}) {
  const a = data.appById.get(appId);
  const sheets = useSheets();
  const act = useActions();
  const toast = useToast();
  const [next, setNext] = useState<Status | null>(to && to !== 'closed' ? to : null);
  // Closed is one stage on the bar; picking it asks how it ended.
  const [closing, setClosing] = useState(
    to === 'closed' || (!!to && CLOSE_TYPES.includes(to as Status)),
  );
  const [when, setWhen] = useState(toLocalInput(new Date().toISOString()));
  const [reason, setReason] = useState('');
  const others = data.state.applications.filter(
    (x) => a && x.round_id === a.round_id && x.id !== a.id && isOpen(x.status),
  );
  const [decline, setDecline] = useState<string[]>(others.map((o) => o.id));
  const search = a ? data.state.rounds.find((x) => x.id === a.round_id) : undefined;
  // After accepting: ask whether to mark the whole search Accepted too.
  const [askRound, setAskRound] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!a) return null;

  async function save() {
    if (!next || !a) return;
    setBusy(true);
    // What undo puts back: status lives in the timeline, so undo deletes the status events this
    // wrote (the status is recomputed from what's left), plus the applied date and the search's
    // state if this change set them.
    const appliedBefore = a.applied_on;
    const roundBefore = search && { status: search.status, ended_on: search.ended_on };
    const written: { appId: string; eventId: string; applied_on: string | null }[] = [];
    const ok = await act.post<Written>(`/applications/${a.id}/status`, {
      status: next,
      occurred_at: fromLocalInput(when) ?? undefined,
      reason: reason || null,
    });
    if (ok?.event) written.push({ appId: a.id, eventId: ok.event.id, applied_on: appliedBefore });
    if (ok && next === 'accepted')
      for (const id of decline) {
        const before = data.appById.get(id)?.applied_on ?? null;
        const r = await act.post<Written>(`/applications/${id}/status`, {
          status: 'declined',
          reason: `Accepted ${a.company}`,
        });
        if (r?.event) written.push({ appId: id, eventId: r.event.id, applied_on: before });
      }
    setBusy(false);
    if (!ok) return;
    // Good news gets a small burst of asterisks, from the stage bar on the page if it's there.
    if (next === 'offer' || next === 'accepted')
      burst(document.querySelector('.app-page .stepper'));
    if (next === 'accepted' && search && search.status !== 'accepted') setAskRound(true);
    else sheets.close();
    if (!written.length) return;
    const moved = next;
    toast({
      text: `Moved to ${statusLabel(moved)}`,
      action: {
        label: 'Undo',
        run: () =>
          void act.run(async () => {
            for (const w of written) {
              await api.del(`/events/${w.eventId}`);
              const now = await api.get<Application>(`/applications/${w.appId}`);
              if (w.applied_on !== now.applied_on)
                await api.patch(`/applications/${w.appId}`, { applied_on: w.applied_on });
            }
            if (moved === 'accepted' && search && roundBefore)
              await api.patch(`/rounds/${search.id}`, roundBefore);
          }, 'Status put back'),
      },
    });
  }

  if (askRound && search)
    return (
      <Sheet
        title="Congratulations!"
        icon="gift"
        onClose={sheets.close}
        footer={
          <>
            <button type="button" className="btn" onClick={sheets.close}>
              Not now
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await act.post(
                  `/applications/${a.id}/status`,
                  { status: 'accepted', close_round: true },
                  `“${search.name}” marked Accepted`,
                );
                setBusy(false);
                if (ok) sheets.close();
              }}
            >
              Yes, mark it Accepted
            </button>
          </>
        }
      >
        <p>
          You accepted {a.company}. Move the round <strong>“{search.name}”</strong> to Accepted too?
        </p>
        <p className="sub">It ends the round; you can reopen it from the round menu.</p>
      </Sheet>
    );

  return (
    <Sheet
      title="Change Status"
      icon="move"
      onClose={sheets.close}
      footer={
        <button type="button" className="btn primary" disabled={!next || busy} onClick={save}>
          {next ? `Move to ${statusLabel(next)}` : 'Pick one'}
        </button>
      }
    >
      <StageBar
        label="New status"
        stages={[
          ...OPEN_STATUSES.map((s) => ({
            key: s,
            label: statusLabel(s),
            icon: <StatusIcon status={s} size={15} />,
            state:
              !closing && next === s
                ? ('picked' as const)
                : a.status === s
                  ? ('here' as const)
                  : ('todo' as const),
            disabled: a.status === s,
            title: a.status === s ? 'Where it is now' : undefined,
            onClick: () => {
              setClosing(false);
              setNext(s);
            },
          })),
          {
            key: 'closed',
            label: next && closing ? statusLabel(next) : 'Closed',
            icon: <StatusIcon status={next && closing ? next : 'closed'} size={15} />,
            state: closing
              ? ('picked' as const)
              : CLOSE_TYPES.includes(a.status)
                ? ('here' as const)
                : ('todo' as const),
            tone: (() => {
              const end = closing ? next : CLOSE_TYPES.includes(a.status) ? a.status : null;
              return end
                ? end === 'accepted'
                  ? ('good' as const)
                  : ('muted' as const)
                : undefined;
            })(),
            onClick: () => {
              setClosing(true);
              setNext((n) => (n && CLOSE_TYPES.includes(n) ? n : null));
            },
          },
        ]}
      />
      {closing && (
        <>
          <span className="lbl close-q">How Did It End?</span>
          <div className="status-pick" role="radiogroup" aria-label="How it ended">
            {CLOSE_TYPES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={next === s}
                className="status-opt"
                onClick={() => setNext(s)}
                disabled={s === a.status}
              >
                <StatusIcon status={s} size={16} />
                {statusLabel(s)}
              </button>
            ))}
          </div>
          <p className="hint">Closing records the stage it closed from, for the report.</p>
        </>
      )}
      <div className="two" style={{ marginTop: 16 }}>
        <Field label="When">
          <DateTimeField label="When" value={when} onChange={setWhen} />
        </Field>
      </div>
      <Field label="Comments">
        <AutoTextarea
          className="in"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {next === 'accepted' && others.length > 0 && (
        <div className="callout">
          <strong>You’re in. Close the other doors?</strong>
          <p className="sub">These are still open in this round. Checked ones become Declined.</p>
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

export function PersonSheet({
  data,
  appId,
  id,
  companyId,
}: {
  data: Data;
  /** The job they're being added to or seen from; null when opened from a company's page. */
  appId: string | null;
  id?: string;
  companyId?: string;
}) {
  const p: Person | undefined = data.state.people.find((x) => x.id === id);
  const sheets = useSheets();
  const act = useActions();
  const [name, setName] = useState(p?.name ?? '');
  const [email, setEmail] = useState(p?.email ?? '');
  const [title, setTitle] = useState(p?.title ?? '');
  const [role, setRole] = useState<PersonRole>(p?.role ?? 'recruiter');
  const [otherRole, setOtherRole] = useState(p?.other_role ?? '');
  const [linkedin, setLinkedin] = useState(p?.linkedin ?? '');
  const [notes, setNotes] = useState(p?.notes ?? '');
  // Adding someone: first, the people already at this job's company (not yet on this job).
  const app = appId ? data.appById.get(appId) : undefined;
  const coId = companyId ?? app?.company_id ?? p?.company_id ?? null;
  const known =
    p || !appId
      ? []
      : data.state.people.filter(
          (x) => coId && x.company_id === coId && !x.application_ids.includes(appId),
        );
  // From a company's page there's no one to pick: straight to the form.
  const [creating, setCreating] = useState(!appId);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const ql = q.trim().toLowerCase();
  const matches = known.filter(
    (x) => !ql || `${x.name} ${x.title ?? ''} ${x.email ?? ''}`.toLowerCase().includes(ql),
  );
  // The list: matching people at the company, then "Add person" (with what's typed as the name).
  const rows: (Person | null)[] = [...matches, null];
  const choose = (r: Person | null) => {
    if (r) void addKnown(r);
    else {
      setName(q.trim());
      setCreating(true);
    }
  };
  const company = data.state.companies.find((c) => c.id === coId);
  async function addKnown(person: Person) {
    if (await act.post(`/applications/${appId}/people/${person.id}`, {}, `${person.name} added`))
      sheets.close();
  }
  async function save() {
    const body = {
      name,
      email,
      title,
      role,
      other_role: role === 'other' ? otherRole : null,
      linkedin,
      notes,
    };
    const ok = p
      ? await act.patch(`/people/${p.id}`, body)
      : appId
        ? await act.post(`/applications/${appId}/people`, body)
        : await act.post(`/companies/${coId}/people`, body);
    if (ok) sheets.close();
  }
  return (
    <Sheet
      title={p ? 'Edit Person' : 'Add a Person'}
      icon="user"
      onClose={sheets.close}
      footer={
        <>
          {/* Delete removes them everywhere (asks first). From a job, Remove from job takes them
              off just that one; they stay at the company. */}
          {p && (
            <ConfirmButton
              className="left"
              confirm={`Delete ${p.name}?`}
              onConfirm={async () =>
                (await act.del(`/people/${p.id}`, `Deleted ${p.name}`)) && sheets.close()
              }
            >
              Delete
            </ConfirmButton>
          )}
          {p && appId && (
            <button
              type="button"
              className="btn"
              onClick={async () =>
                (await act.del(`/applications/${appId}/people/${p.id}`, 'Removed from this job')) &&
                sheets.close()
              }
            >
              Remove from job
            </button>
          )}
          {(p || creating) && (
            <button type="button" className="btn primary" disabled={!name.trim()} onClick={save}>
              {p ? 'Save' : 'Add person'}
            </button>
          )}
        </>
      }
    >
      {/* Adding someone: search the people at this job's company, or add a new person. */}
      {!p && !creating && (
        <div className="known-people">
          <label className="search-in search-full">
            <Icon name="search" size={16} />
            <input
              autoFocus
              value={q}
              placeholder={`Search people at ${company?.name ?? app?.company ?? 'this company'}`}
              aria-label="Person"
              aria-autocomplete="list"
              onChange={(e) => {
                setQ(e.target.value);
                setHi(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  const d = e.key === 'ArrowDown' ? 1 : -1;
                  setHi((i) => Math.max(0, Math.min(rows.length - 1, i + d)));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  choose(rows[hi] ?? null);
                }
              }}
            />
            <SearchClear value={q} onClear={() => setQ('')} />
          </label>
          <div className="pick-list" role="listbox" aria-label="People">
            {rows.map((x, i) =>
              x ? (
                <button
                  key={x.id}
                  type="button"
                  role="option"
                  aria-selected={i === hi}
                  className={cx('person', i === hi && 'hi')}
                  onClick={() => choose(x)}
                >
                  <span className="avatar">{initials(x.name)}</span>
                  <span className="row-text">
                    <strong>{x.name}</strong>
                    <span className="sub">
                      {[personRoleLabel(x), x.title].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              ) : (
                <button
                  key="new"
                  type="button"
                  role="option"
                  aria-selected={i === hi}
                  className={cx('person pick-add', i === hi && 'hi')}
                  onClick={() => choose(null)}
                >
                  <span className="avatar">
                    <Icon name="plus" size={16} />
                  </span>
                  <strong>{q.trim() ? `Add person “${q.trim()}”` : 'Add a new person'}</strong>
                </button>
              ),
            )}
          </div>
        </div>
      )}
      {(p || creating) && (
        <>
          <div className="two">
            <Field label="Name">
              <input className="in" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Title">
              <input className="in" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </div>
          <Field label="Role">
            <Select
              value={role}
              onChange={(v) => setRole(v as PersonRole)}
              groups={[{ options: PERSON_ROLES.map((r) => ({ value: r.key, label: r.label })) }]}
            />
          </Field>
          {role === 'other' && (
            <Field label="Other role">
              <input
                className="in"
                value={otherRole}
                onChange={(e) => setOtherRole(e.target.value)}
              />
            </Field>
          )}
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
              type="text"
              inputMode="url"
              autoCapitalize="off"
              spellCheck={false}
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
            />
          </Field>
          <Field label="Notes">
            <AutoTextarea
              className="in"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </>
      )}
    </Sheet>
  );
}

/** "Priya Shah" → "PS". */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function RoundSheet({ data, id }: { data: Data; id?: string }) {
  const s: Round | undefined = data.state.rounds.find((x) => x.id === id);
  const sheets = useSheets();
  const act = useActions();
  const [name, setName] = useState(s?.name ?? '');
  const [status, setStatus] = useState<Round['status']>(s?.status ?? 'active');
  const [notes, setNotes] = useState(s?.notes ?? '');
  const count = data.state.applications.filter((a) => a.round_id === id).length;
  async function save() {
    const body = { name, status, notes };
    const ok = s
      ? await act.patch<Round>(`/rounds/${s.id}`, body)
      : await act.post<Round>('/rounds', body);
    if (!ok) return;
    // A new search becomes the one this device (and the server) is on.
    if (!s) await act.chooseRound(ok.id);
    sheets.close();
  }
  return (
    <Sheet
      title={s ? 'Edit Round' : 'Start a Round'}
      icon="search"
      onClose={sheets.close}
      footer={
        <>
          {s && (
            <ConfirmButton
              className="left"
              confirm={`Delete it and ${count} applications?`}
              onConfirm={async () =>
                (await act.del(`/rounds/${s.id}`, 'Deleted')) && sheets.close()
              }
            >
              Delete
            </ConfirmButton>
          )}
          {s && data.round?.id !== s.id && (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await act.chooseRound(s.id);
                sheets.close();
              }}
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
        <input className="in" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {s && (
        <Field label="Status">
          <SlideToggle
            label="Round status"
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
        <AutoTextarea
          className="in"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
    </Sheet>
  );
}
