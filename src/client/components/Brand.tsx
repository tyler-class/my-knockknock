// The Knock Knock marks: the asterisk (six square-ended bars, 14° off true) and the wordmark,
// two level "knock"s overlapping: solid ink in front, white behind, offset down and right.
import { cx } from './ui';

export function Asterisk({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      className={cx('asterisk', className)}
    >
      <g transform="rotate(14 50 50)" fill="currentColor">
        <rect x="40" y="4" width="20" height="92" />
        <rect x="40" y="4" width="20" height="92" transform="rotate(60 50 50)" />
        <rect x="40" y="4" width="20" height="92" transform="rotate(120 50 50)" />
      </g>
    </svg>
  );
}

/** The wordmark (one style everywhere). `pop` is the big size, for the login and about screens. */
export function Wordmark({ pop, className }: { pop?: boolean; className?: string }) {
  return (
    <span className={cx('wordmark', pop && 'pop', className)} aria-label="knock knock">
      <span aria-hidden="true">knock</span>
      <span aria-hidden="true" className="second">
        knock
      </span>
    </span>
  );
}

/** The footer line, with the asterisk standing in for the u. */
export function Joke() {
  return (
    <p className="joke">
      Why is this app called Knock Knock? Because getting a job is a f
      <Asterisk size={10} />
      <span className="sr-only">u</span>cking joke sometimes.
    </p>
  );
}

/** The asterisk as the loading spinner: it turns while the app loads. */
export function Spinner({ size = 40, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label}>
      <Asterisk size={size} className="spinning" />
    </span>
  );
}

/**
 * A small burst of asterisks for good news (an offer, accepting one): they fly out from a point
 * and fade. Nothing happens when reduced motion is on.
 */
export function burst(from?: Element | null) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = from?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
  const y = r ? r.top + r.height / 2 : window.innerHeight / 3;
  const layer = document.createElement('div');
  layer.className = 'burst';
  layer.setAttribute('aria-hidden', 'true');
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const d = 70 + Math.random() * 90;
    const s = 12 + Math.random() * 14;
    const el = document.createElement('span');
    el.className = 'burst-bit';
    el.style.cssText = `left:${x}px;top:${y}px;width:${s}px;height:${s}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--rot:${Math.round(Math.random() * 240 - 120)}deg;--delay:${Math.round(Math.random() * 80)}ms`;
    el.innerHTML = `<svg viewBox="0 0 100 100" width="${s}" height="${s}"><g transform="rotate(14 50 50)" fill="currentColor"><rect x="40" y="4" width="20" height="92"/><rect x="40" y="4" width="20" height="92" transform="rotate(60 50 50)"/><rect x="40" y="4" width="20" height="92" transform="rotate(120 50 50)"/></g></svg>`;
    layer.appendChild(el);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1400);
}
