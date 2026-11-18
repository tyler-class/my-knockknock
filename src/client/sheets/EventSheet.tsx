// Logging a meeting, email or note by hand (or editing one, whoever logged it).
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
import {
  AutoTextarea,
  ConfirmButton,
  Field,
  Select,
  Sheet,
  SlideToggle,
  TagInput,
} from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { useSheets, type LogType } from './context';

export const EVENT_ICON: Record<string, IconName> = {
  meeting: 'video',
  email: 'mail',
  note: 'note',
  status: 'arrowRight',
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
  eventId,
  parentId,
}: {
  data: Data;
  appId: string;
  type?: LogType;
  eventId?: string;
  parentId?: string;
}) {
  const sheets = useSheets();
  const act = useActions();
  const app = data.appById.get(appId);
  const events = useMemo(() => data.eventsByApp.get(appId) ?? [], [data, appId]);
  const ev = eventId ? events.find((e) => e.id === eventId) : undefined;
  const [type, setType] = useState<LogType>(
    (ev?.type as LogType | undefined) ?? initialType ?? (parentId ? 'note' : 'meeting'),
  );
  const m = (ev?.type === 'meeting' ? ev.data : null) as MeetingData | null;
  const em = (ev?.type === 'email' ? ev.data : null) as EmailData | null;

  const [title, setTitle] = useState(ev?.title ?? '');
  const [body, setBody] = useState(ev?.body ?? '');
  const [when, setWhen] = useState(toLocalInput(ev?.occurred_at ?? new Date().toISOString()));
  // meeting
  const [kind, setKind] = useState<MeetingKind>(m?.kind ?? 'recruiter_screen');
  const [state, setState] = useState<MeetingState>(m?.state ?? 'scheduled');
  const [ends, setEnds] = useState(toLocalInput(m?.ends_at));
  const [joinUrl, setJoinUrl] = useState(m?.join_url ?? '');
  const [location, setLocation] = useState(m?.location ?? '');
  const [agenda, setAgenda] = useState(m?.agenda ?? '');
  const [people, setPeople] = useState<Attendee[]>(m?.attendees ?? []);
  // email
  const [dir, setDir] = useState<'in' | 'out'>(em?.direction ?? 'in');
  const [category, setCategory] = useState<EmailCategory>(em?.category ?? 'scheduling');
  const [withName, setWithName] = useState(em?.counterpart_name ?? '');
  const [withEmail, setWithEmail] = useState(em?.counterpart_email ?? '');
  const [points, setPoints] = useState<string[]>(em?.key_points ?? []);
  const [link, setLink] = useState(em?.link ?? '');
  // note
  const [about, setAbout] = useState(ev?.parent_id ?? parentId ?? '');
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
    const ok = ev
      ? await act.patch(`/events/${ev.id}`, payload, 'Saved')
      : await act.post(`/applications/${appId}/${path}`, payload, 'Logged');
    setBusy(false);
    if (ok) sheets.close();
  }

  const valid = !!at && (type !== 'note' || body.trim().length > 0);

  return (
    <Sheet
      title={ev ? 'Edit' : 'Log to timeline'}
      sub={`${app.company} · ${app.title}`}
      onClose={sheets.close}
      footer={
        <>
          {ev && (
            <ConfirmButton
              className="left"
              confirm="Delete it?"
              onConfirm={async () =>
                (await act.del(`/events/${ev.id}`, 'Deleted')) && sheets.close()
              }
            >
              Delete
            </ConfirmButton>
          )}
          <button type="button" className="btn primary" disabled={!valid || busy} onClick={save}>
            {ev ? 'Save' : `Log ${type}`}
          </button>
        </>
      }
    >
      {!ev && (
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
      )}
      {ev?.source === 'agent' && (
        <p className="hint">Logged by {ev.source_name ?? 'an assistant'}. Edits here are yours.</p>
      )}

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
            <input
              className="in"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={meetingKindLabel(kind)}
            />
          </Field>
          <div className="two">
            <Field label="Starts">
              <input
                className="in"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </Field>
            <Field label="Ends">
              <input
                className="in"
                type="datetime-local"
                value={ends}
                onChange={(e) => setEnds(e.target.value)}
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
                placeholder="https://zoom.us/j/…"
              />
            </Field>
            <Field label="Or where">
              <input
                className="in"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Phone, office…"
              />
            </Field>
          </div>
          <Field label="Who">
            <div className="attendees">
              {people.map((p, i) => (
                <div key={i} className="three att">
                  <input
                    className="in"
                    value={p.name}
                    placeholder="Name"
                    aria-label="Name"
                    onChange={(e) =>
                      setPeople((l) =>
                        l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      )
                    }
                  />
                  <input
                    className="in"
                    value={p.title ?? ''}
                    placeholder="Title"
                    aria-label="Title"
                    onChange={(e) =>
                      setPeople((l) =>
                        l.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                      )
                    }
                  />
                  <div className="att-last">
                    <input
                      className="in"
                      value={p.email ?? ''}
                      placeholder="Email"
                      aria-label="Email"
                      onChange={(e) =>
                        setPeople((l) =>
                          l.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="xbtn"
                      aria-label="Remove"
                      onClick={() => setPeople((l) => l.filter((_, j) => j !== i))}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn sm"
                onClick={() => setPeople((l) => [...l, { name: '' }])}
              >
                <Icon name="plus" size={14} /> Add someone
              </button>
            </div>
          </Field>
          <Field label="Topics and format">
            <AutoTextarea
              className="in"
              rows={3}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder="Integration architecture, a 30-minute design exercise…"
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
              <input
                className="in"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </Field>
          </div>
          <div className="two">
            <Field label="With">
              <input
                className="in"
                value={withName}
                onChange={(e) => setWithName(e.target.value)}
                placeholder="Dana Ruiz"
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
            <TagInput
              value={points}
              onChange={setPoints}
              suggestions={[]}
              placeholder="Base: $205k → asked $225k"
            />
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
              placeholder="https://mail.google.com/…"
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
              placeholder="A thought, something they said, how it went…"
            />
          </Field>
          <div className="two">
            <Field label="Title (optional)">
              <input className="in" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="When">
              <input
                className="in"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
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
