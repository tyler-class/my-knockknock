// The row of tabs at the top of Prepare's pages: Stories and Questions, each with its count.
import { Link, useLocation } from 'react-router';
import { useData } from '../lib/queries';
import { PREPARE, PREPARE_ITEMS, preparePage } from '../lib/tracker';
import { Icon } from './Icon';

export function PrepareTabs() {
  const data = useData();
  const { pathname } = useLocation();
  if (!data) return null;
  const n: Record<string, number> = {
    '/stories': data.state.stories.filter((s) => !s.archived).length,
    '/questions': data.state.questions.filter((q) => !q.archived).length,
  };
  return (
    <div className="tabs dir-tabs" role="tablist" aria-label={PREPARE}>
      {PREPARE_ITEMS.map(([to, label, icon]) => (
        <Link
          key={to}
          to={to}
          role="tab"
          aria-selected={preparePage(pathname) === to}
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
