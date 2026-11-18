// Home: the chosen search at a glance. A few counts, what's coming up, and the latest activity
// across its applications.
import { Link } from 'react-router';
import { isOpen, meetingKindLabel } from '@shared/lookups';
import { appliedAt } from '@shared/logic/status';
import { isUpcoming } from '@shared/logic/timeline';
import { weekOf } from '@shared/logic/report';
import type { Application, MeetingData } from '@shared/types';
import { useData } from '../lib/queries';
import { relDays, whenLabel } from '../lib/format';
import { useSheets } from '../sheets/context';
import { eventLabel } from '../sheets/EventSheet';
import { StatusChip } from '../components/StatusChip';
import { Asterisk } from '../components/Brand';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/ui';

export function Home() {
  const data = useData();
  const sheets = useSheets();
  if (!data) return null;
  const { state, apps, appById } = data;
  const now = new Date();
  const ids = new Set(apps.map((a) => a.id));
  const events = state.events.filter((e) => ids.has(e.application_id));
  const header = <PageHeader title="Home" icon="home" />;

  if (!apps.length)
    return (
      <>
        {header}
        <div className="card empty-state">
          <Asterisk size={48} />
          <h2>No applications yet. Go bother someone.</h2>
          <p className="sub">
            Paste a job link to your assistant (Settings → Connect an AI assistant) and it lands
            here as Saved, with the pay, level and must-haves filled in. Or add one by hand.
          </p>
          <button type="button" className="btn primary" onClick={sheets.addJob}>
            <Icon name="plus" size={18} /> Add a job
          </button>
        </div>
      </>
    );

  const week = weekOf(now.toISOString());
  const thisWeek = apps.filter((a) => {
    const at = appliedAt(data.eventsByApp.get(a.id) ?? []);
    return at && weekOf(at) === week;
  }).length;
  const open = apps.filter((a) => isOpen(a.status)).length;
  const upcoming = events
    .filter(
      (e) => isUpcoming(e, now) && Date.parse(e.occurred_at) - now.getTime() < 14 * 86_400_000,
    )
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    .slice(0, 5);
  const recent = events
    .filter((e) => Date.parse(e.occurred_at) <= now.getTime())
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, 12);
  const tiles: [string, number][] = [
    ['Applications', apps.length],
    ['Open', open],
    ['Applied this week', thisWeek],
  ];

  return (
    <>
      {header}
      <p className="page-sub sub">{data.search?.name}</p>
      <div className="kpis home-kpis">
        {tiles.map(([l, v]) => (
          <div key={l} className="kpi">
            <span className="kpi-l">{l}</span>
            <span className="kpi-v">{v}</span>
          </div>
        ))}
      </div>

      {upcoming.length > 0 && (
        <section className="sec">
          <div className="sec-h">
            <h2>Coming up</h2>
          </div>
          <div className="card list">
            {upcoming.map((e) => {
              const a = appById.get(e.application_id)!;
              const d = e.data as MeetingData;
              return (
                <Link key={e.id} to={`/a/${a.id}`} className="recent">
                  <span className="recent-what">
                    <strong>{a.company}</strong> · {e.title || meetingKindLabel(d.kind)}
                  </span>
                  <span className="sub">
                    {whenLabel(e.occurred_at)} · {relDays(e.occurred_at)}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="sec">
        <div className="sec-h">
          <h2>Recent activity</h2>
        </div>
        <div className="card list">
          {recent.map((e) => {
            const a = appById.get(e.application_id)!;
            return (
              <Link key={e.id} to={`/a/${a.id}`} className="recent">
                <span className="recent-what">
                  <strong>{a.company}</strong> ·{' '}
                  {e.type === 'status' || e.type === 'created' ? (
                    <StatusChip status={(e.data as { to: Application['status'] }).to} small />
                  ) : (
                    eventLabel(e)
                  )}
                </span>
                <span className="sub">
                  {relDays(e.occurred_at)}
                  {e.source === 'agent' ? ` · via ${e.source_name ?? 'assistant'}` : ''}
                </span>
              </Link>
            );
          })}
          {!recent.length && <p className="empty">Nothing yet.</p>}
        </div>
      </section>
    </>
  );
}
