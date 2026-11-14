// The Knock Knock marks: the asterisk (six square-ended bars, 14° off true) and the wordmark,
// where the second "knock" is tucked back over the first, kicked up and tilted clockwise.
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

/** The wordmark. `pop` is the big outlined version for the login and about screens. */
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
