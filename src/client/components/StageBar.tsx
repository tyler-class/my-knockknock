// The stage bar: stages left to right as chevrons with lightly rounded corners and an ink outline,
// the last one being Closed. Used on the job page (tap a stage to move there) and in the Change
// status sheet (tap to pick).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** A closed path through `pts` with every corner rounded by `r` (a quadratic curve per corner). */
function roundedPath(pts: [number, number][], r: number): string {
  const toward = (a: [number, number], b: [number, number]): [number, number] => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(r, len / 2) / len;
    return [a[0] + dx * k, a[1] + dy * k];
  };
  return (
    pts
      .map((p, i) => {
        const a = toward(p, pts[(i - 1 + pts.length) % pts.length]!);
        const b = toward(p, pts[(i + 1) % pts.length]!);
        return `${i ? 'L' : 'M'}${a[0]} ${a[1]}Q${p[0]} ${p[1]} ${b[0]} ${b[1]}`;
      })
      .join('') + 'Z'
  );
}

const NOTCH = 12;
const CORNER = 4;
const STROKE = 1.5;

/** One stage's arrow, drawn to its step's size. The first has a flat left end, the last a flat right. */
function Chevron({ first, last }: { first: boolean; last: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<[number, number] | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const set = () => setBox([el.offsetWidth, el.offsetHeight]);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  let d = '';
  if (box) {
    // Inside the box by half the outline, so the stroke isn't cut off.
    const s = STROKE / 2;
    const [w, h] = [box[0] - s, box[1] - s];
    const mid = box[1] / 2;
    const pts: [number, number][] = [
      [s, s],
      [last ? w : w - NOTCH, s],
      ...(last ? [] : ([[w, mid]] as [number, number][])),
      [last ? w : w - NOTCH, h],
      [s, h],
      ...(first ? [] : ([[s + NOTCH, mid]] as [number, number][])),
    ];
    d = roundedPath(pts, CORNER);
  }
  return (
    <svg ref={ref} className="chev" aria-hidden>
      {d && <path d={d} />}
    </svg>
  );
}

export interface Stage {
  key: string;
  label: ReactNode;
  /** The stage's icon (its status icon, `StatusIcon`). */
  icon?: ReactNode;
  /** todo: not reached; done: passed; here: the current stage; picked: chosen (in the sheet). */
  state: 'todo' | 'done' | 'here' | 'picked';
  /** Closed only: green for Accepted, grey for the other endings (instead of yellow). */
  tone?: 'good' | 'muted';
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}

export function StageBar({ stages, label }: { stages: Stage[]; label: string }) {
  // The chosen stage (or else the current one) is always in view: when the bar is wider than the
  // screen, it scrolls sideways to centre it, on open and whenever the choice changes.
  const bar = useRef<HTMLOListElement>(null);
  const focus = (stages.find((s) => s.state === 'picked') ?? stages.find((s) => s.state === 'here'))
    ?.key;
  useLayoutEffect(() => {
    const ol = bar.current;
    const li = ol?.querySelector<HTMLElement>(`li[data-key="${focus}"]`);
    if (!ol || !li || ol.scrollWidth <= ol.clientWidth) return;
    const o = ol.getBoundingClientRect();
    const r = li.getBoundingClientRect();
    ol.scrollLeft += r.left - o.left - (o.width - r.width) / 2;
  }, [focus]);
  return (
    <ol className="stepper" aria-label={label} ref={bar}>
      {stages.map((s, i) => (
        <li key={s.key} className={s.tone ? `${s.state} ${s.tone}` : s.state} data-key={s.key}>
          <Chevron first={i === 0} last={i === stages.length - 1} />
          <button
            type="button"
            aria-current={s.state === 'here' ? 'step' : undefined}
            aria-pressed={s.state === 'picked' ? true : undefined}
            disabled={s.disabled}
            title={s.title}
            onClick={s.onClick}
          >
            {s.icon}
            {s.label}
          </button>
        </li>
      ))}
    </ol>
  );
}
