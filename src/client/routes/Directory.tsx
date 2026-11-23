// Everyone and every file in one place: People (at your companies, on your jobs) and Files (sent
// with or kept for your jobs). With Jobs and Companies they make up Tracker, one row of tabs
// across the top of each.
import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { fileKindLabel, personRoleLabel } from '@shared/lookups';
import { fileUrl } from '../lib/api';
import { bytes, dayLabel } from '../lib/format';
import { useData } from '../lib/queries';
import { useSheets } from '../sheets/context';
import { Icon } from '../components/Icon';
import { TRACKER, TRACKER_ITEMS, trackerPage } from '../lib/tracker';
import { PageHeader, SearchClear } from '../components/ui';

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

/** Everyone: their role and title, their company, and the jobs they're on. */
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
          const jobs = p.application_ids.map((id) => data.appById.get(id)?.title).filter(Boolean);
          return (
            // A row that opens the person (a div: it holds a link to their company).
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              className="person dir-row"
              onClick={() => sheets.person(null, p.id, p.company_id ?? undefined)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault();
                sheets.person(null, p.id, p.company_id ?? undefined);
              }}
            >
              <span className="avatar">{initials(p.name)}</span>
              <span className="row-text">
                <strong>{p.name}</strong>
                <span className="sub">
                  {[personRoleLabel(p), p.title, ...jobs].filter(Boolean).join(' · ')}
                </span>
              </span>
              {c && (
                <Link to={`/c/${c.id}`} className="pill" onClick={(e) => e.stopPropagation()}>
                  {c.name}
                </Link>
              )}
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
  const [q, setQ] = useState('');
  if (!data) return null;
  const ql = q.trim().toLowerCase();
  const list = [...data.state.files]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .filter((f) => {
      const a = f.application_id ? data.appById.get(f.application_id) : undefined;
      return (
        !ql ||
        [f.label, f.filename, fileKindLabel(f.kind), a?.company, a?.title]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(ql)
      );
    });
  return (
    <>
      <PageHeader title="Files" icon="paperclip" />
      <TrackerTabs />
      <SearchBox q={q} setQ={setQ} placeholder="Search files" />
      <div className="card list">
        {list.map((f) => {
          const a = f.application_id ? data.appById.get(f.application_id) : undefined;
          return (
            <div key={f.id} className="prow dir-row">
              <span className="co-mark">
                <Icon name="paperclip" size={18} />
              </span>
              <span className="row-text">
                <strong className="file-title">
                  {f.label || f.filename}
                  <a
                    className="kv-open"
                    href={fileUrl(f.id, true)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${f.label || f.filename} in a new tab`}
                    title="Open in a new tab"
                  >
                    <Icon name="external" size={12} />
                  </a>
                </strong>
                <span className="prow-pills">
                  <span className="pill">{fileKindLabel(f.kind)}</span>
                  <span className="pill">{dayLabel(f.created_at)}</span>
                  <span className="pill">{bytes(f.size)}</span>
                  {a && (
                    <Link to={`/a/${a.id}?tab=files`} className="pill dir-job">
                      {a.company} · {a.title}
                    </Link>
                  )}
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
