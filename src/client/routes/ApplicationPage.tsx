// One application on one page: the stage stepper (tap a stage to move there), every detail
// edited where it's shown (a pencil at the right of each), notes, the timeline, files and
// linked stories.
import { useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
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
  EMPLOYMENT_TYPES,
} from '@shared/lookups';
import { payRange } from '@shared/logic/pay';
import { withScheme } from '@shared/url';
import { SYNC_LABEL, frameworkOf, syncState } from '@shared/logic/stories';
import type { Application, FileRef, JobStory } from '@shared/types';
import { useActions, useData, type Data } from '../lib/queries';
import { api, fileUrl, uploadFile } from '../lib/api';
import { SortableRows } from '../components/SortableRows';
import { RemoveFromJob } from '../components/RemoveFromJob';
import './callmode.css';
import { useOpenFileRecord } from '../lib/fileRecord';
import { JobQuestions } from './JobQuestions';
import { FilledFirst, type FilledField } from '../components/FilledFirst';
import { compLabel, dayLabel, relDays } from '../lib/format';
import { shortDateLabel } from '../lib/dates';
import { DatePicker } from '../components/DateTimePicker';
import { useSheets } from '../sheets/context';
import { Timeline } from '../components/Timeline';
import { StatusIcon } from '../components/StatusChip';
import { Icon } from '../components/Icon';
import { StageBar } from '../components/StageBar';
import {
  AutoTextarea,
  ConfirmButton,
  ConfirmDialog,
  Field,
  Select,
  Sheet,
  cx,
} from '../components/ui';
import { useToast } from '../components/Toast';
import { EditActs, EditBox, groupKeys, shortUrl, TagsEdit } from '../components/edit';
import { CompanyLogo } from '../components/CompanyLogo';

const workModeLabel = (m: string) => WORK_MODES.find((w) => w.key === m)?.label ?? m;

/** Statuses that end an application: the Closed stage. */
const CLOSE_TYPES: Status[] = ['accepted', ...CLOSED_STATUSES];

/**
 * The stages left to right, ending with Closed. Tapping one opens the status sheet set to move
 * there (with an optional note); Closed asks how it ended.
 */
function Stepper({ a }: { a: Application }) {
  const sheets = useSheets();
  const closed = CLOSE_TYPES.includes(a.status);
  // Purely by position: the stages before the current one are done, the ones after are to come
  // (a job moved back a stage doesn't keep the later ones lit). A closed job's open stages all
  // count as done up to where it closed from.
  const at = closed
    ? OPEN_STATUSES.indexOf(a.closed_from ?? 'applied') + 1
    : OPEN_STATUSES.indexOf(a.status);
  return (
    <StageBar
      label="Stage"
      stages={[
        ...OPEN_STATUSES.map((s) => {
          const here = a.status === s;
          return {
            key: s,
            label: statusLabel(s),
            icon: <StatusIcon status={s} size={15} />,
            state: here
              ? ('here' as const)
              : OPEN_STATUSES.indexOf(s) < at
                ? ('done' as const)
                : ('todo' as const),
            disabled: here,
            title: here ? 'Current stage' : `Move to ${statusLabel(s)}`,
            onClick: () => sheets.status(a.id, s),
          };
        }),
        {
          key: 'closed',
          icon: <StatusIcon status={closed ? a.status : 'closed'} size={15} />,
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

type EditKind = 'text' | 'date' | 'url' | 'choice';

/** Choices for a pick-list detail, with "Not set" first and any other stored value kept. */
const choiceGroups = (options: { value: string; label: string }[], current: string) => [
  {
    options: [
      { value: '', label: 'Not set' },
      ...options,
      ...(current && !options.some((o) => o.value === current)
        ? [{ value: current, label: current }]
        : []),
    ],
  },
];
const WORK_MODE_CHOICES = WORK_MODES.map((w) => ({ value: w.key, label: w.label }));
const SOURCE_CHOICES = SOURCES.map((s) => ({ value: s, label: s }));
const EMPLOYMENT_CHOICES = EMPLOYMENT_TYPES.map((v) => ({ value: v, label: v }));
/** "1200" or "1000-5000 employees" with thousands separators: "1,200", "1,000-5,000 employees". */
const groupThousands = (s: string) =>
  s.replace(/\d[\d,]*/g, (n) => Number(n.replace(/,/g, '')).toLocaleString('en-US'));

/**
 * One detail, edited where it's shown: tap the value (or "Add"), change it, and Enter or
 * leaving the field saves it. Escape puts it back. Dates and pick lists open their calendar or
 * list straight away: a pick saves, and Escape or a tap outside leaves it as it was.
 */
function InlineField({
  a,
  k,
  label,
  kind = 'text',
  choices = [],
  display,
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
  /** The options for kind 'choice'. */
  choices?: { value: string; label: string }[];
  display?: ReactNode;
  placeholder?: string;
  /** Can't be emptied (title, company): an empty value puts the old one back. */
  required?: boolean;
}) {
  const act = useActions();
  const stored = (a[k] as string | null) ?? '';
  // What was just picked or typed, shown straight away until the save lands (the state is
  // refetched before the patch resolves), so the old value never flashes back in between.
  const [pending, setPending] = useState<string | null>(null);
  const raw = pending ?? stored;
  const [editing, setEditing] = useState(false);
  // A link is edited exactly as it's shown (short); unchanged, it keeps its stored form.
  const asShown = (x: string) => (kind === 'url' ? shortUrl(x) : x);
  const [v, setV] = useState(raw);
  const begin = () => {
    setV(asShown(raw));
    setEditing(true);
  };
  const save = async (next = v) => {
    setEditing(false);
    if (next.trim() === asShown(raw) || (required && !next.trim())) return;
    setPending(next.trim());
    await act.patch(`/applications/${a.id}`, { [k]: next.trim() || null });
    setPending(null);
  };
  const cancel = () => setEditing(false);
  const shown = !raw
    ? null
    : (display ??
      (kind === 'url' ? (
        // Shown short, as text: tapping it edits it; the new-tab button beside the label opens it.
        <span className="link-v">{raw.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
      ) : kind === 'date' ? (
        shortDateLabel(raw)
      ) : kind === 'choice' ? (
        (choices.find((c) => c.value === raw)?.label ?? raw)
      ) : (
        raw
      )));
  return (
    <EditBox
      label={label}
      href={kind === 'url' && raw ? raw : undefined}
      full={full}
      shown={shown}
      editing={editing}
      onEdit={begin}
    >
      {kind === 'choice' ? (
        <Select
          className="sm"
          autoOpen
          value={raw}
          onChange={(next) => void save(next)}
          onClose={cancel}
          placeholder="Not set"
          groups={choiceGroups(choices, raw)}
        />
      ) : kind === 'date' ? (
        <DatePicker
          className="sm"
          label={label}
          autoOpen
          clearable={!required}
          value={raw || null}
          onChange={(next) => void save(next ?? '')}
          onDismiss={cancel}
        />
      ) : (
        <input
          className="in sm"
          autoFocus
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

/**
 * Pay edits as one group: a range (min, max, per what) and a note on pay (bonus, equity, the
 * posting's own words). Either, both or neither can be set; min and max swap if entered backwards.
 */
/**
 * The posting as pasted, at the end of The Job: about eight lines, with Show full posting to read
 * the rest in place. Editing works as for any long text.
 */
function PostingField({ a }: { a: Application }) {
  const [full, setFull] = useState(false);
  const text = a.description ?? '';
  const long = text.length > 700 || text.split('\n').length > 9;
  return (
    <div className={cx('posting kv-full', long && !full && 'clamped')}>
      <TextField
        a={a}
        k="description"
        label="Full job description"
        rows={12}
        fixed
        className="jd"
      />
      {long && (
        <button
          type="button"
          className="linkish more"
          aria-expanded={full}
          onClick={() => setFull((f) => !f)}
        >
          {full ? 'Show less' : 'Show full posting'}
        </button>
      )}
    </div>
  );
}

/**
 * The Job's fields in one column: those with something in them, then Show more for the empty
 * ones (to fill in). A field filled in moves up among the others; the title is always there.
 */
function JobFields({ a }: { a: Application }) {
  const fields: FilledField[] = [
    { key: 'title', filled: true, el: <InlineField a={a} k="title" label="Title" required full /> },
    {
      key: 'pay',
      filled: a.salary_min != null || a.salary_max != null || !!a.salary_text,
      el: <PayField a={a} />,
    },
    {
      key: 'url',
      filled: !!a.url,
      el: <InlineField a={a} k="url" label="Job link" kind="url" full />,
    },
    {
      key: 'source',
      filled: !!a.source,
      el: <InlineField a={a} k="source" label="Source" kind="choice" choices={SOURCE_CHOICES} />,
    },
    {
      key: 'employment_type',
      filled: !!a.employment_type,
      el: (
        <InlineField
          a={a}
          k="employment_type"
          label="Employment type"
          kind="choice"
          choices={EMPLOYMENT_CHOICES}
        />
      ),
    },
    {
      key: 'work_mode',
      filled: !!a.work_mode,
      el: (
        <InlineField
          a={a}
          k="work_mode"
          label="Work mode"
          kind="choice"
          choices={WORK_MODE_CHOICES}
        />
      ),
    },
    {
      key: 'location',
      filled: !!a.location,
      el: <InlineField a={a} k="location" label="Location" />,
    },
    { key: 'team', filled: !!a.team, el: <InlineField a={a} k="team" label="Team" /> },
    {
      key: 'reports_to',
      filled: !!a.reports_to,
      el: <InlineField a={a} k="reports_to" label="Reports to" />,
    },
    {
      key: 'must_haves',
      filled: a.must_haves.length > 0,
      el: <TagsField a={a} k="must_haves" label="Required qualifications" />,
    },
    {
      key: 'nice_to_haves',
      filled: a.nice_to_haves.length > 0,
      el: <TagsField a={a} k="nice_to_haves" label="Preferred qualifications" />,
    },
    { key: 'description', filled: !!a.description, el: <PostingField a={a} /> },
  ];
  return <FilledFirst fields={fields} />;
}

function PayField({ a }: { a: Application }) {
  const act = useActions();
  const str = (n: number | null) => (n == null ? '' : groupThousands(String(n)));
  // Typing plain digits groups them as you go ("444333" → "444,333"); "150k" is left as typed.
  const grouped = (v: string) => (/^[\d,]*$/.test(v) ? groupThousands(v.replace(/,/g, '')) : v);
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
    const [min, max] = payRange(lo, hi);
    const ranged = min != null || max != null;
    const body = {
      salary_min: min,
      salary_max: max,
      salary_period: ranged ? period : null,
      ...(ranged && !a.salary_currency ? { salary_currency: 'USD' } : {}),
      salary_text: text.trim() || null,
    };
    const same =
      body.salary_min === a.salary_min &&
      body.salary_max === a.salary_max &&
      body.salary_period === a.salary_period &&
      body.salary_text === (a.salary_text?.trim() || null);
    if (same || (await act.patch(`/applications/${a.id}`, body))) setEditing(false);
  };
  return (
    <EditBox label="Pay" full shown={compLabel(a, true)} editing={editing} onEdit={begin}>
      <div className="pay-edit" {...groupKeys(save, () => setEditing(false))}>
        <div className="pay-range">
          <label className="mini-l">
            Min
            <input
              className="in sm"
              autoFocus
              inputMode="decimal"
              value={lo}
              onChange={(e) => setLo(grouped(e.target.value))}
            />
          </label>
          <label className="mini-l">
            Max
            <input
              className="in sm"
              inputMode="decimal"
              value={hi}
              onChange={(e) => setHi(grouped(e.target.value))}
            />
          </label>
          <div className="mini-l">
            Per
            <Select
              className="sm"
              value={period}
              onChange={(v) => setPeriod(v as SalaryPeriod)}
              groups={[{ options: SALARY_PERIODS.map((p) => ({ value: p, label: p })) }]}
            />
          </div>
        </div>
        <label className="mini-l mt-s">
          Notes on pay (bonus, equity…)
          <input className="in sm" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <EditActs onSave={() => void save()} onCancel={() => setEditing(false)} />
      </div>
    </EditBox>
  );
}

/**
 * The job's company, read only: a preview of its own record (logo, name with its website, and
 * whichever details are filled in). Open company changes it.
 */
function CompanyCard({ a, data }: { a: Application; data: Data }) {
  const here = useLocation();
  const c = data.state.companies.find((x) => x.id === a.company_id);
  const rows: [string, ReactNode][] = c
    ? (
        [
          ['Headquarters', c.hq],
          ['Size', c.size ? groupThousands(c.size) : null],
          ['Industry', c.industry],
          ['Funding', c.funding],
          ['LinkedIn', c.linkedin ? shortUrl(c.linkedin) : null],
        ] as [string, ReactNode][]
      ).filter(([, v]) => v != null && v !== '')
    : [];
  return (
    <section className="card co-card">
      <div className="card-h">
        <h2 className="sec-title">
          <Icon name="building" size={18} /> Company
        </h2>
        {c && (
          // The company page's back link comes back to this job.
          <Link
            className="btn sm"
            to={`/c/${c.id}`}
            state={{ from: { href: here.pathname + here.search, label: a.title || a.company } }}
          >
            Open company <Icon name="chevRight" size={14} />
          </Link>
        )}
      </div>
      <div className="co-lookup">
        <span className={c?.has_logo ? 'co-mark has-img' : 'co-mark'}>
          {c ? <CompanyLogo company={c} size={40} /> : <Icon name="building" size={18} />}
        </span>
        <div className="co-name">
          <strong>{c?.name ?? a.company}</strong>
          {c?.website && (
            <a
              href={withScheme(c.website)}
              target="_blank"
              rel="noreferrer"
              className="pill co-web"
              aria-label={`Open the website (${shortUrl(c.website)}) in a new tab`}
            >
              Website <Icon name="external" size={12} />
            </a>
          )}
        </div>
      </div>
      {rows.length > 0 && (
        <div className="kvs co-kvs">
          {rows.map(([l, v]) => (
            <div key={l} className="kv">
              <span className="kv-l">
                {l}
                {/* A link opens from the round new-tab button beside its label, as elsewhere. */}
                {l === 'LinkedIn' && c?.linkedin && (
                  <a
                    className="kv-open"
                    href={withScheme(c.linkedin)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open LinkedIn in a new tab"
                    title="Open in a new tab"
                  >
                    <Icon name="external" size={12} />
                  </a>
                )}
              </span>
              <span className="kv-ro">{v}</span>
            </div>
          ))}
        </div>
      )}
      <OtherJobsHere a={a} data={data} />
    </section>
  );
}

/** Other jobs you have at the same company, as links (nothing when there are none). */
function OtherJobsHere({ a, data }: { a: Application; data: Data }) {
  const others = a.company_id
    ? data.state.applications.filter((x) => x.company_id === a.company_id && x.id !== a.id)
    : [];
  if (!others.length) return null;
  return (
    <div className="kv kv-full">
      <span className="kv-l">Other jobs here</span>
      <span className="co-others">
        {others.map((x) => (
          <Link key={x.id} to={`/a/${x.id}`} className="pill">
            {x.title}
          </Link>
        ))}
      </span>
    </div>
  );
}

/** Must-haves or nice-to-haves: a list of short tags. */
function TagsField({
  a,
  k,
  label,
}: {
  a: Application;
  k: 'must_haves' | 'nice_to_haves';
  label: string;
}) {
  const act = useActions();
  return (
    <TagsEdit
      label={label}
      quals={k === 'must_haves' ? 'required' : 'preferred'}
      value={a[k]}
      onSave={(v) => act.patch(`/applications/${a.id}`, { [k]: v })}
    />
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
    // The same class as the shown text (e.g. .jd), so the editor's type matches it exactly.
    className: cx('in', className),
    // A growing editor starts at one row and grows to the text, so it opens exactly as tall as
    // the text was shown; the fixed one (the job description) keeps its rows.
    rows: fixed ? rows : 1,
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
  const people = data.state.people.filter((p) => p.application_ids.includes(a.id));
  return (
    // Two columns that each stack on their own (The job; Company, People, Notes), so a short card
    // isn't pushed down by a tall one beside it. One column on phones.
    <div className="details">
      <div className="details-col">
        <section className="card">
          <div className="card-h">
            <h2 className="sec-title">
              <Icon name="briefcase" size={18} /> The Job
            </h2>
          </div>
          <JobFields a={a} />
        </section>
      </div>
      <div className="details-col">
        <CompanyCard a={a} data={data} />
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
              // An outlined card, like the company page's people and jobs.
              className="person prow dir-row"
              onClick={() => sheets.person(a.id, p.id)}
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
                    {p.title && <span className="pill">{p.title}</span>}
                    {personRoleLabel(p) && <span className="pill">{personRoleLabel(p)}</span>}
                  </span>
                )}
              </span>
            </button>
          ))}
          {!people.length && <p className="sub">No one yet.</p>}
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
      </div>
    </div>
  );
}

function StoriesSection({ a, data }: { a: Application; data: Data }) {
  const sheets = useSheets();
  const act = useActions();
  const saved = data.state.job_stories
    .filter((j) => j.application_id === a.id)
    .sort((x, y) => x.position - y.position);
  // Drag a story by its grip to reorder: shown at once, then each moved one saved.
  const [order, setOrder] = useState<string[] | null>(null);
  const list = order
    ? order.map((id) => saved.find((j) => j.id === id)).filter((j): j is JobStory => !!j)
    : saved;
  const reorder = (next: JobStory[]) => {
    setOrder(next.map((j) => j.id));
    void act
      .run(async () => {
        for (const [i, j] of next.entries())
          if (j.position !== i) await api.patch(`/job-stories/${j.id}`, { position: i });
      })
      .finally(() => setOrder(null));
  };
  return (
    <section className="sec" aria-label="Stories">
      <div className="sec-h">
        <h2>Stories {list.length ? `· ${list.length}` : ''}</h2>
        <div className="acts">
          <button type="button" className="btn sm" onClick={() => sheets.linkStory(a.id)}>
            <Icon name="link" size={14} /> Link from Stories
          </button>
          <button type="button" className="btn sm" onClick={() => sheets.newStory(a.id)}>
            <Icon name="plus" size={14} /> New story for this job
          </button>
        </div>
      </div>
      <div className="card list">
        <SortableRows items={list} onReorder={reorder}>
          {(j, grip) => {
            const bank = data.state.stories.find((s) => s.id === j.story_id);
            const st = syncState(j, bank);
            return (
              <div className="story-line">
                {grip}
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
                {/* A story only on this job offers Save to bank (as a question does); the others
                    say how they stand against the bank, if anything's different. */}
                {st === 'job_only' ? (
                  <button
                    type="button"
                    className="cmq-tag cmq-tag-btn cmq-tag-grey sync"
                    onClick={() =>
                      void act.post(
                        `/job-stories/${j.id}/save-as-new`,
                        { once: true },
                        'Saved to Stories',
                      )
                    }
                  >
                    Save to bank
                  </button>
                ) : (
                  SYNC_LABEL[st] && (
                    <span className={cx('sync', `sync-${st}`)}>{SYNC_LABEL[st]}</span>
                  )
                )}
                <RemoveFromJob
                  fromBank={!!j.story_id}
                  what="story"
                  onRemove={() =>
                    act.del(
                      `/job-stories/${j.id}`,
                      j.story_id ? 'Removed from this job' : 'Deleted',
                    )
                  }
                />
              </div>
            );
          }}
        </SortableRows>
        {!list.length && (
          <p className="empty">
            None linked yet. Link your intro, your “why this job”, and the STAR stories that fit.
          </p>
        )}
      </div>
    </section>
  );
}

/** A guess at the kind from the file's name; it can be changed in its record. */
export function guessKind(name: string): FileKind {
  const n = name.toLowerCase();
  if (/\.(vtt|srt)$/.test(n) || /transcript/.test(n)) return 'transcript';
  if (/cover/.test(n)) return 'cover_letter';
  if (/resume|résumé|\bcv\b/.test(n)) return 'resume';
  if (/offer/.test(n)) return 'offer';
  if (/posting|job.?desc/.test(n)) return 'posting';
  return 'other';
}

/** Text pasted in as a file: on a job (appId), or on none (from Files). */
export function PasteSheet({
  appId,
  data,
  onClose,
}: {
  appId: string | null;
  data: Data;
  onClose: () => void;
}) {
  const act = useActions();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<FileKind>('transcript');
  const [label, setLabel] = useState('');
  const [meeting, setMeeting] = useState('');
  const [busy, setBusy] = useState(false);
  const meetings = appId
    ? (data.eventsByApp.get(appId) ?? []).filter((e) => e.type === 'meeting')
    : [];
  const save = async () => {
    setBusy(true);
    const ok = await act.post(
      appId ? `/applications/${appId}/text-files` : '/text-files',
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
      title="Paste Text"
      icon="paperclip"
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
          <input className="in" value={label} onChange={(e) => setLabel(e.target.value)} />
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
        <textarea className="in" rows={12} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
    </Sheet>
  );
}

/** A file you already have (on another job, or none), linked to this job too. */
function LinkFileSheet({ a, data, onClose }: { a: Application; data: Data; onClose: () => void }) {
  const act = useActions();
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const jobName = (id: string) => {
    const x = data.appById.get(id);
    return x ? `${x.company} · ${x.title}` : null;
  };
  const list = data.state.files
    .filter((f) => !f.application_ids.includes(a.id))
    .filter(
      (f) =>
        !ql ||
        [f.label, f.filename, fileKindLabel(f.kind), ...f.application_ids.map(jobName)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(ql),
    )
    .sort((x, y) => y.created_at.localeCompare(x.created_at));
  const link = async (id: string) => {
    if (await act.post(`/applications/${a.id}/files/${id}`, {}, 'Linked to this job')) onClose();
  };
  return (
    <Sheet title="Link a File" icon="paperclip" onClose={onClose}>
      <label className="search-in search-full">
        <Icon name="search" size={16} />
        <input
          autoFocus
          value={q}
          placeholder="Search files"
          aria-label="Search files"
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <div className="pick-list" role="listbox" aria-label="Files">
        {list.map((f) => (
          <button
            key={f.id}
            type="button"
            role="option"
            aria-selected={false}
            className="person"
            onClick={() => void link(f.id)}
          >
            <span className="avatar">
              <Icon name="paperclip" size={15} />
            </span>
            <span className="row-text">
              <strong>{f.label ?? f.filename}</strong>
              <span className="sub">
                {[fileKindLabel(f.kind), dayLabel(f.created_at), ...f.application_ids.map(jobName)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </button>
        ))}
        {!list.length && <p className="sub">{ql ? 'Nothing matches.' : 'No other files yet.'}</p>}
      </div>
    </Sheet>
  );
}

function FilesSection({ a, data }: { a: Application; data: Data }) {
  const openRecord = useOpenFileRecord();
  // The file waiting on "Are you sure?" before it's deleted.
  const [doomed, setDoomed] = useState<FileRef | null>(null);
  const act = useActions();
  const toast = useToast();
  const [paste, setPaste] = useState(false);
  const [linking, setLinking] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const files = data.state.files
    .filter((f) => f.application_ids.includes(a.id))
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
      {/* Adding sits first, right under the tabs: drop a file on the bar, choose one, or paste text. */}
      <div
        className={drag ? 'file-drop over' : 'file-drop'}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <Icon name="upload" size={20} />
        <span className="file-drop-t">
          <strong>Add a file</strong>
        </span>
        <div className="acts">
          <button type="button" className="btn sm" onClick={() => input.current?.click()}>
            <Icon name="upload" size={14} /> Upload file
          </button>
          <button type="button" className="btn sm" onClick={() => setPaste(true)}>
            <Icon name="compose" size={14} /> Paste text as file
          </button>
          <button type="button" className="btn sm" onClick={() => setLinking(true)}>
            <Icon name="link" size={14} /> Link existing
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
      {files.length > 0 && (
        <div className="card list">
          {files.map((f) => (
            // A card, as on Files: it opens the file's record (name, kind, comment); Open file
            // beside its name opens the file itself.
            <div
              key={f.id}
              role="button"
              tabIndex={0}
              className="prow dir-row"
              onClick={() => openRecord(f, a.id)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault();
                openRecord(f, a.id);
              }}
            >
              <span className="co-mark">
                <Icon name="paperclip" size={18} />
              </span>
              <span className="row-text">
                <span className="file-line">
                  <strong className="file-title">{f.label ?? f.filename}</strong>
                  <a
                    className="pill open-file"
                    href={fileUrl(f.id, true)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open file <Icon name="external" size={12} />
                  </a>
                </span>
                <span className="prow-pills">
                  <span className="pill">{fileKindLabel(f.kind)}</span>
                  <span className="pill">{relDays(f.created_at)}</span>
                  {a.resume_file_id === f.id && (
                    <span className="pill">Sent with this application</span>
                  )}
                </span>
              </span>
              <span className="acts" onClick={(e) => e.stopPropagation()}>
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
                  // On other jobs too: off this one only. Else the file goes (asks first).
                  aria-label={
                    f.application_ids.length > 1
                      ? `Remove ${f.filename} from this job`
                      : `Delete ${fileKindLabel(f.kind).toLowerCase()} ${f.filename}`
                  }
                  onClick={() =>
                    f.application_ids.length > 1
                      ? void act.del(`/applications/${a.id}/files/${f.id}`, 'Removed from this job')
                      : setDoomed(f)
                  }
                >
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {paste && <PasteSheet appId={a.id} data={data} onClose={() => setPaste(false)} />}
      {linking && <LinkFileSheet a={a} data={data} onClose={() => setLinking(false)} />}
      {doomed && (
        <ConfirmDialog
          question={`Are you sure you want to delete ${doomed.filename}?`}
          action="Delete file"
          onCancel={() => setDoomed(null)}
          onConfirm={() => {
            setDoomed(null);
            void act.del(`/files/${doomed.id}`, 'Deleted');
          }}
        />
      )}
    </section>
  );
}

const TABS = [
  { key: 'details', label: 'Details', icon: 'list' },
  { key: 'timeline', label: 'Timeline', icon: 'clock' },
  { key: 'stories', label: 'Stories', icon: 'quote' },
  { key: 'questions', label: 'Questions', icon: 'question' },
  { key: 'files', label: 'Files', icon: 'paperclip' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function ApplicationPage() {
  const { id = '' } = useParams();
  const data = useData();
  const sheets = useSheets();
  const act = useActions();
  const nav = useNavigate();
  // A job always opens on Details; the open tab lives only in the address (?tab=timeline), so a
  // link to a timeline entry or a reload keeps it, but opening a job never lands elsewhere.
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab: Tab = TABS.some((t) => t.key === asked) ? (asked as Tab) : 'details';
  const choose = ({ tab: t }: { tab: Tab }) =>
    setParams(
      (p) => {
        const q = new URLSearchParams(p);
        if (t === 'details') q.delete('tab');
        else q.set('tab', t);
        return q;
      },
      { replace: true },
    );
  if (!data) return null;
  const a = data.appById.get(id);
  if (!a)
    return (
      <div className="empty">
        That application is gone. <Link to="/jobs">Back to Jobs</Link>
      </div>
    );
  const events = data.eventsByApp.get(a.id) ?? [];
  const pay = compLabel(a);
  const counts: Record<Tab, number | null> = {
    details: null,
    timeline: events.length,
    stories: data.state.job_stories.filter((j) => j.application_id === a.id).length,
    questions: data.state.job_questions.filter((j) => j.application_id === a.id).length,
    files: data.state.files.filter((f) => f.application_ids.includes(a.id)).length,
  };

  return (
    <div className="app-page">
      <div className="crumbs">
        <button
          type="button"
          className="linkish"
          onClick={() => (history.length > 1 ? nav(-1) : nav('/jobs'))}
        >
          ‹ Jobs
        </button>
        {a.url && (
          <a className="btn sm" href={withScheme(a.url)} target="_blank" rel="noreferrer">
            Posting <Icon name="external" size={14} />
          </a>
        )}
      </div>
      {/* The job, its company (bold) with how it works and when you applied, the two things to do
          next, and the stage bar, in one card. The status is the stage bar's: no separate pill. */}
      <header className="card app-head">
        <div className="app-head-top">
          <div className="app-head-text">
            <h1 className="title">{a.title}</h1>
            <p className="app-meta">
              <strong className="app-co">{a.company}</strong>
              {/* Each with its icon: how it works, where, when you applied, the pay. */}
              {a.work_mode && (
                <span>
                  <Icon name="briefcase" size={14} />
                  {workModeLabel(a.work_mode)}
                </span>
              )}
              {a.location && a.work_mode !== 'remote' && (
                <span>
                  <Icon name="pin" size={14} />
                  {a.location}
                </span>
              )}
              {a.applied_on && (
                <span>
                  <Icon name="send" size={14} />
                  Applied {shortDateLabel(a.applied_on)}
                </span>
              )}
              {pay && (
                <span className="mono">
                  <Icon name="coin" size={14} />
                  {pay}
                </span>
              )}
            </p>
          </div>
          <div className="acts app-acts">
            <Link className="btn sm" to={`/a/${a.id}/call`}>
              <Icon name="handset" size={16} /> Call Mode
            </Link>
            <button type="button" className="btn sm primary" onClick={() => sheets.log(a.id)}>
              <Icon name="plus" size={16} /> Log to timeline
            </button>
          </div>
        </div>
        <Stepper a={a} />
      </header>
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
            {counts[t.key] ? <span className="count">{counts[t.key]}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="tab-panel">
        {tab === 'details' && (
          <>
            <Details a={a} data={data} />
            <div className="del-row">
              <ConfirmButton
                solid
                confirm="Are you sure you want to delete this job?"
                onConfirm={async () => {
                  if (await act.del(`/applications/${a.id}`, 'Deleted')) nav('/jobs');
                }}
              >
                Delete application
              </ConfirmButton>
            </div>
          </>
        )}
        {tab === 'timeline' && <Timeline events={events} appId={a.id} />}
        {tab === 'stories' && <StoriesSection a={a} data={data} />}
        {tab === 'questions' && <JobQuestions a={a} data={data} />}
        {tab === 'files' && <FilesSection a={a} data={data} />}
      </div>
    </div>
  );
}
