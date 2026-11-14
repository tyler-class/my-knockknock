import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  FILE_KINDS,
  OPEN_STATUSES,
  fileKindLabel,
  isOpen,
  roleLabel,
  stageIndex,
  statusLabel,
  type FileKind,
} from '@shared/lookups';
import { stagesReached } from '@shared/logic/status';
import { SYNC_LABEL, frameworkOf, syncState } from '@shared/logic/stories';
import type { Application, JobStory } from '@shared/types';
import { useActions, useData, type Data } from '../lib/queries';
import { fileUrl, uploadFile } from '../lib/api';
import { bytes, compLabel, dayLabel, relDays } from '../lib/format';
import { useSheets } from '../sheets/context';
import { Timeline } from '../components/Timeline';
import { CompanyMark, StatusChip } from '../components/StatusChip';
import { Icon } from '../components/Icon';
import { Field, Select, SlideToggle, cx } from '../components/ui';
import { useToast } from '../components/Toast';

type Tab = 'timeline' | 'stories' | 'details' | 'files';

function Stepper({ a, data }: { a: Application; data: Data }) {
  const reached = stagesReached(data.eventsByApp.get(a.id) ?? []);
  const steps = [...OPEN_STATUSES, 'accepted' as const];
  const closed = !isOpen(a.status) && a.status !== 'accepted';
  return (
    <ol className="stepper" aria-label="Progress">
      {steps.map((s) => {
        const done = reached.includes(s);
        const here = a.status === s;
        return (
          <li
            key={s}
            className={cx(done && 'done', here && 'here')}
            aria-current={here ? 'step' : undefined}
          >
            <span>
              {done && !here ? '✓ ' : ''}
              {statusLabel(s)}
            </span>
          </li>
        );
      })}
      {closed && (
        <li className="here closed">
          <StatusChip status={a.status} small />
          {a.closed_from && (
            <span className="sub"> at {statusLabel(a.closed_from).toLowerCase()}</span>
          )}
        </li>
      )}
    </ol>
  );
}

function Details({ a, data }: { a: Application; data: Data }) {
  const sheets = useSheets();
  const people = data.state.people.filter((p) => p.application_id === a.id);
  const inferred = (k: string) =>
    a.inferred.includes(k) ? (
      <span className="inferred" title="Inferred by an assistant, not read off the posting">
        inferred
      </span>
    ) : null;
  const kv = (label: string, v: string | null | undefined, k?: string) =>
    v ? (
      <div className="kv">
        <span>
          {label} {k && inferred(k)}
        </span>
        <span>{v}</span>
      </div>
    ) : null;
  return (
    <div className="details">
      <section className="card">
        <div className="card-h">
          <span className="lbl">The job</span>
          <button type="button" className="linkish" onClick={() => sheets.editApp(a.id)}>
            Edit
          </button>
        </div>
        <div className="kvs">
          {kv('Pay', compLabel(a))}
          {kv(
            'Work mode',
            a.work_mode &&
              (a.work_mode === 'onsite'
                ? 'On-site'
                : a.work_mode[0]!.toUpperCase() + a.work_mode.slice(1)),
          )}
          {kv('Location', a.location)}
          {kv('Seniority', a.seniority, 'seniority')}
          {kv('Reports to', a.reports_to, 'reports_to')}
          {kv('Team', a.team, 'team')}
          {kv('Type', a.employment_type)}
          {kv('Posted', a.posted_on && dayLabel(a.posted_on))}
          {kv('Applied', a.applied_on && dayLabel(a.applied_on))}
          {kv('Source', a.source)}
        </div>
        {a.must_haves.length > 0 && (
          <>
            <span className="lbl">Must-haves</span>
            <div className="tags">
              {a.must_haves.map((m) => (
                <span key={m} className="tag">
                  {m}
                </span>
              ))}
            </div>
          </>
        )}
        {a.nice_to_haves.length > 0 && (
          <>
            <span className="lbl">Nice-to-haves</span>
            <div className="tags">
              {a.nice_to_haves.map((m) => (
                <span key={m} className="tag dashed">
                  {m}
                </span>
              ))}
            </div>
          </>
        )}
      </section>
      <section className="card">
        <div className="card-h">
          <span className="lbl">People</span>
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
                {roleLabel(p.role)}
                {p.title ? ` · ${p.title}` : ''}
                {p.email ? ` · ${p.email}` : ''}
              </span>
            </span>
          </button>
        ))}
        {!people.length && (
          <p className="sub">
            Recruiters, interviewers and referrers. Their emails help your assistant match mail.
          </p>
        )}
      </section>
      <section className="card">
        <div className="card-h">
          <span className="lbl">Company</span>
        </div>
        <div className="kvs">
          {kv('Domain', a.company_domain)}
          {kv('HQ', a.company_hq)}
          {kv('Size', a.company_size)}
          {kv('Industry', a.company_industry)}
          {kv('Funding', a.company_funding)}
        </div>
        <div className="acts">
          {a.company_website && (
            <a className="btn sm" href={a.company_website} target="_blank" rel="noreferrer">
              Website <Icon name="external" size={14} />
            </a>
          )}
          {a.company_linkedin && (
            <a className="btn sm" href={a.company_linkedin} target="_blank" rel="noreferrer">
              LinkedIn <Icon name="external" size={14} />
            </a>
          )}
        </div>
      </section>
      {a.description && (
        <section className="card">
          <div className="card-h">
            <span className="lbl">Job description · saved {dayLabel(a.created_at)}</span>
          </div>
          <div className="jd pre">{a.description}</div>
        </section>
      )}
      {a.notes && (
        <section className="card">
          <span className="lbl">Notes</span>
          <p className="pre">{a.notes}</p>
        </section>
      )}
    </div>
  );
}

function StoriesTab({ a, data }: { a: Application; data: Data }) {
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
    <div className="stack">
      <div className="acts">
        <button type="button" className="btn primary" onClick={() => sheets.linkStory(a.id)}>
          <Icon name="plus" size={16} /> Link from bank
        </button>
        <button type="button" className="btn" onClick={() => sheets.newStory(a.id)}>
          Write a job-only story
        </button>
        <Link className="btn" to={`/a/${a.id}/call`}>
          Open call mode
        </Link>
      </div>
      <p className="sub">
        These are this job’s copies. Edit them freely; the bank only changes if you push.
      </p>
      {list.map((j, i) => {
        const bank = data.state.stories.find((s) => s.id === j.story_id);
        const st = syncState(j, bank);
        const told = data.state.tells.filter((t) => t.job_story_id === j.id);
        return (
          <article key={j.id} className="card story-copy">
            <div className="sc-head">
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
              <span className={cx('sync', `sync-${st}`)}>{SYNC_LABEL[st]}</span>
            </div>
            {j.angle && <div className="angle-line">{j.angle}</div>}
            {j.hook && <p className="sub">{j.hook}</p>}
            <div className="sc-foot">
              <span className="sub">
                {told.length
                  ? `Told ${told.length}× · ${told.flatMap((t) => t.heard_by).join(', ') || 'no names'}`
                  : 'Not told yet'}
              </span>
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
          </article>
        );
      })}
      {!list.length && (
        <p className="empty">
          No stories linked yet. Link your intro, your “why this job”, and the four or five STAR
          stories that fit.
        </p>
      )}
    </div>
  );
}

function FilesTab({ a, data }: { a: Application; data: Data }) {
  const act = useActions();
  const toast = useToast();
  const [kind, setKind] = useState<FileKind>('resume');
  const [paste, setPaste] = useState('');
  const [pasteFor, setPasteFor] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const files = data.state.files.filter((f) => f.application_id === a.id);
  const meetings = (data.eventsByApp.get(a.id) ?? []).filter((e) => e.type === 'meeting');
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    for (const f of [...list]) {
      try {
        await uploadFile(`/applications/${a.id}/files?kind=${kind}`, f);
        toast({ text: `Added ${f.name}` });
      } catch (e) {
        toast({ text: (e as Error).message, tone: 'bad' });
      }
    }
    await act.refresh();
  }
  return (
    <div className="stack">
      <section className="card">
        <div className="two">
          <Field label="Kind">
            <Select
              value={kind}
              onChange={(v) => setKind(v as FileKind)}
              groups={[{ options: FILE_KINDS.map((k) => ({ value: k.key, label: k.label })) }]}
            />
          </Field>
          <Field label="File">
            <button type="button" className="btn" onClick={() => input.current?.click()}>
              <Icon name="upload" size={16} /> Choose a file
            </button>
            <input
              ref={input}
              type="file"
              hidden
              multiple
              accept=".pdf,.docx,.txt,.md,.vtt,.srt,image/*"
              onChange={(e) => void upload(e.target.files)}
            />
          </Field>
        </div>
        <p className="sub">
          PDF, Word, images, or text (.txt, .md, .vtt, .srt). Text files stay readable for your
          assistant.
        </p>
      </section>
      <section className="card">
        <span className="lbl">Paste a transcript</span>
        <textarea
          className="in"
          rows={4}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="Paste the call transcript from Zoom, Otter, Granola…"
        />
        {meetings.length > 0 && (
          <Select
            value={pasteFor}
            onChange={setPasteFor}
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
        )}
        <div className="acts" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn primary"
            disabled={!paste.trim()}
            onClick={async () => {
              const ok = await act.post(
                `/applications/${a.id}/text-files`,
                { text: paste, kind: 'transcript', event_id: pasteFor || null },
                'Transcript saved',
              );
              if (ok) setPaste('');
            }}
          >
            Save transcript
          </button>
        </div>
      </section>
      {files.map((f) => (
        <div key={f.id} className="file-row">
          <Icon name="file" size={22} />
          <span className="row-text">
            <strong>{f.label ?? f.filename}</strong>
            <span className="sub">
              {fileKindLabel(f.kind)} · {bytes(f.size)} · {relDays(f.created_at)}
              {a.resume_file_id === f.id ? ' · sent with this application' : ''}
            </span>
          </span>
          <span className="acts">
            <a className="btn sm" href={fileUrl(f.id, true)} target="_blank" rel="noreferrer">
              Open
            </a>
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
              aria-label={f.locked ? 'Unlock' : 'Lock (it was sent)'}
              title={f.locked ? 'Locked: it was sent. Unlock to delete.' : 'Lock it: it was sent'}
              onClick={() => act.patch(`/files/${f.id}`, { locked: !f.locked })}
            >
              <Icon name={f.locked ? 'lock' : 'unlock'} size={16} />
            </button>
            {!f.locked && (
              <button
                type="button"
                className="xbtn"
                aria-label="Delete"
                onClick={() => act.del(`/files/${f.id}`, 'Deleted')}
              >
                <Icon name="trash" size={16} />
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ApplicationPage() {
  const { id = '' } = useParams();
  const data = useData();
  const sheets = useSheets();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('timeline');
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
  const nStories = data.state.job_stories.filter((j) => j.application_id === a.id).length;
  const nFiles = data.state.files.filter((f) => f.application_id === a.id).length;
  const next = OPEN_STATUSES[stageIndex(a.status) + 1];

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
        <CompanyMark name={a.company} size={56} />
        <div className="app-head-text">
          <h1 className="title">{a.title}</h1>
          <div className="tags">
            <strong>{a.company}</strong>
            <StatusChip status={a.status} />
            {pay && <span className="tag mono">{pay}</span>}
            {a.work_mode && (
              <span className="tag">
                {a.work_mode === 'onsite'
                  ? 'On-site'
                  : a.work_mode[0]!.toUpperCase() + a.work_mode.slice(1)}
              </span>
            )}
            {a.location && <span className="tag">{a.location}</span>}
            {a.seniority && <span className="tag">{a.seniority}</span>}
            {a.reports_to && <span className="tag">Reports to {a.reports_to}</span>}
          </div>
        </div>
        <div className="acts">
          {a.url && (
            <a className="btn" href={a.url} target="_blank" rel="noreferrer">
              Posting <Icon name="external" size={14} />
            </a>
          )}
          <button type="button" className="btn" onClick={() => sheets.status(a.id)}>
            Change status
          </button>
          {next && isOpen(a.status) && (
            <button type="button" className="btn" onClick={() => sheets.status(a.id, next)}>
              → {statusLabel(next)}
            </button>
          )}
          <button type="button" className="btn primary" onClick={() => sheets.log(a.id)}>
            <Icon name="plus" size={16} /> Log
          </button>
        </div>
      </header>
      <Stepper a={a} data={data} />
      <SlideToggle
        label="Section"
        value={tab}
        onChange={setTab}
        className="tabs"
        options={[
          ['timeline', `Timeline`],
          ['stories', `Stories ${nStories}`],
          ['details', 'Details'],
          ['files', `Files ${nFiles}`],
        ]}
      />
      <div className="tab-body">
        {tab === 'timeline' && <Timeline events={events} appId={a.id} />}
        {tab === 'stories' && <StoriesTab a={a} data={data} />}
        {tab === 'details' && <Details a={a} data={data} />}
        {tab === 'files' && <FilesTab a={a} data={data} />}
      </div>
    </div>
  );
}
