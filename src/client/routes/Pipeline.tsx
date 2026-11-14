import { useState } from 'react';
import { Link } from 'react-router';
import { CLOSED_STATUSES, OPEN_STATUSES, statusLabel, type Status } from '@shared/lookups';
import { isUpcoming, quietDays } from '@shared/logic/timeline';
import type { Application, MeetingData } from '@shared/types';
import { useData } from '../lib/queries';
import { compLabel, relDays } from '../lib/format';
import { useSheets } from '../sheets/context';
import { CompanyMark, StatusChip } from '../components/StatusChip';
import { Icon } from '../components/Icon';
import { PageHeader, SlideToggle } from '../components/ui';

type View = 'board' | 'list';

function nextStep(
  a: Application,
  data: NonNullable<ReturnType<typeof useData>>,
  now: Date,
): { text: string; hot: boolean } {
  const meet = (data.eventsByApp.get(a.id) ?? [])
    .filter((e) => isUpcoming(e, now))
    .sort((x, y) => x.occurred_at.localeCompare(y.occurred_at))[0];
  if (meet)
    return {
      text: `${meet.title || (meet.data as MeetingData).kind} ${relDays(meet.occurred_at)}`,
      hot: true,
    };
  const q = quietDays(a, now, data.state.events);
  if (a.status === 'saved') return { text: 'Not sent yet', hot: false };
  if (a.status === 'offer') return { text: 'Decide', hot: true };
  if (q >= data.state.settings.follow_up_days)
    return { text: `${q}d silent · follow up`, hot: true };
  return { text: 'Waiting', hot: false };
}

function Card({
  a,
  data,
  now,
}: {
  a: Application;
  data: NonNullable<ReturnType<typeof useData>>;
  now: Date;
}) {
  const next = nextStep(a, data, now);
  const pay = compLabel(a);
  return (
    <Link to={`/a/${a.id}`} className="kcard">
      <span className="kcard-head">
        <CompanyMark name={a.company} size={32} />
        <span className="row-text">
          <strong>{a.company}</strong>
          <span className="kcard-title">{a.title}</span>
        </span>
      </span>
      <span className="tags">
        {pay && <span className="tag mono">{pay}</span>}
        {a.work_mode && (
          <span className="tag">
            {a.work_mode === 'onsite'
              ? 'On-site'
              : a.work_mode[0]!.toUpperCase() + a.work_mode.slice(1)}
          </span>
        )}
        {a.source && <span className="tag">{a.source}</span>}
      </span>
      <span className="kcard-foot">
        {next.hot && <i className="hot" aria-hidden="true" />}
        <span className={next.hot ? 'strong' : ''}>{next.text}</span>
        <span className="mono sub">{quietDays(a, now, data.state.events)}d</span>
      </span>
    </Link>
  );
}

export function Pipeline() {
  const data = useData();
  const sheets = useSheets();
  const [view, setView] = useState<View>(() =>
    window.matchMedia('(min-width: 900px)').matches ? 'board' : 'list',
  );
  const [stage, setStage] = useState<Status | 'open' | 'closed'>('open');
  const [q, setQ] = useState('');
  if (!data) return null;
  const now = new Date();
  const ql = q.trim().toLowerCase();
  const apps = data.apps.filter((a) => !ql || `${a.company} ${a.title}`.toLowerCase().includes(ql));
  const by = (s: Status) => apps.filter((a) => a.status === s);
  const closed = apps.filter((a) => CLOSED_STATUSES.includes(a.status) || a.status === 'accepted');

  return (
    <>
      <PageHeader
        title="Pipeline"
        action={
          <button type="button" className="btn primary desk-only" onClick={sheets.addJob}>
            <Icon name="plus" size={18} /> Add job
          </button>
        }
      />
      <div className="toolbar">
        <label className="search-in">
          <Icon name="search" size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Company or title"
            aria-label="Search applications"
          />
        </label>
        <SlideToggle
          label="View"
          value={view}
          onChange={setView}
          options={[
            ['board', 'Board'],
            ['list', 'List'],
          ]}
        />
      </div>

      {view === 'board' ? (
        <div className="board-scroll">
          <div className="board">
            {OPEN_STATUSES.map((s) => (
              <section key={s} className="col" aria-label={statusLabel(s)}>
                <div className="col-h">
                  <StatusChip status={s} />
                  <span className="mono sub">{by(s).length}</span>
                </div>
                {by(s).map((a) => (
                  <Card key={a.id} a={a} data={data} now={now} />
                ))}
              </section>
            ))}
            <section className="col closed-col" aria-label="Closed">
              <div className="col-h">
                <span className="lbl">Closed</span>
                <span className="mono sub">{closed.length}</span>
              </div>
              <div className="closed-box">
                {(['accepted', ...CLOSED_STATUSES] as Status[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="closed-line"
                    onClick={() => {
                      setView('list');
                      setStage(s);
                    }}
                  >
                    <StatusChip status={s} small />
                    <span className="mono">{by(s).length}</span>
                  </button>
                ))}
                <p className="sub">Closing asks which stage it died at, for the report.</p>
              </div>
            </section>
          </div>
        </div>
      ) : (
        <>
          <SlideToggle
            label="Stage"
            value={stage}
            onChange={setStage}
            options={[
              ['open', `Open ${apps.filter((a) => OPEN_STATUSES.includes(a.status)).length}`],
              ...OPEN_STATUSES.map((s) => [s, `${statusLabel(s)} ${by(s).length}`] as const),
              ['closed', `Closed ${closed.length}`],
            ]}
          />
          <div className="plist">
            {(stage === 'open'
              ? OPEN_STATUSES.slice().reverse()
              : stage === 'closed'
                ? (['accepted', ...CLOSED_STATUSES] as Status[])
                : [stage]
            ).map((s) => {
              const rows = by(s);
              if (!rows.length) return null;
              return (
                <section key={s}>
                  <div className="plist-h">
                    <StatusChip status={s} small />
                    <span className="mono sub">{rows.length}</span>
                  </div>
                  {rows.map((a) => {
                    const next = nextStep(a, data, now);
                    return (
                      <Link key={a.id} to={`/a/${a.id}`} className="prow">
                        <CompanyMark name={a.company} size={38} />
                        <span className="row-text">
                          <strong>{a.company}</strong>
                          <span className="sub ell">{a.title}</span>
                          <span className={next.hot ? 'strong small' : 'small'}>{next.text}</span>
                        </span>
                        <span className="mono sub">{compLabel(a) ?? ''}</span>
                      </Link>
                    );
                  })}
                </section>
              );
            })}
            {!apps.length && <p className="empty">No applications in this search yet.</p>}
          </div>
        </>
      )}
    </>
  );
}
