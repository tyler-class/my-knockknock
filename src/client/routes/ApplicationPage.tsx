// One application on one page: the stage stepper (tap a stage to move there), every detail
// edited where it's shown (a pencil at the right of each), notes, the timeline, files and
// linked stories.
import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  CLOSED_STATUSES,
  FILE_KINDS,
  OPEN_STATUSES,
  SALARY_PERIODS,
  SOURCES,
  WORK_MODES,
  fileKindLabel,
  personRoleLabel,
  statusLabel,
  type FileKind,
  type SalaryPeriod,
  type Status,
} from '@shared/lookups';
import { stagesReached } from '@shared/logic/status';
import { withScheme } from '@shared/url';
import { SYNC_LABEL, frameworkOf, syncState } from '@shared/logic/stories';
import type { Application, JobStory } from '@shared/types';
import { useActions, useData, type Data } from '../lib/queries';
import { fileUrl, uploadFile } from '../lib/api';
import { bytes, compLabel, dayLabel, relDays } from '../lib/format';
import { useSheets } from '../sheets/context';
import { useViewState } from '../lib/viewState';
import { Timeline } from '../components/Timeline';
import { CLOSED_ICON, STATUS_ICON } from '../components/StatusChip';
import { Icon } from '../components/Icon';
import { StageBar } from '../components/StageBar';
import {
  AutoTextarea,
  ChoiceInput,
  ConfirmButton,
  Field,
  Select,
  Sheet,
  TagInput,
  cx,
} from '../components/ui';
import { useToast } from '../components/Toast';

const workModeLabel = (m: string) => WORK_MODES.find((w) => w.key === m)?.label ?? m;

/** Statuses that end an application: the Closed stage. */
const CLOSE_TYPES: Status[] = ['accepted', ...CLOSED_STATUSES];

/**
 * The stages left to right, ending with Closed. Tapping one opens the status sheet set to move
 * there (with an optional note); Closed asks how it ended.
 */
function Stepper({ a, data }: { a: Application; data: Data }) {
  const sheets = useSheets();
  const reached = stagesReached(data.eventsByApp.get(a.id) ?? []);
  const closed = CLOSE_TYPES.includes(a.status);
  return (
    <StageBar
      label="Stage"
      stages={[
        ...OPEN_STATUSES.map((s) => {
          const here = a.status === s;
          return {
            key: s,
            label: statusLabel(s),
            icon: STATUS_ICON[s],
            state: here
              ? ('here' as const)
              : reached.includes(s)
                ? ('done' as const)
                : ('todo' as const),
            disabled: here,
            title: here ? 'Current stage' : `Move to ${statusLabel(s)}`,
            onClick: () => sheets.status(a.id, s),
          };
        }),
        {
          key: 'closed',
          icon: closed ? STATUS_ICON[a.status] : CLOSED_ICON,
          label: closed ? (
            <>
              {statusLabel(a.status)}
              {a.closed_from && a.status !== 'accepted' && (
                <span className="step-sub">at {statusLabel(a.closed_from).toLowerCase()}</span>
              )}
            </>
          ) : (
            'Closed'
          ),
          state: closed ? ('here' as const) : ('todo' as const),
          tone: closed
            ? a.status === 'accepted'
              ? ('good' as const)
              : ('muted' as const)
            : undefined,
          title: 'Close it: accepted, rejected, declined or ghosted',
          onClick: () => sheets.status(a.id, 'closed'),
        },
      ]}
    />
  );
}

type EditKind = 'text' | 'date' | 'url' | 'mode';

const num = (s: string) => {
  const v = Number(s.replace(/[^0-9.]/g, ''));
  return s.trim() === '' || !Number.isFinite(v) ? null : v;
};

/**
 * One detail (or a small group that edits together) in its edit container: the value with a
 * pencil at the right. Tap either to edit in place.
 */
function EditBox({
  label,
  inferred,
  full,
  shown,
  editing,
  onEdit,
  children,
}: {
  label: string;
  inferred?: boolean;
  full?: boolean;
  /** What it shows when not editing; empty shows "Add". */
  shown: ReactNode;
  editing: boolean;
  onEdit: () => void;
  /** The editor. */
  children: ReactNode;
}) {
  const empty = shown == null || shown === '' || (Array.isArray(shown) && !shown.length);
  return (
    <div className={cx('kv ikv', full && 'kv-full')}>
      <span className="kv-l">
        {label}
        {inferred && (
          <span className="inferred" title="Inferred by an assistant, not read off the posting">
            inferred
          </span>
        )}
      </span>
      {editing ? (
        children
      ) : (
        <button
          type="button"
          className={cx('kv-v', empty && 'empty-v')}
          onClick={onEdit}
          aria-label={`${label}${empty ? ': not set' : ''}. Edit`}
        >
          <span>{empty ? 'Add' : shown}</span>
          <Icon name="edit" size={13} />
        </button>
      )}
    </div>
  );
}

/** Save and Cancel under a group editor (Enter saves, Escape cancels, where Enter is free). */
function EditActs({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return (
    <div className="acts mt-s">
      <button type="button" className="btn sm" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="btn sm primary" onClick={onSave}>
        Save
      </button>
    </div>
  );
}

/** Escape cancels; Enter saves unless something inside (a list, a tag field) used it. */
const groupKeys = (save: () => void, cancel: () => void, enterSaves = true) => ({
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancel();
    } else if (
      enterSaves &&
      e.key === 'Enter' &&
      (e.target as HTMLElement).tagName === 'INPUT' &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      save();
    }
  },
});

/**
 * One detail, edited where it's shown: tap the value (or "Add"), change it, and Enter or
 * leaving the field saves it. Escape puts it back.
 */
function InlineField({
  a,
  k,
  label,
  kind = 'text',
  display,
  inferred,
  placeholder,
  required,
  full,
}: {
  a: Application;
  k: keyof Application;
  /** Across the whole row (links). */
  full?: boolean;
  label: string;
  kind?: EditKind;
  display?: ReactNode;
  inferred?: boolean;
  placeholder?: string;
  /** Can't be emptied (title, company): an empty value puts the old one back. */
  required?: boolean;
}) {
  const act = useActions();
  const raw = (a[k] as string | null) ?? '';
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(raw);
  const begin = () => {
    setV(raw);
    setEditing(true);
  };
  const save = async (next = v) => {
    setEditing(false);
    if (next.trim() === raw || (required && !next.trim())) return;
    await act.patch(`/applications/${a.id}`, { [k]: next.trim() || null });
  };
  const shown = !raw
    ? null
    : (display ??
      (kind === 'url' ? (
        <a
          href={withScheme(raw)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {raw.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
        </a>
      ) : kind === 'date' ? (
        dayLabel(raw)
      ) : kind === 'mode' ? (
        workModeLabel(raw)
      ) : (
        raw
      )));
  return (
    <EditBox
      label={label}
      inferred={inferred}
      full={full}
      shown={shown}
      editing={editing}
      onEdit={begin}
    >
      {kind === 'mode' ? (
        // A themed dropdown: picking saves; Escape puts it back.
        <div
          className="inline-select"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(false);
            }
          }}
        >
          <Select
            value={raw}
            onChange={(v) => void save(v)}
            placeholder="Not set"
            groups={[
              {
                options: [
                  { value: '', label: 'Not set' },
                  ...WORK_MODES.map((w) => ({ value: w.key, label: w.label })),
                ],
              },
            ]}
          />
        </div>
      ) : (
        <input
          className="in sm"
          autoFocus
          type={kind === 'date' ? 'date' : 'text'}
          {...(kind === 'url'
            ? { inputMode: 'url', autoCapitalize: 'off', spellCheck: false }
            : {})}
          value={v}
          placeholder={placeholder}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setV(raw);
              setEditing(false);
            }
          }}
        />
      )}
    </EditBox>
  );
}

/** Pay edits as one group: min, max, per what, and the pay as written. */
function PayField({ a }: { a: Application }) {
  const act = useActions();
  const str = (n: number | null) => (n == null ? '' : String(n));
  const [editing, setEditing] = useState(false);
  const [lo, setLo] = useState('');
  const [hi, setHi] = useState('');
  const [period, setPeriod] = useState<SalaryPeriod>('year');
  const [text, setText] = useState('');
  const begin = () => {
    setLo(str(a.salary_min));
    setHi(str(a.salary_max));
    setPeriod(a.salary_period ?? 'year');
    setText(a.salary_text ?? '');
    setEditing(true);
  };
  const save = async () => {
    const body = {
      salary_min: num(lo),
      salary_max: num(hi),
      salary_period: num(lo) != null || num(hi) != null ? period : null,
      salary_text: text.trim() || null,
    };
    const same =
      body.salary_min === a.salary_min &&
      body.salary_max === a.salary_max &&
      body.salary_period === a.salary_period &&
      body.salary_text === (a.salary_text || null);
    if (same || (await act.patch(`/applications/${a.id}`, body))) setEditing(false);
  };
  return (
    <EditBox label="Pay" full shown={compLabel(a)} editing={editing} onEdit={begin}>
      <div {...groupKeys(save, () => setEditing(false))}>
        <div className="three">
          <input
            className="in sm"
            autoFocus
            inputMode="numeric"
            value={lo}
            onChange={(e) => setLo(e.target.value)}
            placeholder="Min"
            aria-label="Minimum"
          />
          <input
            className="in sm"
            inputMode="numeric"
            value={hi}
            onChange={(e) => setHi(e.target.value)}
            placeholder="Max"
            aria-label="Maximum"
          />
          <Select
            value={period}
            onChange={(v) => setPeriod(v as SalaryPeriod)}
            groups={[{ options: SALARY_PERIODS.map((p) => ({ value: p, label: `per ${p}` })) }]}
          />
        </div>
        <input
          className="in sm mt-s"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="As written: $205k + 15% bonus + equity"
          aria-label="Pay as written"
        />
        <EditActs onSave={() => void save()} onCancel={() => setEditing(false)} />
      </div>
    </EditBox>
  );
}

/** Where it came from: the usual sources as chips, or type one. */
function SourceField({ a }: { a: Application }) {
  const act = useActions();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  const save = async () => {
    const next = v.trim() || null;
    if (next === (a.source || null) || (await act.patch(`/applications/${a.id}`, { source: next })))
      setEditing(false);
  };
  return (
    <EditBox
      label="Source"
      full
      shown={a.source}
      editing={editing}
      onEdit={() => {
        setV(a.source ?? '');
        setEditing(true);
      }}
    >
      <div {...groupKeys(save, () => setEditing(false))}>
        <ChoiceInput small options={SOURCES} value={v} onChange={setV} />
        <EditActs onSave={() => void save()} onCancel={() => setEditing(false)} />
      </div>
    </EditBox>
  );
}

/** Must-haves or nice-to-haves: a list of short tags. */
function TagsField({
  a,
  k,
  label,
  dashed,
}: {
  a: Application;
  k: 'must_haves' | 'nice_to_haves';
  label: string;
  dashed?: boolean;
}) {
  const act = useActions();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<string[]>([]);
  const save = async () => {
    if (v.join('\n') === a[k].join('\n') || (await act.patch(`/applications/${a.id}`, { [k]: v })))
      setEditing(false);
  };
  return (
    <EditBox
      label={label}
      full
      shown={
        a[k].length ? (
          <span className="tags">
            {a[k].map((m) => (
              <span key={m} className={cx('tag', dashed && 'dashed')}>
                {m}
              </span>
            ))}
          </span>
        ) : null
      }
      editing={editing}
      onEdit={() => {
        setV(a[k]);
        setEditing(true);
      }}
    >
      <div {...groupKeys(save, () => setEditing(false), false)}>
        <TagInput value={v} onChange={setV} suggestions={[]} placeholder="Add one, press Enter" />
        <EditActs onSave={() => void save()} onCancel={() => setEditing(false)} />
      </div>
    </EditBox>
  );
}

/** Long text (notes, the job description), edited right where it's shown. */
function TextField({
  a,
  k,
  label,
  rows,
  fixed,
  placeholder,
  className,
}: {
  a: Application;
  k: 'notes' | 'description';
  label: string;
  rows: number;
  /** A fixed-height field for very long pasted text. */
  fixed?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const act = useActions();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  const save = async () => {
    const next = v.trim() ? v : null;
    if (next === (a[k] || null) || (await act.patch(`/applications/${a.id}`, { [k]: next })))
      setEditing(false);
  };
  const props = {
    className: 'in',
    rows,
    autoFocus: true,
    value: v,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setV(e.target.value),
  };
  return (
    <EditBox
      label={label}
      full
      shown={a[k] ? <span className={cx('pre', className)}>{a[k]}</span> : null}
      editing={editing}
      onEdit={() => {
        setV(a[k] ?? '');
        setEditing(true);
      }}
    >
      <div {...groupKeys(save, () => setEditing(false), false)}>
        {fixed ? <textarea {...props} /> : <AutoTextarea {...props} />}
        <EditActs onSave={() => void save()} onCancel={() => setEditing(false)} />
      </div>
    </EditBox>
  );
}

function Details({ a, data }: { a: Application; data: Data }) {
  const sheets = useSheets();
  const people = data.state.people.filter((p) => p.application_id === a.id);
  const inf = (k: string) => a.inferred.includes(k);
  return (
    // Two columns that each stack on their own (The job; Company, Notes, People), so a short card
    // isn't pushed down by a tall one beside it. One column on phones.
    <div className="details">
      <div className="details-col">
        <section className="card">
          <div className="card-h">
            <h2 className="sec-title">
              <Icon name="briefcase" size={18} /> The job
            </h2>
          </div>
          <div className="kvs">
            <InlineField a={a} k="title" label="Title" required />
            <InlineField a={a} k="company" label="Company" required />
            <PayField a={a} />
            <InlineField a={a} k="work_mode" label="Work mode" kind="mode" />
            <InlineField a={a} k="location" label="Location" placeholder="Remote (US)" />
            <InlineField
              a={a}
              k="seniority"
              label="Seniority"
              inferred={inf('seniority')}
              placeholder="Principal IC"
            />
            <InlineField
              a={a}
              k="reports_to"
              label="Reports to"
              inferred={inf('reports_to')}
              placeholder="VP Revenue Ops"
            />
            <InlineField a={a} k="team" label="Team" inferred={inf('team')} />
            <InlineField a={a} k="employment_type" label="Type" placeholder="Full-time" />
            <InlineField a={a} k="posted_on" label="Posted" kind="date" />
            <InlineField a={a} k="applied_on" label="Applied" kind="date" />
            <InlineField a={a} k="url" label="Job link" kind="url" placeholder="https://…" full />
            <SourceField a={a} />
            <TagsField a={a} k="must_haves" label="Must-haves" />
            <TagsField a={a} k="nice_to_haves" label="Nice-to-haves" dashed />
          </div>
        </section>
      </div>
      <div className="details-col">
        <section className="card">
          <div className="card-h">
            <h2 className="sec-title">
              <Icon name="building" size={18} /> Company
            </h2>
          </div>
          <div className="kvs">
            <InlineField a={a} k="company_domain" label="Domain" placeholder="fathom.com" />
            <InlineField a={a} k="company_hq" label="HQ" placeholder="Denver, CO" />
            <InlineField a={a} k="company_size" label="Size" placeholder="501–1,000" />
            <InlineField a={a} k="company_industry" label="Industry" />
            <InlineField a={a} k="company_funding" label="Funding" placeholder="Series D" />
            <InlineField
              a={a}
              k="company_website"
              label="Website"
              kind="url"
              placeholder="https://…"
            />
            <InlineField
              a={a}
              k="company_linkedin"
              label="LinkedIn"
              kind="url"
              placeholder="https://…"
            />
          </div>
        </section>
        <section className="card notes-card">
          <div className="card-h">
            <h2 className="sec-title">
              <Icon name="note" size={18} /> Notes
            </h2>
          </div>
          <div className="kvs">
            <TextField a={a} k="notes" label="Notes" rows={4} />
          </div>
        </section>
        <section className="card">
          <div className="card-h">
            <h2 className="sec-title">
              <Icon name="user" size={18} /> People
            </h2>
            <button type="button" className="linkish" onClick={() => sheets.person(a.id)}>
              + Add
            </button>
          </div>
          {people.map((p) => (
            <button
              key={p.id}
              type="button"
              className="person"
              onClick={() => sheets.person(a.id, p.id)}
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
                  {personRoleLabel(p)}
                  {p.title ? ` · ${p.title}` : ''}
                  {p.email ? ` · ${p.email}` : ''}
                </span>
              </span>
            </button>
          ))}
          {!people.length && <p className="sub">No one yet.</p>}
        </section>
      </div>
    </div>
  );
}

function StoriesSection({ a, data }: { a: Application; data: Data }) {
  const sheets = useSheets();
  const act = useActions();
  const list = data.state.job_stories
    .filter((j) => j.application_id === a.id)
    .sort((x, y) => x.position - y.position);
  const move = async (j: JobStory, dir: -1 | 1) => {
    const i = list.indexOf(j);
    const other = list[i + dir];
    if (!other) return;
    await act.patch(`/job-stories/${j.id}`, { position: other.position });
    await act.patch(`/job-stories/${other.id}`, { position: j.position });
  };
  return (
    <section className="sec" aria-label="Stories">
      <div className="sec-h">
        <h2>Stories {list.length ? `· ${list.length}` : ''}</h2>
        <div className="acts">
          <button type="button" className="btn sm" onClick={() => sheets.linkStory(a.id)}>
            <Icon name="plus" size={14} /> Link from Stories
          </button>
          <button type="button" className="btn sm" onClick={() => sheets.newStory(a.id)}>
            New story for this job
          </button>
          <Link className="btn sm" to={`/a/${a.id}/call`}>
            Call Mode
          </Link>
        </div>
      </div>
      <div className="card list">
        {list.map((j, i) => {
          const bank = data.state.stories.find((s) => s.id === j.story_id);
          const st = syncState(j, bank);
          return (
            <div key={j.id} className="story-line">
              <span className="fw-tag">
                {frameworkOf(j.framework_key, data.state.frameworks)?.name ?? j.framework_key}
              </span>
              <button
                type="button"
                className="sc-title"
                onClick={() => sheets.jobStory({ id: j.id })}
              >
                {j.title}
              </button>
              {SYNC_LABEL[st] && <span className={cx('sync', `sync-${st}`)}>{SYNC_LABEL[st]}</span>}
              <span className="acts">
                <button
                  type="button"
                  className="xbtn"
                  aria-label="Move up"
                  disabled={i === 0}
                  onClick={() => move(j, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="xbtn"
                  aria-label="Move down"
                  disabled={i === list.length - 1}
                  onClick={() => move(j, 1)}
                >
                  ↓
                </button>
              </span>
            </div>
          );
        })}
        {!list.length && (
          <p className="empty">
            None linked yet. Link your intro, your “why this job”, and the STAR stories that fit.
          </p>
        )}
      </div>
    </section>
  );
}

/** A guess at the kind from the file's name; it can be changed on the list. */
function guessKind(name: string): FileKind {
  const n = name.toLowerCase();
  if (/\.(vtt|srt)$/.test(n) || /transcript/.test(n)) return 'transcript';
  if (/cover/.test(n)) return 'cover_letter';
  if (/resume|résumé|\bcv\b/.test(n)) return 'resume';
  if (/offer/.test(n)) return 'offer';
  if (/posting|job.?desc/.test(n)) return 'posting';
  return 'other';
}

function PasteSheet({ a, data, onClose }: { a: Application; data: Data; onClose: () => void }) {
  const act = useActions();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<FileKind>('transcript');
  const [label, setLabel] = useState('');
  const [meeting, setMeeting] = useState('');
  const [busy, setBusy] = useState(false);
  const meetings = (data.eventsByApp.get(a.id) ?? []).filter((e) => e.type === 'meeting');
  const save = async () => {
    setBusy(true);
    const ok = await act.post(
      `/applications/${a.id}/text-files`,
      {
        text,
        kind,
        label: label || null,
        event_id: kind === 'transcript' && meeting ? meeting : null,
      },
      'Saved',
    );
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Sheet
      title="Paste text"
      sub={`${a.company} · saved as a text file your assistant can read`}
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn primary"
          disabled={!text.trim() || busy}
          onClick={save}
        >
          Save
        </button>
      }
    >
      <div className="two">
        <Field label="Kind">
          <Select
            value={kind}
            onChange={(v) => setKind(v as FileKind)}
            groups={[{ options: FILE_KINDS.map((k) => ({ value: k.key, label: k.label })) }]}
          />
        </Field>
        <Field label="Name (optional)">
          <input
            className="in"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Screen call"
          />
        </Field>
      </div>
      {kind === 'transcript' && meetings.length > 0 && (
        <Field label="Meeting">
          <Select
            value={meeting}
            onChange={setMeeting}
            groups={[
              {
                options: [
                  { value: '', label: 'Not tied to a meeting' },
                  ...meetings.map((m) => ({
                    value: m.id,
                    label: `${m.title ?? 'Meeting'} · ${dayLabel(m.occurred_at)}`,
                  })),
                ],
              },
            ]}
          />
        </Field>
      )}
      <Field label="Text">
        <textarea
          className="in"
          rows={12}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the call transcript from Zoom, Otter, Granola…"
        />
      </Field>
    </Sheet>
  );
}

function FilesSection({ a, data }: { a: Application; data: Data }) {
  const act = useActions();
  const toast = useToast();
  const [paste, setPaste] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const files = data.state.files
    .filter((f) => f.application_id === a.id)
    .sort((x, y) => y.created_at.localeCompare(x.created_at));
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    for (const f of [...list]) {
      try {
        await uploadFile(`/applications/${a.id}/files?kind=${guessKind(f.name)}`, f);
        toast({ text: `Added ${f.name}` });
      } catch (e) {
        toast({ text: (e as Error).message, tone: 'bad' });
      }
    }
    if (input.current) input.current.value = '';
    await act.refresh();
  }
  return (
    <section className="sec" aria-label="Files">
      <div className="sec-h">
        <h2>Files {files.length ? `· ${files.length}` : ''}</h2>
        <div className="acts">
          <button type="button" className="btn sm" onClick={() => input.current?.click()}>
            <Icon name="upload" size={14} /> Add file
          </button>
          <button type="button" className="btn sm" onClick={() => setPaste(true)}>
            <Icon name="note" size={14} /> Paste
          </button>
          <input
            ref={input}
            type="file"
            hidden
            multiple
            accept=".pdf,.docx,.txt,.md,.vtt,.srt,image/*"
            onChange={(e) => void upload(e.target.files)}
          />
        </div>
      </div>
      <div className="card list">
        {files.map((f) => (
          <div key={f.id} className="file-row">
            <Icon name="file" size={20} />
            <span className="row-text">
              <a href={fileUrl(f.id, true)} target="_blank" rel="noreferrer" className="file-name">
                {f.label ?? f.filename}
              </a>
              <span className="sub">
                {bytes(f.size)} · {relDays(f.created_at)}
                {a.resume_file_id === f.id ? ' · sent with this application' : ''}
              </span>
            </span>
            <span className="acts">
              <span className="file-kind">
                <Select
                  value={f.kind}
                  onChange={(v) => void act.patch(`/files/${f.id}`, { kind: v })}
                  groups={[{ options: FILE_KINDS.map((k) => ({ value: k.key, label: k.label })) }]}
                />
              </span>
              {f.kind === 'resume' && a.resume_file_id !== f.id && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() =>
                    act.patch(
                      `/applications/${a.id}`,
                      { resume_file_id: f.id },
                      'Marked as the one you sent',
                    )
                  }
                >
                  Sent this one
                </button>
              )}
              <button
                type="button"
                className="xbtn"
                aria-label={`Delete ${fileKindLabel(f.kind).toLowerCase()} ${f.filename}`}
                onClick={() => act.del(`/files/${f.id}`, 'Deleted')}
              >
                <Icon name="trash" size={16} />
              </button>
            </span>
          </div>
        ))}
        {!files.length && (
          <p className="empty">
            No files yet. Add a resume, cover letter or offer (PDF, Word, image or text), or paste a
            transcript.
          </p>
        )}
      </div>
      {paste && <PasteSheet a={a} data={data} onClose={() => setPaste(false)} />}
    </section>
  );
}

const TABS = [
  { key: 'details', label: 'Details', icon: 'list' },
  { key: 'timeline', label: 'Timeline', icon: 'clock' },
  { key: 'stories', label: 'Stories', icon: 'quote' },
  { key: 'files', label: 'Files', icon: 'file' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function ApplicationPage() {
  const { id = '' } = useParams();
  const data = useData();
  const sheets = useSheets();
  const act = useActions();
  const nav = useNavigate();
  // The open tab is remembered on this device and kept in the address (?tab=timeline).
  const [view, choose] = useViewState('kk:app-tab', { tab: 'details' });
  const tab: Tab = TABS.some((t) => t.key === view.tab) ? (view.tab as Tab) : 'details';
  if (!data) return null;
  const a = data.appById.get(id);
  if (!a)
    return (
      <div className="empty">
        That application is gone. <Link to="/pipeline">Back to the pipeline</Link>
      </div>
    );
  const events = data.eventsByApp.get(a.id) ?? [];
  const pay = compLabel(a);
  const counts: Record<Tab, number | null> = {
    details: null,
    timeline: events.length,
    stories: data.state.job_stories.filter((j) => j.application_id === a.id).length,
    files: data.state.files.filter((f) => f.application_id === a.id).length,
  };

  return (
    <div className="app-page">
      <div className="crumbs">
        <button
          type="button"
          className="linkish"
          onClick={() => (history.length > 1 ? nav(-1) : nav('/pipeline'))}
        >
          ‹ Pipeline
        </button>
      </div>
      <header className="app-head">
        <div className="app-head-text">
          <h1 className="title">{a.title}</h1>
          <div className="tags">
            <strong>{a.company}</strong>
            {pay && <span className="tag mono">{pay}</span>}
            {a.work_mode && <span className="tag">{workModeLabel(a.work_mode)}</span>}
            {a.location && <span className="tag">{a.location}</span>}
          </div>
        </div>
        <div className="acts">
          {a.url && (
            <a className="btn" href={withScheme(a.url)} target="_blank" rel="noreferrer">
              Posting <Icon name="external" size={14} />
            </a>
          )}
          <button type="button" className="btn primary" onClick={() => sheets.log(a.id)}>
            <Icon name="plus" size={16} /> Log
          </button>
        </div>
      </header>
      <Stepper a={a} data={data} />
      <div className="tabs" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className="tab"
            onClick={() => choose({ tab: t.key })}
          >
            <Icon name={t.icon} size={16} />
            {t.label}
            {counts[t.key] ? <span className="mono sub">{counts[t.key]}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="tab-panel">
        {tab === 'details' && (
          <>
            <Details a={a} data={data} />
            {/* The posting as pasted: the full text the details above were read from. */}
            <section className="card jd-card">
              <div className="card-h">
                <h2 className="sec-title">
                  <Icon name="file" size={18} /> Job description
                </h2>
                {a.description && <span className="sub">saved {dayLabel(a.created_at)}</span>}
              </div>
              <div className="kvs">
                <TextField
                  a={a}
                  k="description"
                  label="The posting"
                  rows={12}
                  fixed
                  className="jd"
                  placeholder="Paste the posting: the full text, for reference."
                />
              </div>
            </section>
            <div className="acts">
              <ConfirmButton
                confirm="Delete it and its timeline?"
                onConfirm={async () => {
                  if (await act.del(`/applications/${a.id}`, 'Deleted')) nav('/pipeline');
                }}
              >
                Delete application
              </ConfirmButton>
            </div>
          </>
        )}
        {tab === 'timeline' && <Timeline events={events} appId={a.id} />}
        {tab === 'stories' && <StoriesSection a={a} data={data} />}
        {tab === 'files' && <FilesSection a={a} data={data} />}
      </div>
    </div>
  );
}
