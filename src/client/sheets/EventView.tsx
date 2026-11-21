// A timeline entry opened from its card: everything about it, each value edited right where
// it's shown (no separate edit form). A drawer on phones, a panel on wider screens. Meetings,
// emails, notes and files each have their own fields in the same layout; status changes and the
// job being added are written by the app and don't open.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  EMAIL_CATEGORIES,
  FILE_KINDS,
  MEETING_KINDS,
  meetingKindLabel,
  type EmailCategory,
  type FileKind,
  type MeetingKind,
  type MeetingState,
} from '@shared/lookups';
import type { Attendee, EmailData, MeetingData, TimelineEvent } from '@shared/types';
import { useActions, type Data } from '../lib/queries';
import { fileUrl } from '../lib/api';
import { bytes, fromLocalInput, rangeLabel, toLocalInput, whenLabel } from '../lib/format';
import { ConfirmButton, Sheet } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { DateTimeField } from '../components/DateTimePicker';
import {
  ChoiceEdit,
  EditActs,
  EditBox,
  LineEdit,
  TagsEdit,
  TextEdit,
  groupKeys,
} from '../components/edit';
import { AttendeesInput, eventLabel } from './EventSheet';
import { useSheets } from './context';

const STATES = [
  ['scheduled', 'Scheduled'],
  ['held', 'Held'],
  ['canceled', 'Canceled'],
] as const;
const KINDS = MEETING_KINDS.map((k) => [k.key, k.label] as const);
const CATEGORIES = EMAIL_CATEGORIES.map((c) => [c.key, c.label] as const);
const FILE_KIND_CHOICES = FILE_KINDS.map((k) => [k.key, k.label] as const);
const DIRECTIONS = [
  ['in', 'Received'],
  ['out', 'Sent'],
] as const;

/** A titled group of values, as on a job's Details. */
function Group({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <section className="card ev-group">
      <div className="card-h">
        <h3 className="sec-title">
          <Icon name={icon} size={18} /> {title}
        </h3>
      </div>
      <div className="kvs">{children}</div>
    </section>
  );
}

/** When it happened (and, for a meeting, when it ends), edited together with Save and Cancel. */
function WhenEdit({
  label,
  start,
  end,
  hasEnd,
  onSave,
}: {
  label: string;
  start: string;
  end?: string | null;
  /** A meeting: starts and ends. */
  hasEnd?: boolean;
  onSave: (start: string, end: string | null) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [s, setS] = useState('');
  const [e, setE] = useState('');
  const save = async () => {
    const a = fromLocalInput(s);
    if (!a) return;
    const b = fromLocalInput(e);
    if ((a === start && b === (end ?? null)) || (await onSave(a, b))) setEditing(false);
  };
  return (
    <EditBox
      label={label}
      full
      shown={hasEnd ? rangeLabel(start, end ?? null) : whenLabel(start)}
      editing={editing}
      onEdit={() => {
        setS(toLocalInput(start));
        setE(toLocalInput(end));
        setEditing(true);
      }}
    >
      <div {...groupKeys(save, () => setEditing(false), false)}>
        {hasEnd ? (
          <div className="two">
            <label className="mini-l">
              Starts
              <DateTimeField label="Starts" value={s} onChange={setS} />
            </label>
            <label className="mini-l">
              Ends
              <DateTimeField label="Ends" value={e} onChange={setE} optional fallback={s} />
            </label>
          </div>
        ) : (
          <DateTimeField label={label} value={s} onChange={setS} />
        )}
        <EditActs onSave={() => void save()} onCancel={() => setEditing(false)} />
      </div>
    </EditBox>
  );
}

/** Who was in the meeting: a name, title and email each, edited as one list. */
function AttendeesEdit({
  value,
  onSave,
}: {
  value: Attendee[];
  onSave: (v: Attendee[]) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<Attendee[]>([]);
  const save = async () => {
    const next = v.filter((p) => p.name.trim());
    if (JSON.stringify(next) === JSON.stringify(value) || (await onSave(next))) setEditing(false);
  };
  return (
    <EditBox
      label="Who"
      full
      shown={
        value.length ? (
          <span className="att-list">
            {value.map((p, i) => (
              <span key={i}>
                <strong>{p.name}</strong>
                {p.title ? ` · ${p.title}` : ''}
                {p.email ? <span className="sub"> · {p.email}</span> : null}
              </span>
            ))}
          </span>
        ) : null
      }
      editing={editing}
      onEdit={() => {
        setV(value.length ? value : [{ name: '' }]);
        setEditing(true);
      }}
    >
      <div {...groupKeys(save, () => setEditing(false))}>
        <AttendeesInput people={v} onChange={setV} />
        <EditActs onSave={() => void save()} onCancel={() => setEditing(false)} />
      </div>
    </EditBox>
  );
}

/** The notes written about a meeting or email, each opening on its own, and a way to add one. */
function NotesOn({
  ev,
  notes,
  appId,
}: {
  ev: TimelineEvent;
  notes: TimelineEvent[];
  appId: string;
}) {
  const sheets = useSheets();
  return (
    <section className="card ev-group">
      <div className="card-h">
        <h3 className="sec-title">
          <Icon name="note" size={18} /> Notes
        </h3>
        <button
          type="button"
          className="linkish"
          onClick={() => sheets.log(appId, { type: 'note', parentId: ev.id })}
        >
          + Add
        </button>
      </div>
      {notes.map((n) => (
        <button
          key={n.id}
          type="button"
          className="nested-note"
          onClick={() => sheets.log(appId, { eventId: n.id })}
        >
          <span className="lbl">{whenLabel(n.occurred_at)}</span>
          {n.title && <strong>{n.title}</strong>}
          <span className="pre">{n.body}</span>
        </button>
      ))}
      {!notes.length && <p className="sub">None yet.</p>}
    </section>
  );
}

export function EventView({ data, appId, ev }: { data: Data; appId: string; ev: TimelineEvent }) {
  const sheets = useSheets();
  const act = useActions();
  const app = data.appById.get(appId);
  if (!app) return null;
  const events = data.eventsByApp.get(appId) ?? [];
  const notes = events.filter((e) => e.parent_id === ev.id);
  const save = (body: Record<string, unknown>) => act.patch(`/events/${ev.id}`, body);
  const fileId = ev.type === 'note' ? (ev.data as { file_id?: string }).file_id : undefined;
  // From the timeline entry only; the file itself stays in Files.
  const noun = fileId ? 'timeline entry' : ev.type;

  let title: string;
  let groups: ReactNode;
  if (ev.type === 'meeting') {
    const d = ev.data as MeetingData;
    title = 'Meeting';
    groups = (
      <>
        {d.state === 'scheduled' && (
          <div className="acts ev-acts">
            <Link
              className="btn sm primary"
              to={`/a/${appId}/call?meeting=${ev.id}`}
              onClick={sheets.close}
            >
              Open Call Mode
            </Link>
            {d.join_url && (
              <a className="btn sm" href={d.join_url} target="_blank" rel="noreferrer">
                Join <Icon name="external" size={14} />
              </a>
            )}
          </div>
        )}
        <Group icon="video" title="The meeting">
          <LineEdit
            label="Name"
            full
            required
            value={ev.title || meetingKindLabel(d.kind)}
            onSave={(v) => save({ title: v })}
          />
          <ChoiceEdit
            label="Kind"
            value={d.kind}
            choices={KINDS}
            onSave={(v: MeetingKind) => save({ kind: v })}
          />
          <ChoiceEdit
            label="State"
            value={d.state}
            choices={STATES}
            onSave={(v: MeetingState) => save({ state: v })}
          />
          <WhenEdit
            label="When"
            hasEnd
            start={ev.occurred_at}
            end={d.ends_at}
            onSave={(s, e) => save({ occurred_at: s, ends_at: e })}
          />
          <LineEdit
            label="Join link"
            url
            value={d.join_url ?? ''}
            onSave={(v) => save({ join_url: v || null })}
          />
          <LineEdit label="Where" value={d.location ?? ''} onSave={(v) => save({ location: v })} />
        </Group>
        <Group icon="users" title="People">
          <AttendeesEdit value={d.attendees} onSave={(v) => save({ attendees: v })} />
        </Group>
        <Group icon="list" title="Prep">
          <TextEdit
            label="Topics and format"
            value={d.agenda ?? ''}
            onSave={(v) => save({ agenda: v })}
          />
          <TextEdit label="Other details" value={ev.body ?? ''} onSave={(v) => save({ body: v })} />
        </Group>
        <NotesOn ev={ev} notes={notes} appId={appId} />
      </>
    );
  } else if (ev.type === 'email') {
    const d = ev.data as EmailData;
    title = 'Email';
    groups = (
      <>
        <Group icon="mail" title="The email">
          <LineEdit
            label="Subject"
            full
            value={ev.title || d.subject || ''}
            onSave={(v) => save({ subject: v })}
          />
          <ChoiceEdit
            label="Sent or received"
            value={d.direction}
            choices={DIRECTIONS}
            onSave={(v) => save({ direction: v })}
          />
          <ChoiceEdit
            label="Category"
            value={d.category}
            choices={CATEGORIES}
            onSave={(v: EmailCategory) => save({ category: v })}
          />
          <WhenEdit label="When" start={ev.occurred_at} onSave={(s) => save({ occurred_at: s })} />
          <LineEdit
            label="Link to the email"
            url
            full
            value={d.link ?? ''}
            onSave={(v) => save({ link: v || null })}
          />
        </Group>
        <Group icon="user" title={d.direction === 'in' ? 'From' : 'To'}>
          <LineEdit
            label="Name"
            value={d.counterpart_name ?? ''}
            onSave={(v) => save({ counterpart_name: v })}
          />
          <LineEdit
            label="Email"
            email
            value={d.counterpart_email ?? ''}
            onSave={(v) => save({ counterpart_email: v })}
          />
        </Group>
        <Group icon="list" title="What happened">
          <TextEdit label="Summary" value={ev.body ?? ''} onSave={(v) => save({ body: v })} />
          <TagsEdit
            label="Key points"
            value={d.key_points}
            onSave={(v) => save({ key_points: v })}
          />
        </Group>
        <NotesOn ev={ev} notes={notes} appId={appId} />
      </>
    );
  } else if (fileId) {
    // A file being added: the file itself (its kind), and the timeline entry's title and notes.
    const f = data.state.files.find((x) => x.id === fileId);
    title = 'File';
    groups = (
      <>
        <div className="acts ev-acts">
          <a className="btn sm" href={fileUrl(fileId, true)} target="_blank" rel="noreferrer">
            Open file <Icon name="external" size={14} />
          </a>
        </div>
        <Group icon="file" title="The file">
          {f && (
            <div className="kv kv-full">
              <span className="kv-l">File</span>
              <span className="ev-file">
                {f.filename} <span className="sub">· {bytes(f.size)}</span>
              </span>
            </div>
          )}
          {f && (
            <ChoiceEdit
              label="Kind"
              value={f.kind}
              choices={FILE_KIND_CHOICES}
              onSave={(v: FileKind) => act.patch(`/files/${f.id}`, { kind: v })}
            />
          )}
          <WhenEdit label="Added" start={ev.occurred_at} onSave={(s) => save({ occurred_at: s })} />
        </Group>
        <Group icon="note" title="On the timeline">
          <LineEdit label="Title" full value={ev.title ?? ''} onSave={(v) => save({ title: v })} />
          <TextEdit
            label="Notes about it"
            value={ev.body ?? ''}
            onSave={(v) => save({ body: v })}
          />
        </Group>
      </>
    );
  } else {
    const parents = events.filter((e) => e.type === 'meeting' || e.type === 'email');
    title = 'Note';
    groups = (
      <Group icon="note" title="The note">
        <TextEdit
          label="Note"
          rows={5}
          required
          value={ev.body ?? ''}
          onSave={(v) => save({ body: v })}
        />
        <LineEdit label="Title" full value={ev.title ?? ''} onSave={(v) => save({ title: v })} />
        <WhenEdit label="When" start={ev.occurred_at} onSave={(s) => save({ occurred_at: s })} />
        {parents.length > 0 && (
          <ChoiceEdit
            label="About"
            full
            value={ev.parent_id ?? ''}
            choices={[
              ['', 'The job as a whole'],
              ...parents.map(
                (p) => [p.id, `${eventLabel(p)} · ${whenLabel(p.occurred_at)}`] as const,
              ),
            ]}
            onSave={(v) => save({ parent_id: v || null })}
          />
        )}
      </Group>
    );
  }

  return (
    <Sheet title={title} sub={`${app.company} · ${app.title}`} onClose={sheets.close}>
      <div className="ev-view">
        {groups}
        <div className="del-row">
          <ConfirmButton
            solid
            confirm={`Are you sure you want to delete this ${noun}?`}
            onConfirm={async () => (await act.del(`/events/${ev.id}`, 'Deleted')) && sheets.close()}
          >
            Delete {noun}
          </ConfirmButton>
        </div>
      </div>
    </Sheet>
  );
}
