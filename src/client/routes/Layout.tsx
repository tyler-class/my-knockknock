import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { GlassTabBar, type GlassTab } from '../components/GlassTabBar';
import { Icon } from '../components/Icon';
import { Asterisk, Joke, Spinner, Wordmark } from '../components/Brand';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useSheets } from '../sheets/context';
import { useTabSwipe } from '../lib/tabSwipe';
import { useActions, useData, type Data } from '../lib/queries';
import { cx } from '../components/ui';
import type { Search } from '@shared/types';
import { onPushOpen } from '../kit/push';

const TABS: GlassTab[] = [
  ['/', 'Home', 'home'],
  ['/pipeline', 'Pipeline', 'briefcase'],
  ['/stories', 'Stories', 'quote'],
  ['/reports', 'Report', 'chart'],
  ['/settings', 'Settings', 'settings'],
];

const TAB_PATHS = TABS.map(([to]) => to);

function tabRoot(path: string): string | null {
  const p = path.replace(/\/+$/, '') || '/';
  return TAB_PATHS.includes(p) ? p : null;
}

function activeTab(path: string): string {
  if (path.startsWith('/a/')) return '/pipeline';
  for (const [p] of TABS.slice(1)) if (path.startsWith(p)) return p;
  return '/';
}

const searchStatus = (s: Search) =>
  s.status === 'active' ? 'Active' : s.status === 'accepted' ? 'Accepted' : 'Ended';

/**
 * The search everything (but Stories) is about. Tapping it lists every search to pick
 * from, with Edit for the chosen one and New search at the bottom.
 */
function SearchSwitch({ data, compact }: { data: Data | null; compact?: boolean }) {
  const sheets = useSheets();
  const act = useActions();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const search = data?.search;
  const count = (id: string) =>
    data?.state.applications.filter((a) => a.search_id === id).length ?? 0;
  const go = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <div className={cx('search-pick', compact && 'compact')} ref={root}>
      <button
        type="button"
        className="search-switch"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {!compact && <span className="lbl">Search</span>}
        <span className="search-switch-name">
          <strong>{search?.name ?? 'No search yet'}</strong>
          <Icon name="chevDown" size={16} />
        </span>
        {search && !compact && (
          <span className="sub">
            {searchStatus(search)} · {count(search.id)} applications
          </span>
        )}
      </button>
      {open && (
        <div className="search-menu" role="menu" aria-label="Searches">
          {data?.state.searches.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitemradio"
              aria-checked={s.id === search?.id}
              className="search-opt"
              onClick={() => go(() => s.id !== search?.id && void act.chooseSearch(s.id))}
            >
              <span className="row-text">
                <strong>{s.name}</strong>
                <span className="sub">
                  {searchStatus(s)} · {count(s.id)} applications
                </span>
              </span>
              {s.id === search?.id && <Icon name="check" size={16} />}
            </button>
          ))}
          <div className="search-menu-foot">
            {search && (
              <button
                type="button"
                className="btn sm"
                onClick={() => go(() => sheets.search(search.id))}
              >
                <Icon name="edit" size={14} /> Edit this search
              </button>
            )}
            <button type="button" className="btn sm" onClick={() => go(() => sheets.search())}>
              <Icon name="plus" size={14} /> New search
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Brand() {
  // The asterisk turns while anything is loading or saving (after a beat, so quick ones don't
  // flicker).
  const busy = useIsFetching() + useIsMutating() > 0;
  return (
    <div className="brand">
      <Asterisk size={26} className={busy ? 'spinning delayed' : undefined} />
      <Wordmark />
    </div>
  );
}

/**
 * Phones (and the installed app): tabs in a floating glass capsule along the bottom, a floating
 * Add button, and a solid band under the status bar. 768px and up: a sidebar with the same tabs.
 */
export function Layout() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
  }, [pathname]);
  const active = activeTab(pathname);
  useTabSwipe(TAB_PATHS, tabRoot(pathname));
  const sheets = useSheets();
  const nav = useNavigate();
  const data = useData();
  useEffect(() => onPushOpen((url) => nav(url)), [nav]);
  const tab = ([to, label, icon]: GlassTab) => (
    <NavLink key={to} to={to} aria-current={active === to ? 'page' : undefined}>
      <Icon name={icon} size={20} />
      {label}
    </NavLink>
  );
  return (
    <div className="shell">
      <aside className="side">
        <Link to="/" className="side-brand" aria-label="Knock Knock home">
          <Brand />
        </Link>
        <SearchSwitch data={data} />
        <button type="button" className="btn primary" onClick={sheets.addJob}>
          <Icon name="plus" size={18} /> Add job
        </button>
        <nav aria-label="Main">{TABS.map(tab)}</nav>
        <div className="side-foot">
          <button type="button" className="side-about" onClick={sheets.about}>
            <Icon name="info" size={18} /> About Knock Knock
          </button>
          <Joke />
        </div>
      </aside>
      <header className="appbar">
        <Link to="/" aria-label="Knock Knock home" className="appbar-home">
          <Brand />
        </Link>
        <SearchSwitch data={data} compact />
      </header>
      <main className="main">
        {data ? (
          <Outlet />
        ) : (
          <div className="page-loading">
            <Spinner />
          </div>
        )}
      </main>
      <GlassTabBar tabs={TABS} active={active} />
    </div>
  );
}
