// Everyone and every file in one place: People (at your companies, on your jobs) and Files (sent
// with or kept for your jobs). With Jobs and Companies they make up Tracker, one row of tabs
// across the top of each.
import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useOpenFileRecord } from '../lib/fileRecord';
import { fileKindLabel, personRoleLabel } from '@shared/lookups';
import { fileUrl, uploadFile } from '../lib/api';
import { dayLabel } from '../lib/format';
import { useActions, useData } from '../lib/queries';
import { useToast } from '../components/Toast';
import { guessKind, PasteSheet } from './ApplicationPage';
import { useSheets } from '../sheets/context';
import { Icon } from '../components/Icon';
import { TRACKER, TRACKER_ITEMS, trackerPage } from '../lib/tracker';
import { PageHeader, SearchClear, Select } from '../components/ui';

/** Tracker's pages (Jobs · Companies · People · Files) as tabs with their counts. */
export function TrackerTabs() {
  const data = useData();
  const { pathname } = useLocation();
  // On a narrow screen the row scrolls sideways: bring the chosen tab into view (each page has
  // its own row, so it would otherwise start scrolled to the left).
  const row = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = row.current;
    const on = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !on) return;
    el.scrollLeft = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2;
  }, [pathname]);
  if (!data) return null;
  const n: Record<string, number> = {
    '/jobs': data.apps.length,
    '/companies': data.state.companies.length,
    '/people': data.state.people.length,
    '/files': data.state.files.length,
  };
  return (
    <div ref={row} className="tabs dir-tabs" role="tablist" aria-label={TRACKER}>
      {TRACKER_ITEMS.map(([to, label, icon]) => (
        <Link
          key={to}
          to={to}
          role="tab"
          aria-selected={trackerPage(pathname) === to}
          className="tab"
        >
          <Icon name={icon} size={16} />
          {label}
          <span className="count">{n[to]}</span>
        </Link>
      ))}
    </div>
  );
}

export function SearchBox({
  q,
  setQ,
  placeholder,
}: {
  q: string;
  setQ: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="toolbar">
      <label className="search-in">
        <Icon name="search" size={16} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        <SearchClear value={q} onClear={() => setQ('')} />
      </label>
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** Everyone: their role, title and company. */
export function People() {
  const data = useData();
  const sheets = useSheets();
  const [q, setQ] = useState('');
  if (!data) return null;
  const co = (id: string | null) => data.state.companies.find((c) => c.id === id);
  const ql = q.trim().toLowerCase();
  const list = [...data.state.people]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(
      (p) =>
        !ql ||
        [p.name, p.email, p.title, co(p.company_id)?.name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(ql),
    );
  return (
    <>
      <PageHeader title="People" icon="user" />
      <TrackerTabs />
      <SearchBox q={q} setQ={setQ} placeholder="Search people" />
      <div className="card list">
        {list.map((p) => {
          const c = co(p.company_id);
          const role = personRoleLabel(p);
          return (
            // A card that opens the person (a div: it holds a link to their company).
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              className="prow dir-row"
              onClick={() => sheets.person(null, p.id, p.company_id ?? undefined)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault();
                sheets.person(null, p.id, p.company_id ?? undefined);
              }}
            >
              <span className="co-mark person-mark">{initials(p.name)}</span>
              <span className="row-text">
                <strong>{p.name}</strong>
                {(role || p.title || c) && (
                  <span className="prow-pills">
                    {role && <span className="pill">{role}</span>}
                    {p.title && <span className="pill">{p.title}</span>}
                    {c && (
                      <Link to={`/c/${c.id}`} className="pill" onClick={(e) => e.stopPropagation()}>
                        {c.name}
                      </Link>
                    )}
                  </span>
                )}
              </span>
            </div>
          );
        })}
        {!list.length && <p className="empty">{ql ? 'Nothing matches.' : 'No people yet.'}</p>}
      </div>
    </>
  );
}

/** Every file: its name and kind, the job it's with, and a button to open it. */
export function Files() {
  const data = useData();
  const act = useActions();
  const toast = useToast();
  const openRecord = useOpenFileRecord();
  const [q, setQ] = useState('');
  // Adding a file here: on a job picked from the list, or on none ('').
  const [job, setJob] = useState('');
  const [paste, setPaste] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (!data) return null;
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    for (const f of [...list]) {
      const kind = guessKind(f.name);
      try {
        await uploadFile(
          job ? `/applications/${job}/files?kind=${kind}` : `/files?kind=${kind}`,
          f,
        );
        toast({ text: `Added ${f.name}` });
      } catch (e) {
        toast({ text: (e as Error).message, tone: 'bad' });
      }
    }
    if (input.current) input.current.value = '';
    await act.refresh();
  }
  const jobsOf = (f: (typeof data.state.files)[number]) =>
    f.application_ids
      .map((id) => data.appById.get(id))
      .filter((x): x is NonNullable<typeof x> => !!x);
  const ql = q.trim().toLowerCase();
  const list = [...data.state.files]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .filter(
      (f) =>
        !ql ||
        [
          f.label,
          f.filename,
          fileKindLabel(f.kind),
          ...jobsOf(f).flatMap((a) => [a.company, a.title]),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(ql),
    );
  const jobs = [...data.state.applications].sort((x, y) =>
    `${x.company} ${x.title}`.localeCompare(`${y.company} ${y.title}`),
  );
  return (
    <>
      <PageHeader title="Files" icon="paperclip" />
      <TrackerTabs />
      {/* Add a file: drop it on the bar, choose one, or paste text; on a job if one is picked. */}
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
          <span className="file-job-pick">
            <Select
              value={job}
              onChange={setJob}
              groups={[
                { options: [{ value: '', label: 'No job' }] },
                { options: jobs.map((a) => ({ value: a.id, label: `${a.company} · ${a.title}` })) },
              ]}
            />
          </span>
          <button type="button" className="btn sm" onClick={() => input.current?.click()}>
            <Icon name="upload" size={14} /> Upload file
          </button>
          <button type="button" className="btn sm" onClick={() => setPaste(true)}>
            <Icon name="compose" size={14} /> Paste text as file
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
      {paste && <PasteSheet appId={job || null} data={data} onClose={() => setPaste(false)} />}
      <SearchBox q={q} setQ={setQ} placeholder="Search files" />
      <div className="card list">
        {list.map((f) => {
          const on = jobsOf(f);
          return (
            // The card opens the file's record; its Open file pill opens the file itself, and its
            // job pill goes to the job.
            <div
              key={f.id}
              role="button"
              tabIndex={0}
              className="prow dir-row"
              onClick={() => openRecord(f)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault();
                openRecord(f);
              }}
            >
              <span className="co-mark">
                <Icon name="paperclip" size={18} />
              </span>
              <span className="row-text">
                {/* Its name, with Open file (the file itself) beside it. */}
                <span className="file-line">
                  <strong className="file-title">{f.label || f.filename}</strong>
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
                  <span className="pill">{dayLabel(f.created_at)}</span>
                  {/* Every job it's on. */}
                  {on.map((a) => (
                    <Link
                      key={a.id}
                      to={`/a/${a.id}?tab=files`}
                      className="pill dir-job"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {a.company} · {a.title}
                    </Link>
                  ))}
                </span>
              </span>
            </div>
          );
        })}
        {!list.length && <p className="empty">{ql ? 'Nothing matches.' : 'No files yet.'}</p>}
      </div>
    </>
  );
}
