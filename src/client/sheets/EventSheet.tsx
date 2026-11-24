// Logging a meeting, email or note by hand. An entry already logged opens in EventView, where
// it's edited in place.
import { Fragment, useMemo, useState } from 'react';
import { groupPeople } from '../lib/peopleGroups';
import {
  EMAIL_CATEGORIES,
  MEETING_KINDS,
  PERSON_ROLES,
  meetingKindLabel,
  personRoleLabel,
  type PersonRole,
  type EmailCategory,
  type MeetingKind,
  type MeetingState,
} from '@shared/lookups';
import type { Attendee, EmailData, MeetingData, Person, TimelineEvent } from '@shared/types';
import { useActions, type Data } from '../lib/queries';
import { fromLocalInput, toLocalInput, whenLabel } from '../lib/format';
import { AutoTextarea, Field, Select, Sheet, SlideToggle, TagInput } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { DateTimeField } from '../components/DateTimePicker';
import { useSheets, type LogType } from './context';

export const EVENT_ICON: Record<string, IconName> = {
  meeting: 'video',
  email: 'mail',
  note: 'note',
  status: 'move',
  created: 'plus',
};

export function eventLabel(e: TimelineEvent): string {
  if (e.type === 'meeting') return e.title || meetingKindLabel((e.data as MeetingData).kind);
  if (e.type === 'email') return e.title || (e.data as EmailData).subject || 'Email';
  if (e.type === 'note') return e.title || (e.body ?? '').slice(0, 60);
  return e.type;
}

export function EventSheet({
  data,
  appId,
  type: initialType,
  parentId,
}: {
  data: Data;
  appId: string;
  type?: LogType;
  parentId?: string;
}) {
  const sheets = useSheets();
  const act = useActions();
  const app = data.appById.get(appId);
  const events = useMemo(() => data.eventsByApp.get(appId) ?? [], [data, appId]);
  const [type, setType] = useState<LogType>(initialType ?? (parentId ? 'note' : 'meeting'));

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [when, setWhen] = useState(toLocalInput(new Date().toISOString()));
  // meeting
  const [kind, setKind] = useState<MeetingKind>('recruiter_screen');
  const [state, setState] = useState<MeetingState>('scheduled');
  const [ends, setEnds] = useState('');
  const [joinUrl, setJoinUrl] = useState('');
  const [location, setLocation] = useState('');
  const [agenda, setAgenda] = useState('');
  const [people, setPeople] = useState<Attendee[]>([]);
  // email
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const [category, setCategory] = useState<EmailCategory>('scheduling');
  const [withName, setWithName] = useState('');
  const [withEmail, setWithEmail] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [points, setPoints] = useState<string[]>([]);
  const [link, setLink] = useState('');
  // note
  const [about, setAbout] = useState(parentId ?? '');
  const [busy, setBusy] = useState(false);

  const at = fromLocalInput(when);
  const parents = events.filter((e) => e.type === 'meeting' || e.type === 'email');

  if (!app) return null;

  async function save() {
    if (!at) return;
    setBusy(true);
    let path: string;
    let payload: Record<string, unknown>;
    if (type === 'meeting') {
      payload = {
        title: title || meetingKindLabel(kind),
        occurred_at: at,
        ends_at: fromLocalInput(ends),
        kind,
        state,
        join_url: joinUrl || null,
        location,
        agenda,
        body,
        attendees: people.filter((p) => p.name.trim()),
      };
      path = 'meetings';
    } else if (type === 'email') {
      payload = {
        direction: dir,
        occurred_at: at,
        category,
        counterpart_name: withName,
        counterpart_email: withEmail,
        subject: title,
        body,
        key_points: points,
        link: link || null,
      };
      path = 'emails';
    } else {
      payload = { body, title, occurred_at: at, parent_id: about || null };
      path = 'notes';
    }
    const ok = await act.post(`/applications/${appId}/${path}`, payload, 'Logged');
    setBusy(false);
    if (ok) sheets.close();
  }

  const valid = !!at && (type !== 'note' || body.trim().length > 0);

  return (
    <Sheet
      title="Log to Timeline"
      icon="clock"
      onClose={sheets.close}
      footer={
        <>
          <button type="button" className="btn primary" disabled={!valid || busy} onClick={save}>
            Log {type}
          </button>
        </>
      }
    >
      {
        <div className="type-tiles" role="tablist" aria-label="What happened">
          {(['meeting', 'email', 'note'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={type === t}
              className="type-tile"
              onClick={() => setType(t)}
            >
              <Icon name={EVENT_ICON[t]!} size={22} />
              {t === 'meeting' ? 'Meeting' : t === 'email' ? 'Email' : 'Note'}
            </button>
          ))}
        </div>
      }

      {type === 'meeting' && (
        <>
          <Field label="Kind">
            {/* Six kinds: a dropdown, not a toggle. */}
            <Select
              value={kind}
              onChange={(v) => setKind(v as typeof kind)}
              groups={[{ options: MEETING_KINDS.map((k) => ({ value: k.key, label: k.label })) }]}
            />
          </Field>
          <Field label="Name">
            <input className="in" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="two">
            <Field label="Starts">
              <DateTimeField label="Starts" value={when} onChange={setWhen} />
            </Field>
            <Field label="Ends">
              <DateTimeField
                label="Ends"
                value={ends}
                onChange={setEnds}
                optional
                fallback={when}
              />
            </Field>
          </div>
          <Field label="State">
            <SlideToggle
              label="State"
              value={state}
              onChange={setState}
              options={[
                ['scheduled', 'Scheduled'],
                ['held', 'Held'],
                ['canceled', 'Canceled'],
              ]}
            />
          </Field>
          <div className="two">
            <Field label="Join link">
              <input
                className="in"
                type="text"
                inputMode="url"
                autoCapitalize="off"
                spellCheck={false}
                value={joinUrl}
                onChange={(e) => setJoinUrl(e.target.value)}
              />
            </Field>
            <Field label="Or where">
              <input
                className="in"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Who">
            <AttendeesInput people={people} onChange={setPeople} appId={appId} data={data} />
          </Field>
          <Field label="Topics and format">
            <AutoTextarea
              className="in"
              rows={3}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
            />
          </Field>
          <Field label="Details">
            <AutoTextarea
              className="in"
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
        </>
      )}

      {type === 'email' && (
        <>
          <div className="two">
            <Field label="Direction">
              <SlideToggle
                label="Direction"
                value={dir}
                onChange={setDir}
                options={[
                  ['in', 'Inbound'],
                  ['out', 'Outbound'],
                ]}
              />
            </Field>
            <Field label="When">
              <DateTimeField label="When" value={when} onChange={setWhen} />
            </Field>
          </div>
          {/* Who it's with: picked from the people you have (or a new person), or typed. */}
          {choosing ? (
            <PersonChooser
              appId={appId}
              data={data}
              heading="Choose a person"
              onAdd={(p) => {
                setWithName(p.name);
                setWithEmail(p.email ?? '');
                setChoosing(false);
              }}
              onCancel={() => setChoosing(false)}
            />
          ) : (
            <button
              type="button"
              className="btn sm pick-person-btn"
              onClick={() => setChoosing(true)}
            >
              <Icon name="user" size={14} /> Choose a person
            </button>
          )}
          <div className="two">
            <Field label="With">
              <input
                className="in"
                value={withName}
                onChange={(e) => setWithName(e.target.value)}
              />
            </Field>
            <Field label="Their email">
              <input
                className="in"
                type="email"
                value={withEmail}
                onChange={(e) => setWithEmail(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Category">
            <Select
              value={category}
              onChange={(v) => setCategory(v as EmailCategory)}
              groups={[
                { options: EMAIL_CATEGORIES.map((c) => ({ value: c.key, label: c.label })) },
              ]}
            />
          </Field>
          <Field label="Subject">
            <input className="in" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="What happened (a summary, not the whole email)">
            <AutoTextarea
              className="in"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <Field label="Key points">
            <TagInput value={points} onChange={setPoints} suggestions={[]} />
          </Field>
          <Field label="Link to the email (optional)">
            <input
              className="in"
              type="text"
              inputMode="url"
              autoCapitalize="off"
              spellCheck={false}
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </Field>
        </>
      )}

      {type === 'note' && (
        <>
          {/* Title (full width), then when (on its own, at the left), then the note. */}
          <Field label="Title (optional)">
            <input className="in" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="When">
            <div className="when-left">
              <DateTimeField label="When" value={when} onChange={setWhen} />
            </div>
          </Field>
          <Field label="Note">
            <AutoTextarea
              className="in"
              rows={6}
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>

          {parents.length > 0 && (
            <Field label="About">
              <Select
                value={about}
                onChange={setAbout}
                groups={[
                  { options: [{ value: '', label: 'The application (no event)' }] },
                  {
                    label: 'Meetings and emails',
                    options: parents.map((p) => ({
                      value: p.id,
                      label: `${eventLabel(p)} · ${whenLabel(p.occurred_at)}`,
                    })),
                  },
                ]}
              />
            </Field>
          )}
        </>
      )}
    </Sheet>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/**
 * Who's in a meeting: a card each (name, then title and email), with remove. Add someone opens a
 * card to pick someone you already have, or add a new person: saved as a person on this job and
 * at a company (this job's, another, or a new one), then in the meeting.
 */
export function AttendeesInput({
  people,
  onChange,
  appId,
  data,
}: {
  people: Attendee[];
  onChange: (p: Attendee[]) => void;
  appId: string;
  data: Data;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="attendees">
      {people.map((p, i) => (
        <div key={`${p.person_id ?? p.name}-${i}`} className="att-card">
          <span className="co-mark person-mark">{initials(p.name)}</span>
          <span className="row-text">
            <strong>{p.name}</strong>
            {(p.title || p.email) && (
              <span className="prow-pills">
                {p.title && <span className="pill">{p.title}</span>}
                {p.email && <span className="pill">{p.email}</span>}
              </span>
            )}
          </span>
          <button
            type="button"
            className="xbtn"
            aria-label={`Remove ${p.name}`}
            onClick={() => onChange(people.filter((_, j) => j !== i))}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
      {adding ? (
        <PersonChooser
          appId={appId}
          data={data}
          taken={people}
          heading="Add someone"
          onAdd={(p) => {
            onChange([...people, p]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" className="btn sm" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> Add someone
        </button>
      )}
    </div>
  );
}

/**
 * Picking someone for a meeting or an email: people you already have first, in order (on this
 * job, then at its company, then anyone), searched by name, title or email; or a new person,
 * saved on this job and at a company (this job's, another, or a new one). A person picked who
 * isn't on this job yet is added to it.
 */
export function PersonChooser({
  appId,
  data,
  taken = [],
  heading,
  onAdd,
  onCancel,
}: {
  appId: string;
  data: Data;
  taken?: Attendee[];
  heading: string;
  onAdd: (p: Attendee) => void;
  onCancel: () => void;
}) {
  const act = useActions();
  const app = data.appById.get(appId);
  const [mode, setMode] = useState<'pick' | 'new'>('pick');
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PersonRole>('interviewer');
  // Their company, typed: the job's to start with; an existing one by name, or a new one.
  const jobCompany = data.state.companies.find((c) => c.id === app?.company_id);
  const [companyName, setCompanyName] = useState(jobCompany?.name ?? app?.company ?? '');
  const [busy, setBusy] = useState(false);
  const takenIds = new Set(taken.map((t) => t.person_id).filter(Boolean));
  // Anyone you have (not already picked), grouped: at the job's company, on the job, everyone.
  const groups = groupPeople(data, appId, q, (x) => takenIds.has(x.id));
  const list = groups.flatMap((g) => g.people);
  const coName = (id: string | null) => data.state.companies.find((c) => c.id === id)?.name;
  async function pick(x: Person) {
    setBusy(true);
    const ok = x.application_ids.includes(appId)
      ? true
      : await act.post(`/applications/${appId}/people/${x.id}`, {});
    setBusy(false);
    if (ok) onAdd({ name: x.name, title: x.title, email: x.email, person_id: x.id });
  }
  const startNew = () => {
    setName(q.trim());
    setMode('new');
  };
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const person = await act.post<Person>(
      `/applications/${appId}/people`,
      {
        name: name.trim(),
        title: title.trim() || null,
        email: email.trim() || null,
        role,
        ...companyPick(companyName),
      },
      `${name.trim()} added`,
    );
    setBusy(false);
    if (person)
      onAdd({ name: person.name, title: person.title, email: person.email, person_id: person.id });
  }
  if (mode === 'pick')
    return (
      <div className="add-person-card">
        <strong className="add-person-h">{heading}</strong>
        <label className="search-in search-full">
          <Icon name="search" size={16} />
          <input
            autoFocus
            value={q}
            placeholder="Search people"
            aria-label="Search people"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (list[0]) void pick(list[0]);
                else startNew();
              }
            }}
          />
        </label>
        <div className="pick-list" role="listbox" aria-label="People">
          {groups.map((g) => (
            <Fragment key={g.label}>
              <div className="pick-group" role="presentation">
                {g.label}
              </div>
              {g.people.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="person"
                  disabled={busy}
                  onClick={() => void pick(x)}
                >
                  <span className="avatar">{initials(x.name)}</span>
                  <span className="row-text">
                    <strong>{x.name}</strong>
                    <span className="sub">
                      {[personRoleLabel(x), x.title, coName(x.company_id)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </button>
              ))}
            </Fragment>
          ))}
          <button type="button" className="person pick-add" onClick={startNew}>
            <span className="avatar">
              <Icon name="plus" size={16} />
            </span>
            <strong>{q.trim() ? `New person “${q.trim()}”` : 'New person'}</strong>
          </button>
        </div>
        <div className="add-person-acts">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  const companies = [...data.state.companies].sort((x, y) => x.name.localeCompare(y.name));
  /** The company typed: an existing one (by name, any case), else a new one with that name. */
  function companyPick(name: string): { company_id: string } | { company_name: string } | object {
    const n = name.trim();
    if (!n) return {};
    const found = data.state.companies.find((c) => c.name.trim().toLowerCase() === n.toLowerCase());
    return found ? { company_id: found.id } : { company_name: n };
  }
  return (
    <div className="add-person-card">
      <strong className="add-person-h">New person</strong>
      <Field label="Name">
        <input
          className="in"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
        />
      </Field>
      <div className="two">
        <Field label="Title">
          <input className="in" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Email">
          <input
            className="in"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
      </div>
      <div className="two">
        <Field label="Role">
          <Select
            value={role}
            onChange={(v) => setRole(v as PersonRole)}
            groups={[{ options: PERSON_ROLES.map((r) => ({ value: r.key, label: r.label })) }]}
          />
        </Field>
        <Field label="Company">
          <input
            className="in"
            list={`co-${appId}`}
            value={companyName}
            placeholder="Type a company"
            onChange={(e) => setCompanyName(e.target.value)}
          />
          <datalist id={`co-${appId}`}>
            {companies.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </Field>
      </div>
      <div className="add-person-acts">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!name.trim() || busy}
          onClick={() => void save()}
        >
          Add person
        </button>
      </div>
    </div>
  );
}
