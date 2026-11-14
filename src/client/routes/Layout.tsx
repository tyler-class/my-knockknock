import { useEffect, useLayoutEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { GlassTabBar, type GlassTab } from '../components/GlassTabBar';
import { Icon } from '../components/Icon';
import { Asterisk, Joke, Wordmark } from '../components/Brand';
import { useSheets } from '../sheets/context';
import { useTabSwipe } from '../lib/tabSwipe';
import { useData } from '../lib/queries';
import { onPushOpen } from '../kit/push';

const TABS: GlassTab[] = [
  ['/', 'Today', 'home'],
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

export function Brand() {
  return (
    <div className="brand">
      <Asterisk size={26} />
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
  const search = data?.search;
  return (
    <div className="shell">
      <aside className="side">
        <Link to="/" className="side-brand" aria-label="Knock Knock home">
          <Brand />
        </Link>
        <button type="button" className="search-switch" onClick={() => sheets.search(search?.id)}>
          <span className="lbl">Search ▾</span>
          <strong>{search?.name ?? 'No search yet'}</strong>
          {search && (
            <span className="sub">
              {search.status === 'active'
                ? 'Active'
                : search.status === 'accepted'
                  ? 'Accepted'
                  : 'Ended'}{' '}
              · {data?.apps.length ?? 0} applications
            </span>
          )}
        </button>
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
      </header>
      <main className="main">
        <Outlet />
      </main>
      <button type="button" className="fab" aria-label="Add a job" onClick={sheets.addJob}>
        <Asterisk size={26} />
      </button>
      <GlassTabBar tabs={TABS} active={active} />
    </div>
  );
}
