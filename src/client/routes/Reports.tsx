import { useMemo, useState } from 'react';
import { buildReport, type FlowLink, type FlowNode, type Report } from '@shared/logic/report';
import { useData } from '../lib/queries';
import { pct } from '../lib/format';
import { PageHeader, Select } from '../components/ui';

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

function Bars({ rows }: { rows: Report['bySource'] }) {
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.name} className="bar-row">
          <div className="bar-label">
            <span>{r.name}</span>
            <span className="mono">
              {pct(r.rate)} · n={r.n}
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
  const [scope, setScope] = useState<string>('current');
  const report = useMemo(() => {
    if (!data) return null;
    const apps =
      scope === 'all'
        ? data.state.applications
        : data.state.applications.filter(
            (a) => a.search_id === (scope === 'current' ? data.search?.id : scope),
          );
    const ids = new Set(apps.map((a) => a.id));
    return buildReport(
      apps,
      data.state.events.filter((e) => ids.has(e.application_id)),
      data.state.files,
    );
  }, [data, scope]);
  if (!data || !report) return null;
  const goal = data.search?.weekly_goal ?? null;
  const maxWeek = Math.max(goal ?? 0, ...report.perWeek.map((w) => w.n), 1);
  const kpis: [string, string, string][] = [
    ['Sent', String(report.sent), `${report.saved} saved, not sent`],
    ['Response rate', pct(report.responseRate), `${report.responded} heard back`],
    ['Interview rate', pct(report.interviewRate), `${report.interviewed} of ${report.sent}`],
    ['Offers', String(report.offers), `${report.accepted} accepted`],
    [
      'Median first reply',
      report.medianReplyDays == null ? '–' : `${Math.round(report.medianReplyDays)}d`,
      'applied → any reply',
    ],
    ['Ghost rate', pct(report.ghostRate), `${report.ghosted} ghosted`],
  ];

  return (
    <>
      <PageHeader title="Report" />
      <div className="toolbar">
        <Select
          value={scope}
          onChange={setScope}
          groups={[
            {
              options: [
                { value: 'current', label: `This search (${data.search?.name ?? 'none'})` },
                { value: 'all', label: 'All searches' },
              ],
            },
            {
              label: 'Past searches',
              options: data.state.searches
                .filter((s) => s.id !== data.search?.id)
                .map((s) => ({ value: s.id, label: s.name })),
            },
          ]}
        />
      </div>
      <div className="kpis">
        {kpis.map(([l, v, d]) => (
          <div key={l} className="kpi">
            <span className="kpi-l">{l}</span>
            <span className="kpi-v">{v}</span>
            <span className="sub">{d}</span>
          </div>
        ))}
      </div>

      <section className="card sec">
        <span className="lbl">Where {report.sent} applications went</span>
        <p className="sub">
          Built from status history, so each one counts in every stage it reached.
        </p>
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
          <span className="lbl">Response rate by source</span>
          <Bars rows={report.bySource} />
        </section>
        <section className="card">
          <span className="lbl">By resume sent</span>
          <Bars rows={report.byResume} />
          <p className="sub">Small numbers: n is shown so you don’t over-read three data points.</p>
        </section>
        <section className="card">
          <span className="lbl">Applications per week{goal ? ` · goal ${goal}` : ''}</span>
          <div className="weeks">
            {goal ? (
              <div className="goal-line" style={{ bottom: `${(goal / maxWeek) * 100}%` }} />
            ) : null}
            {report.perWeek.map((w) => (
              <div key={w.week} className="wk" title={`Week of ${w.week}: ${w.n}`}>
                <span className="mono">{w.n || ''}</span>
                <i
                  style={{ height: `${(w.n / maxWeek) * 100}%` }}
                  className={goal && w.n >= goal ? 'hit' : ''}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
