import { Link } from 'react-router';
import { appliedAt } from '@shared/logic/status';
import {
  ghostCandidate,
  isUpcoming,
  needsDebrief,
  needsFollowUp,
  quietDays,
} from '@shared/logic/timeline';
import { weekOf } from '@shared/logic/report';
import type { Application, MeetingData, TimelineEvent } from '@shared/types';
import { meetingKindLabel } from '@shared/lookups';
import { useData } from '../lib/queries';
import { compLabel, relDays, whenLabel } from '../lib/format';
import { useSheets } from '../sheets/context';
import { eventLabel } from '../sheets/EventSheet';
import { CompanyMark, StatusChip } from '../components/StatusChip';
import { Asterisk } from '../components/Brand';
import { Icon } from '../components/Icon';

function AppRow({
  a,
  right,
  children,
}: {
  a: Application;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="row-card">
      <Link to={`/a/${a.id}`} className="row-main">
        <CompanyMark name={a.company} size={34} />
        <span className="row-text">
          <strong>{a.company}</strong>
          <span className="sub">{a.title}</span>
        </span>
        {right}
      </Link>
      {children && <div className="acts">{children}</div>}
    </div>
  );
}

export function Today() {
  const data = useData();
  const sheets = useSheets();
  if (!data) return null;
  const { state, apps, appById } = data;
  const now = new Date();
  const ids = new Set(apps.map((a) => a.id));
  const events = state.events.filter((e) => ids.has(e.application_id));
  const upcoming = events
    .filter(
      (e) => isUpcoming(e, now) && Date.parse(e.occurred_at) - now.getTime() < 14 * 86_400_000,
    )
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const debrief = needsDebrief(events, now);
  const follow = apps.filter(
    (a) =>
      needsFollowUp(a, state.events, state.settings, now) &&
      !ghostCandidate(a, state.events, state.settings, now),
  );
  const ghosts = apps.filter((a) => ghostCandidate(a, state.events, state.settings, now));
  const offers = apps.filter((a) => a.status === 'offer');
  const week = weekOf(now.toISOString());
  const sentThisWeek = apps.filter((a) => {
    const at = appliedAt(data.eventsByApp.get(a.id) ?? []);
    return at && weekOf(at) === week;
  }).length;
  const goal = data.search?.weekly_goal ?? null;
  const recent = events
    .filter((e) => Date.parse(e.occurred_at) <= now.getTime())
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, 8);

  if (!apps.length)
    return (
      <>
        <header className="page-h">
          <h1>Today</h1>
        </header>
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

  return (
    <>
      <header className="page-h">
        <div>
          <h1>Today</h1>
          <p className="sub">
            {now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}{' '}
            · {data.search?.name}
          </p>
        </div>
      </header>

      {goal ? (
        <div className="goal">
          <span>This week</span>
          <div
            className="bar"
            role="progressbar"
            aria-valuenow={sentThisWeek}
            aria-valuemax={goal}
            aria-label="Applications this week"
          >
            <i style={{ width: `${Math.min(100, (sentThisWeek / goal) * 100)}%` }} />
          </div>
          <span>
            {sentThisWeek} of {goal} applications
          </span>
        </div>
      ) : null}

      {upcoming.length > 0 && (
        <section className="sec">
          <div className="sec-h">
            <h2>Up next</h2>
          </div>
          <div className="stack">
            {upcoming.map((e, i) => {
              const a = appById.get(e.application_id)!;
              const d = e.data as MeetingData;
              return (
                <div key={e.id} className={i === 0 ? 'next-card' : 'row-card'}>
                  <span className="lbl">
                    {meetingKindLabel(d.kind)} · {relDays(e.occurred_at)}
                  </span>
                  <Link to={`/a/${a.id}`} className="next-title">
                    {e.title || meetingKindLabel(d.kind)} · {a.company}
                  </Link>
                  <span className="sub">
                    {whenLabel(e.occurred_at)}
                    {d.attendees.length ? ` · ${d.attendees.map((x) => x.name).join(', ')}` : ''}
                  </span>
                  <div className="acts">
                    <Link className="btn sm primary" to={`/a/${a.id}/call?meeting=${e.id}`}>
                      Call mode
                    </Link>
                    {d.join_url && (
                      <a className="btn sm" href={d.join_url} target="_blank" rel="noreferrer">
                        Join
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {offers.length > 0 && (
        <section className="sec">
          <div className="sec-h">
            <h2>Decide</h2>
          </div>
          <div className="stack">
            {offers.map((a) => (
              <AppRow key={a.id} a={a} right={<span className="sub">{compLabel(a) ?? ''}</span>}>
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => sheets.status(a.id, 'accepted')}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => sheets.status(a.id, 'declined')}
                >
                  Decline
                </button>
              </AppRow>
            ))}
          </div>
        </section>
      )}

      {debrief.length > 0 && (
        <section className="sec">
          <div className="sec-h">
            <h2>Write it down</h2>
            <span className="sub">While it's fresh</span>
          </div>
          <div className="stack">
            {debrief.map((e: TimelineEvent) => {
              const a = appById.get(e.application_id)!;
              return (
                <AppRow
                  key={e.id}
                  a={a}
                  right={
                    <span className="sub">
                      {eventLabel(e)} · {relDays(e.occurred_at)}
                    </span>
                  }
                >
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => sheets.log(a.id, { type: 'note', parentId: e.id })}
                  >
                    Debrief
                  </button>
                </AppRow>
              );
            })}
          </div>
        </section>
      )}

      {follow.length > 0 && (
        <section className="sec">
          <div className="sec-h">
            <h2>Follow up · {follow.length}</h2>
            <span className="sub">Quiet for {state.settings.follow_up_days}+ days</span>
          </div>
          <div className="stack">
            {follow.map((a) => (
              <AppRow
                key={a.id}
                a={a}
                right={<span className="quiet">{quietDays(a, now, state.events)}d silent</span>}
              >
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => sheets.log(a.id, { type: 'email' })}
                >
                  Log a follow-up
                </button>
              </AppRow>
            ))}
          </div>
        </section>
      )}

      {ghosts.length > 0 && (
        <section className="sec">
          <div className="sec-h">
            <h2>Ghosted?</h2>
            <span className="sub">Nothing in {state.settings.ghost_days}+ days</span>
          </div>
          <div className="stack">
            {ghosts.map((a) => (
              <AppRow
                key={a.id}
                a={a}
                right={<span className="quiet">{quietDays(a, now, state.events)}d</span>}
              >
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => sheets.status(a.id, 'ghosted')}
                >
                  Mark ghosted
                </button>
              </AppRow>
            ))}
          </div>
        </section>
      )}

      <section className="sec">
        <div className="sec-h">
          <h2>Lately</h2>
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
        </div>
      </section>
    </>
  );
}
