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
import { InfoTip, PageHeader } from '../components/ui';
import { RoundLine } from '../components/RoundLine';
import type { Status } from '@shared/lookups';

/** Flow colours: the way forward in ultramarine, each ending in its own quiet tone. */
const COLORS: Record<string, string> = {
  stage: 'var(--accent)',
  forward: 'var(--accent)',
  accepted: 'var(--flow-accepted)',
  rejected: 'var(--flow-rejected)',
  ghosted: 'var(--flow-ghosted)',
  declined: 'var(--flow-declined)',
};

/**
 * The flow from Applied on, built from status history: each stage a rounded bar as tall as the
 * applications that reached it, soft bands between stages, and each ending (rejected, ghosted,
 * declined) branching off where it happened. Something still in play simply stops at its stage.
 */
function Sankey({ nodes, links }: { nodes: FlowNode[]; links: FlowLink[] }) {
  const W = 1000;
  const BAR = 10;
  const colX = (c: number) => 120 + c * 180;
  const max = Math.max(1, ...nodes.filter((n) => n.col === 0).map((n) => n.n));
  const K = 260 / max;
  const GAP = 18;
  const placed = new Map<string, { x: number; y: number; h: number; out: number; in: number }>();
  const cols = new Map<number, FlowNode[]>();
  for (const n of nodes) cols.set(n.col, [...(cols.get(n.col) ?? []), n]);
  let H = 0;
  for (const [c, list] of cols) {
    // Stages on top, endings under them (largest first).
    list.sort((a, b) => (a.kind === 'stage' ? -1 : b.kind === 'stage' ? 1 : b.n - a.n));
    let y = 30;
    for (const n of list) {
      const h = Math.max(n.n * K, 6);
      placed.set(n.id, { x: colX(c), y, h, out: y, in: y });
      y += h + GAP;
    }
    H = Math.max(H, y);
  }
  // Where each band starts and ends: a node's bands leave it in the order of the nodes they go
  // to (top to bottom) and arrive in the order of the nodes they came from, so no two cross.
  const yOf = (id: string) => placed.get(id)?.y ?? 0;
  const ends = new Map<FlowLink, { y0: number; y1: number; h: number }>();
  const outOff = new Map<string, number>();
  const inOff = new Map<string, number>();
  for (const l of [...links].sort((a, b) => yOf(a.to) - yOf(b.to))) {
    const y0 = (placed.get(l.from)?.y ?? 0) + (outOff.get(l.from) ?? 0);
    const h = Math.max(l.n * K, 2);
    outOff.set(l.from, (outOff.get(l.from) ?? 0) + h);
    ends.set(l, { y0, y1: 0, h });
  }
  for (const l of [...links].sort((a, b) => yOf(a.from) - yOf(b.from))) {
    const e = ends.get(l)!;
    e.y1 = (placed.get(l.to)?.y ?? 0) + (inOff.get(l.to) ?? 0);
    inOff.set(l.to, (inOff.get(l.to) ?? 0) + e.h);
  }
  // Forward bands drawn last, so they sit over the endings' softer bands.
  const ordered = [...links].sort((a, b) =>
    a.kind === 'forward' ? 1 : b.kind === 'forward' ? -1 : 0,
  );
  return (
    <svg
      viewBox={`0 0 ${W} ${H + 6}`}
      className="sankey"
      role="img"
      aria-label="Where applications went, stage by stage"
    >
      {ordered.map((l) => {
        const s = placed.get(l.from);
        const t = placed.get(l.to);
        if (!s || !t) return null;
        const { y0, y1, h } = ends.get(l)!;
        const x0 = s.x + BAR;
        const x1 = t.x;
        const mx = (x0 + x1) / 2;
        return (
          <path
            key={`${l.from}>${l.to}`}
            className="sk-band"
            d={`M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + h} C${mx},${y1 + h} ${mx},${y0 + h} ${x0},${y0 + h} Z`}
            fill={COLORS[l.kind]}
            fillOpacity={l.kind === 'forward' ? 0.18 : 0.26}
          />
        );
      })}
      {nodes.map((n) => {
        const p = placed.get(n.id)!;
        const left = n.col === 0;
        const stage = n.kind === 'stage';
        // Stage names sit above their bar; endings beside theirs.
        const tx = left ? p.x - 10 : stage ? p.x : p.x + BAR + 8;
        const ty = stage && !left ? p.y - 9 : p.y + Math.min(p.h / 2, 26) + 5;
        return (
          <g key={n.id}>
            <rect
              x={p.x}
              y={p.y}
              width={BAR}
              height={p.h}
              rx={BAR / 2}
              fill={COLORS[n.id === 'accepted' ? 'accepted' : n.kind] ?? 'var(--accent)'}
            />
            <text x={tx} y={ty} textAnchor={left ? 'end' : 'start'} className="sk-label">
              <tspan className={stage ? 'sk-name' : 'sk-name sk-end'}>{n.label}</tspan>
              <tspan className="sk-n" dx={6}>
                {n.n}
              </tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Each stage's colour in the funnel: Applied grey, Screening ultramarine, Interviewing amber, and
 * Offer and Accepted the greens their status badges use.
 */
const STAGE_COLOR: Partial<Record<Status, string>> = {
  applied: '#7c8391',
  screening: 'var(--accent)',
  interviewing: '#e08a1e',
  offer: '#1f9d6b',
  accepted: '#137a4f',
};

/** The stages, in order, each with how many applications reached it (zero when none did). */
const FUNNEL: [Status, string][] = [
  ['applied', 'Applied'],
  ['screening', 'Screening'],
  ['interviewing', 'Interviewing'],
  ['offer', 'Offer'],
  ['accepted', 'Accepted'],
];

/**
 * The stages as a funnel: stacked bands narrowing evenly from top to bottom, the last a straight
 * stem; the counts and percents show the real drop-off. Each band's stage and
 * count sit at the left on a leader line; how many moved on from the stage before, at the right.
 * Ultramarine, deepest at the top.
 */
function Funnel({ nodes }: { nodes: FlowNode[] }) {
  const n = (s: Status) => nodes.find((x) => x.id === s && x.kind === 'stage')?.n ?? 0;
  // Only the stages some application actually reached.
  const stages = FUNNEL.filter(([s]) => n(s) > 0);
  const counts = stages.map(([s]) => n(s));
  const top = Math.max(1, counts[0]!);
  const W = 640;
  const ROW = 58;
  const GAP = 4;
  const L = 150; // the labels' column
  const R = 120; // the conversions' column
  const mid = L + (W - L - R) / 2;
  const full = W - L - R;
  // A funnel shape whatever the numbers: each stage narrows evenly from the full width at the top
  // to under a third at the bottom (the counts and percents carry the actual drop-off).
  const wAt = (i: number) => full * (1 - (0.7 * i) / Math.max(1, stages.length - 1));
  const H = stages.length * ROW;
  const pctOf = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  return (
    <svg
      className="funnel"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={stages.map(([, l], i) => `${l} ${counts[i]}`).join(', ')}
    >
      {stages.map(([s, label], i) => {
        const v = counts[i]!;
        const last = i === stages.length - 1;
        const wt = wAt(i);
        const wb = last ? wt : wAt(i + 1);
        const y0 = i * ROW;
        const y1 = y0 + ROW - GAP;
        const ym = (y0 + y1) / 2;
        return (
          <g key={s}>
            <path
              d={`M${mid - wt / 2},${y0} H${mid + wt / 2} L${mid + wb / 2},${y1} H${mid - wb / 2} Z`}
              fill={STAGE_COLOR[s]}
            />
            <text x={mid} y={ym + 5} textAnchor="middle" className="fn-in">
              {v}
            </text>
            {/* The stage at the left, on a leader line to its band. */}
            <line className="fn-lead" x1={8} x2={mid - (wt + wb) / 4 - 6} y1={ym} y2={ym} />
            <text x={8} y={ym - 6} className="fn-name">
              {label}
            </text>
            <text x={8} y={ym + 15} className="fn-share">
              {i ? `${pctOf(v, top)} of applied` : 'Everything sent'}
            </text>
            {/* How many moved on from the stage before, at the right. */}
            {i > 0 && (
              <>
                <text x={W - 4} y={y0 + 4} textAnchor="end" className="fn-step">
                  {pctOf(v, counts[i - 1]!)}
                </text>
                <text x={W - 4} y={y0 + 20} textAnchor="end" className="fn-step-sub">
                  {v} of {counts[i - 1]} moved on
                </text>
              </>
            )}
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
      <RoundLine />
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
        <h2 className="sec-title">
          Application Funnel
          <InfoTip label="About the application funnel">
            How many applications reached each stage. At the right, the share that moved on from the
            stage before; under each stage, its share of everything you applied to.
          </InfoTip>
        </h2>
        {report.sent ? <Funnel nodes={report.nodes} /> : <p className="empty">Nothing sent yet.</p>}
      </section>

      <section className="card sec">
        <h2 className="sec-title">
          Paths and Outcomes
          <InfoTip label="About paths and outcomes">
            Each application counts in every stage it reached; one still in play stops at its stage.
          </InfoTip>
        </h2>
        {report.nodes.length ? (
          <div className="sankey-wrap">
            <Sankey nodes={report.nodes} links={report.links} />
          </div>
        ) : (
          <p className="empty">Nothing sent yet.</p>
        )}
        <div className="legend">
          {(
            [
              ['var(--accent)', 'Moved forward'],
              ['var(--flow-rejected)', 'Rejected'],
              ['var(--flow-ghosted)', 'Ghosted'],
              ['var(--flow-declined)', 'Declined'],
            ] as const
          ).map(([c, l]) => (
            <span key={l}>
              <i style={{ background: c }} />
              {l}
            </span>
          ))}
        </div>
      </section>

      <div className="report-grid">
        <section className="card">
          <h2 className="sec-title">
            Response Rate
            <InfoTip label="About response rate">
              Heard back: moved past Applied (Screening or later) or got a rejection, rather than
              silence.
            </InfoTip>
          </h2>
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
            <h2 className="sec-title">
              Which Resume Got Replies
              <InfoTip label="About which resume got replies">
                The resume attached to each application you sent.
              </InfoTip>
            </h2>
            <Bars rows={report.byResume} />
          </section>
        )}
        <section className="card">
          <h2 className="sec-title">
            Time to Hear Back
            <InfoTip label="About time to hear back">
              Median days from applying to the first status change past Applied, or a rejection.
            </InfoTip>
          </h2>
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
          <h2 className="sec-title">
            Applied per Week
            <InfoTip label="About applied per week">The last 12 weeks, Monday to Sunday.</InfoTip>
          </h2>
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
