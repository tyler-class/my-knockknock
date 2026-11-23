// Home: the chosen search at a glance. A few counts, what's coming up, and the latest activity
// across its applications.
import { Link, useNavigate } from 'react-router';
import { isOpen, meetingKindLabel } from '@shared/lookups';
import { appliedAt } from '@shared/logic/status';
import { isUpcoming } from '@shared/logic/timeline';
import { weekOf } from '@shared/logic/report';
import { activityLabel, interviewsThisWeek } from '@shared/logic/activity';
import type { MeetingData, TimelineEvent } from '@shared/types';
import { useData } from '../lib/queries';
import { ellipsis, relDays, whenLabel } from '../lib/format';
import { useSheets } from '../sheets/context';
import { EVENT_ICON } from '../sheets/EventSheet';
import { Asterisk, StatusArrow } from '../components/Brand';
import { Icon, type IconName } from '../components/Icon';
import { PageHeader } from '../components/ui';
import { RoundLine } from '../components/RoundLine';

/** A job's Timeline tab, scrolled to one entry (which flashes briefly). */
const eventHref = (e: Pick<TimelineEvent, 'application_id' | 'id'>) =>
  `/a/${e.application_id}?tab=timeline&event=${e.id}`;

const ACTIVITY_ICON = (icon: ReturnType<typeof activityLabel>['icon']): IconName =>
  icon === 'file' ? 'paperclip' : EVENT_ICON[icon]!;

export function Home() {
  const data = useData();
  const sheets = useSheets();
  const nav = useNavigate();
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
            here as Saved, with the pay, level and requirements filled in. Or add one by hand.
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
  const interviews = interviewsThisWeek(events, now);
  const tiles: [string, number][] = [
    ['Applications', apps.length],
    ['Open', open],
    ['Applied this week', thisWeek],
  ];
  const next = interviews[0];

  return (
    <>
      {header}
      <RoundLine />
      <div className="kpis home-kpis">
        {tiles.map(([l, v]) => (
          <div key={l} className="kpi">
            <span className="kpi-l">{l}</span>
            <span className="kpi-v">{v}</span>
          </div>
        ))}
        {/* Tapping it opens the next one on its job's timeline. */}
        <button
          type="button"
          className="kpi kpi-btn"
          disabled={!next}
          onClick={() => next && nav(eventHref(next))}
          aria-label={`Interviews this week: ${interviews.length}${next ? '. Open the next one' : ''}`}
        >
          <span className="kpi-l">Interviews this week</span>
          <span className="kpi-v">{interviews.length}</span>
        </button>
      </div>

      {upcoming.length > 0 && (
        <section className="sec">
          <div className="sec-h">
            <h2>Coming Up</h2>
          </div>
          <div className="card list">
            {upcoming.map((e) => {
              const a = appById.get(e.application_id)!;
              const d = e.data as MeetingData;
              return (
                <Link key={e.id} to={eventHref(e)} className="recent">
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
          <h2>Recent Activity</h2>
        </div>
        <div className="card list">
          {recent.map((e) => {
            const a = appById.get(e.application_id)!;
            const l = activityLabel(e);
            return (
              <Link key={e.id} to={eventHref(e)} className="recent activity">
                {/* The same icons, grey disc and line weight as the job's timeline. */}
                <span className="act-icon node-in" aria-hidden="true">
                  {l.icon === 'created' ? (
                    <Asterisk size={14} bar={17} />
                  ) : l.icon === 'status' ? (
                    <StatusArrow size={16} />
                  ) : (
                    <Icon name={ACTIVITY_ICON(l.icon)} size={18} />
                  )}
                </span>
                <span className="act-text">
                  <span className="act-top">
                    <span className="lbl">{l.kind}</span>
                    <span className="sub act-when">{relDays(e.occurred_at)}</span>
                  </span>
                  <span className="act-job">
                    <strong>{a.company}</strong>
                    <span className="sub"> · {ellipsis(a.title, 40)}</span>
                  </span>
                  {l.snippet && <span className="act-snip">{l.snippet}</span>}
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
