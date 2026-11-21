// Logging a meeting, email or note by hand. An entry already logged opens in EventView, where
// it's edited in place.
import { useMemo, useState } from 'react';
import {
  EMAIL_CATEGORIES,
  MEETING_KINDS,
  meetingKindLabel,
  type EmailCategory,
  type MeetingKind,
  type MeetingState,
} from '@shared/lookups';
import type { Attendee, EmailData, MeetingData, TimelineEvent } from '@shared/types';
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
      title="Log to timeline"
      sub={`${app.company} · ${app.title}`}
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
            <SlideToggle
              label="Kind"
              value={kind}
              onChange={setKind}
              options={MEETING_KINDS.map((k) => [k.key, k.label] as const)}
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
          <Field label="Who (name, title, email)">
            <AttendeesInput people={people} onChange={setPeople} />
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
          <Field label="Note">
            <AutoTextarea
              className="in"
              rows={6}
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <div className="two">
            <Field label="Title (optional)">
              <input className="in" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="When">
              <DateTimeField label="When" value={when} onChange={setWhen} />
            </Field>
          </div>
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

/** Who's in a meeting: a row each (name, title, email), with remove and Add someone. */
export function AttendeesInput({
  people,
  onChange,
}: {
  people: Attendee[];
  onChange: (p: Attendee[]) => void;
}) {
  const set = (i: number, p: Partial<Attendee>) =>
    onChange(people.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="attendees">
      {people.map((p, i) => (
        <div key={i} className="three att">
          <input
            className="in"
            value={p.name}
            aria-label="Name"
            placeholder="Name"
            onChange={(e) => set(i, { name: e.target.value })}
          />
          <input
            className="in"
            value={p.title ?? ''}
            aria-label="Title"
            placeholder="Title"
            onChange={(e) => set(i, { title: e.target.value })}
          />
          <div className="att-last">
            <input
              className="in"
              value={p.email ?? ''}
              aria-label="Email"
              placeholder="Email"
              onChange={(e) => set(i, { email: e.target.value })}
            />
            <button
              type="button"
              className="xbtn"
              aria-label="Remove"
              onClick={() => onChange(people.filter((_, j) => j !== i))}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="btn sm" onClick={() => onChange([...people, { name: '' }])}>
        <Icon name="plus" size={14} /> Add someone
      </button>
    </div>
  );
}
