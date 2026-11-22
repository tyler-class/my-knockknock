import { useMemo } from 'react';
import {
  buildReport,
  MIN_REPLIES,
  type Breakdown,
  type FlowLink,
  type FlowNode,
} from '@shared/logic/report';
import { useData } from '../lib/queries';
import { pct } from '../lib/format';
import { PageHeader } from '../components/ui';
import { SearchLine } from '../components/SearchLine';

const COLORS: Record<string, string> = {
  stage: 'var(--ink)',
  forward: 'var(--ink)',
  open: 'var(--flow-open)',
  rejected: 'var(--flow-rejected)',
  ghosted: 'var(--flow-ghosted)',
  declined: 'var(--flow-declined)',
  accepted: 'var(--ink)',
};

/** The flow from Applied on: forward bands in ink, endings tinted. Built from status history. */
function Sankey({ nodes, links }: { nodes: FlowNode[]; links: FlowLink[] }) {
  const W = 1000;
  const colX = (c: number) => 110 + c * 185;
  const max = Math.max(1, ...nodes.filter((n) => n.col === 0).map((n) => n.n));
  const K = 300 / max;
  const GAP = 14;
  const placed = new Map<string, { x: number; y: number; h: number; out: number; in: number }>();
  const cols = new Map<number, FlowNode[]>();
  for (const n of nodes) cols.set(n.col, [...(cols.get(n.col) ?? []), n]);
  let H = 0;
  for (const [c, list] of cols) {
    // Stages on top, endings under them.
    list.sort((a, b) => (a.kind === 'stage' ? -1 : b.kind === 'stage' ? 1 : b.n - a.n));
    let y = 34;
    for (const n of list) {
      const h = Math.max(n.n * K, 3);
      placed.set(n.id, { x: colX(c), y, h, out: y, in: y });
      y += h + GAP;
    }
    H = Math.max(H, y);
  }
  const ordered = [...links].sort((a, b) =>
    a.kind === 'forward' ? -1 : b.kind === 'forward' ? 1 : 0,
  );
  return (
    <svg
      viewBox={`0 0 ${W} ${H + 10}`}
      className="sankey"
      role="img"
      aria-label="Where applications went, stage by stage"
    >
      {ordered.map((l) => {
        const s = placed.get(l.from);
        const t = placed.get(l.to);
        if (!s || !t) return null;
        const h = l.n * K;
        const x0 = s.x + 12;
        const x1 = t.x;
        const mx = (x0 + x1) / 2;
        const y0 = s.out;
        const y1 = t.in;
        s.out += h;
        t.in += h;
        return (
          <path
            key={`${l.from}>${l.to}`}
            d={`M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + h} C${mx},${y1 + h} ${mx},${y0 + h} ${x0},${y0 + h} Z`}
            fill={COLORS[l.kind]}
            fillOpacity={l.kind === 'forward' ? 0.8 : 0.5}
          />
        );
      })}
      {nodes.map((n) => {
        const p = placed.get(n.id)!;
        const left = n.col === 0;
        return (
          <g key={n.id}>
            <rect
              x={p.x}
              y={p.y}
              width={12}
              height={p.h}
              fill={COLORS[n.kind] ?? 'var(--ink)'}
              stroke="var(--ink)"
              strokeWidth={1.5}
            />
            <text
              x={left ? p.x - 8 : n.kind === 'stage' ? p.x : p.x + 20}
              y={n.kind === 'stage' && !left ? p.y - 8 : p.y + Math.min(p.h / 2, 30) + 5}
              textAnchor={left ? 'end' : 'start'}
              className={n.kind === 'stage' ? 'strong' : ''}
            >
              {n.label} {n.n}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** "LinkedIn — 3 of 10 heard back · 30%", with a bar. */
function Bars({ rows }: { rows: Breakdown[] }) {
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.name} className="bar-row">
          <div className="bar-label">
            <span>{r.name}</span>
            <span className="sub">
              {r.heardBack} of {r.applied} heard back · {pct(r.rate)}
            </span>
          </div>
          <div className="bar">
            <i style={{ width: `${Math.round(r.rate * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Reports() {
  const data = useData();
  // The search picked in the sidebar is the one reported on (change it there).
  const report = useMemo(() => {
    if (!data) return null;
    const apps = data.apps;
    const ids = new Set(apps.map((a) => a.id));
    return buildReport(
      apps,
      data.state.events.filter((e) => ids.has(e.application_id)),
      data.state.files,
    );
  }, [data]);
  if (!data || !report) return null;
  const maxWeek = Math.max(...report.perWeek.map((w) => w.n), 1);
  // The y axis: a round top just above the busiest week, with 0, the middle and the top marked.
  const yTop = maxWeek <= 4 ? 4 : Math.ceil(maxWeek / 4) * 4;
  const yTicks = [0, yTop / 2, yTop];
  const ofSent = (n: number) => (report.sent ? `${pct(n / report.sent)} of applied` : '');
  const tiles: [string, number, string][] = [
    ['Applied', report.sent, report.saved ? `${report.saved} saved, not sent` : ''],
    ['Heard back', report.heardBack, ofSent(report.heardBack)],
    ['Interviews', report.interviewed, ofSent(report.interviewed)],
    ['Offers', report.offers, ofSent(report.offers)],
  ];
  const days = report.medianDaysToHear;

  return (
    <>
      <PageHeader title="Report" icon="chart" />
      <SearchLine />
      <div className="kpis home-kpis">
        {tiles.map(([l, v, d]) => (
          <div key={l} className="kpi">
            <span className="kpi-l">{l}</span>
            <span className="kpi-v">{v}</span>
            {d && <span className="sub">{d}</span>}
          </div>
        ))}
      </div>

      <section className="card sec">
        <h2 className="sec-title">Where Your Applications Went</h2>
        <p className="sub">Each application counts in every stage it reached.</p>
        {report.nodes.length ? (
          <div className="sankey-wrap">
            <Sankey nodes={report.nodes} links={report.links} />
          </div>
        ) : (
          <p className="empty">Nothing sent yet.</p>
        )}
        <div className="legend">
          <span>
            <i style={{ background: 'var(--ink)' }} />
            Moved forward
          </span>
          <span>
            <i style={{ background: 'var(--flow-open)' }} />
            Still open
          </span>
          <span>
            <i style={{ background: 'var(--flow-rejected)' }} />
            Rejected
          </span>
          <span>
            <i style={{ background: 'var(--flow-ghosted)' }} />
            Ghosted
          </span>
          <span>
            <i style={{ background: 'var(--flow-declined)' }} />
            Declined
          </span>
        </div>
      </section>

      <div className="report-grid">
        <section className="card">
          <h2 className="sec-title">Response Rate</h2>
          <p className="sub">
            Heard back: moved past Applied (Screening or later) or got a rejection, rather than
            silence.
          </p>
          {report.sent ? (
            <>
              <div className="big-stat">
                <span className="kpi-v">{pct(report.heardBackRate)}</span>
                <span className="sub">
                  {report.heardBack} of {report.sent} heard back
                </span>
              </div>
              <h3 className="sub-h">By Where You Found the Job</h3>
              <Bars rows={report.bySource} />
            </>
          ) : (
            <p className="empty">Nothing applied to yet.</p>
          )}
        </section>
        {report.byResume.length > 0 && (
          <section className="card">
            <h2 className="sec-title">Which Resume Got Replies</h2>
            <p className="sub">The resume attached to each application you sent.</p>
            <Bars rows={report.byResume} />
          </section>
        )}
        <section className="card">
          <h2 className="sec-title">Time to Hear Back</h2>
          <p className="sub">
            Median days from applying to the first status change past Applied, or a rejection.
          </p>
          {days == null ? (
            <p className="empty">
              Not enough replies yet
              {report.replies ? ` (${report.replies} so far; needs ${MIN_REPLIES})` : ''}.
            </p>
          ) : (
            <div className="big-stat">
              <span className="kpi-v">
                {Math.round(days)} {Math.round(days) === 1 ? 'day' : 'days'}
              </span>
              <span className="sub">from {report.replies} replies</span>
            </div>
          )}
        </section>
        <section className="card">
          <h2 className="sec-title">Applied per Week</h2>
          <p className="sub">The last 12 weeks, Monday to Sunday.</p>
          {/* A y axis of counts with gridlines, one rounded bar per week with its count above,
              and each week's Monday under it; this week in full ultramarine. */}
          <div className="wchart">
            <div className="wchart-y" aria-hidden="true">
              {yTicks.map((t) => (
                <span key={t} style={{ bottom: `${(t / yTop) * 100}%` }}>
                  {t}
                </span>
              ))}
            </div>
            <div className="wchart-plot">
              {yTicks.map((t) => (
                <i key={t} className="wchart-grid" style={{ bottom: `${(t / yTop) * 100}%` }} />
              ))}
              <div className="weeks" role="img" aria-label="Applications per week, last 12 weeks">
                {report.perWeek.map((w, i) => (
                  <div
                    key={w.week}
                    className={i === report.perWeek.length - 1 ? 'wk now' : 'wk'}
                    title={`Week of ${w.week}: ${w.n}`}
                  >
                    <span className="wk-bar" style={{ height: `${(w.n / yTop) * 100}%` }}>
                      {w.n > 0 && <span className="wk-n">{w.n}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="wchart-x" aria-hidden="true">
              {report.perWeek.map((w, i) => (
                <span key={w.week}>
                  {i === report.perWeek.length - 1
                    ? 'This week'
                    : new Date(`${w.week}T12:00:00`).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
