// Adding and editing applications, changing status, people, and searches.
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
} from '@shared/lookups';
import type { Application, Person, Search, TimelineEvent } from '@shared/types';
import { api } from '../lib/api';
import { useActions, type Data } from '../lib/queries';
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
} from '../components/ui';
import { CLOSED_ICON, STATUS_ICON, StatusChip } from '../components/StatusChip';
import { StageBar } from '../components/StageBar';
import { Icon } from '../components/Icon';
import { DatePicker, DateTimeField } from '../components/DateTimePicker';
import { useSheets } from './context';
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
    if (!f.title.trim() || !f.company.trim()) return;
    setBusy(true);
    const [salaryMin, salaryMax] = payRange(f.salary_min, f.salary_max);
    const body = {
      ...f,
      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_period: salaryMin != null || salaryMax != null ? period : null,
      posted_on: f.posted_on || null,
      work_mode: mode,
      must_haves: must,
      nice_to_haves: nice,
    };
    const r = await act.post<Application>('/applications', { ...body, status }, 'Added');
    setBusy(false);
    if (!r) return;
    sheets.close();
    nav(`/a/${r.id}`);
  }

  return (
    <Sheet
      title="Add a job"
      sub="Faster: paste the link to your assistant and it fills all of this in."
      onClose={sheets.close}
      footer={
        <>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !f.title.trim() || !f.company.trim()}
            onClick={save}
          >
            Save application
          </button>
        </>
      }
    >
      <Field label="Job link">{inp('url', 'url')}</Field>
      <div className="two">
        <Field label="Company">{inp('company')}</Field>
        <Field label="Title">{inp('title')}</Field>
      </div>
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
      <Field label="Pay range">
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
      </Field>
      <Field label="Notes on pay (bonus, equity…)">{inp('salary_text')}</Field>
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
        <Field label="Location">{inp('location')}</Field>
        <Field label="Seniority">{inp('seniority')}</Field>
        <Field label="Reports to">{inp('reports_to')}</Field>
        <Field label="Team">{inp('team')}</Field>
        <Field label="Type">{inp('employment_type')}</Field>
        <Field label="Posted">
          <DatePicker
            label="Posted"
            clearable
            value={f.posted_on || null}
            onChange={(v) => setF((p) => ({ ...p, posted_on: v ?? '' }))}
          />
        </Field>
      </div>
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
      <span className="lbl sheet-sec">Company</span>
      <div className="two">
        <Field label="Domain">{inp('company_domain')}</Field>
        <Field label="Website">{inp('company_website', 'url')}</Field>
        <Field label="LinkedIn">{inp('company_linkedin', 'url')}</Field>
        <Field label="HQ">{inp('company_hq')}</Field>
        <Field label="Size">{inp('company_size')}</Field>
        <Field label="Industry">{inp('company_industry')}</Field>
        <Field label="Funding">{inp('company_funding')}</Field>
      </div>
      <Field label="Job description" className="mt">
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
    (x) => a && x.search_id === a.search_id && x.id !== a.id && isOpen(x.status),
  );
  const [decline, setDecline] = useState<string[]>(others.map((o) => o.id));
  const search = a ? data.state.searches.find((x) => x.id === a.search_id) : undefined;
  // After accepting: ask whether to mark the whole search Accepted too.
  const [askSearch, setAskSearch] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!a) return null;

  async function save() {
    if (!next || !a) return;
    setBusy(true);
    // What undo puts back: status lives in the timeline, so undo deletes the status events this
    // wrote (the status is recomputed from what's left), plus the applied date and the search's
    // state if this change set them.
    const appliedBefore = a.applied_on;
    const searchBefore = search && { status: search.status, ended_on: search.ended_on };
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
    if (next === 'accepted' && search && search.status !== 'accepted') setAskSearch(true);
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
            if (moved === 'accepted' && search && searchBefore)
              await api.patch(`/searches/${search.id}`, searchBefore);
          }, 'Status put back'),
      },
    });
  }

  if (askSearch && search)
    return (
      <Sheet
        title="Congratulations!"
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
                  { status: 'accepted', close_search: true },
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
          You accepted {a.company}. Move the search <strong>“{search.name}”</strong> to Accepted
          too?
        </p>
        <p className="sub">It ends the search; you can reopen it from the search menu.</p>
      </Sheet>
    );

  return (
    <Sheet
      title="Change status"
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
            icon: STATUS_ICON[s],
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
            icon: next && closing ? STATUS_ICON[next] : CLOSED_ICON,
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
          <span className="lbl close-q">How did it end?</span>
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
                <Icon name={STATUS_ICON[s]} size={16} />
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
  const [otherRole, setOtherRole] = useState(p?.other_role ?? '');
  const [linkedin, setLinkedin] = useState(p?.linkedin ?? '');
  const [notes, setNotes] = useState(p?.notes ?? '');
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
          <input className="in" value={title} onChange={(e) => setTitle(e.target.value)} />
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
      {role === 'other' && (
        <Field label="Other role">
          <input className="in" value={otherRole} onChange={(e) => setOtherRole(e.target.value)} />
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
    </Sheet>
  );
}

export function SearchSheet({ data, id }: { data: Data; id?: string }) {
  const s: Search | undefined = data.state.searches.find((x) => x.id === id);
  const sheets = useSheets();
  const act = useActions();
  const [name, setName] = useState(s?.name ?? '');
  const [status, setStatus] = useState<Search['status']>(s?.status ?? 'active');
  const [notes, setNotes] = useState(s?.notes ?? '');
  const count = data.state.applications.filter((a) => a.search_id === id).length;
  async function save() {
    const body = { name, status, notes };
    const ok = s
      ? await act.patch<Search>(`/searches/${s.id}`, body)
      : await act.post<Search>('/searches', body);
    if (!ok) return;
    // A new search becomes the one this device (and the server) is on.
    if (!s) await act.chooseSearch(ok.id);
    sheets.close();
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
          {s && data.search?.id !== s.id && (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await act.chooseSearch(s.id);
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
