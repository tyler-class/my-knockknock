import { statusLabel, type Status } from '@shared/lookups';
import { Icon, type IconName } from './Icon';
import { cx } from './ui';

/** Each status's icon: what it means, rather than a colour to learn. */
export const STATUS_ICON: Record<Status, IconName> = {
  saved: 'bookmark',
  applied: 'send',
  screening: 'phone',
  interviewing: 'users',
  offer: 'gift',
  accepted: 'check',
  rejected: 'x',
  declined: 'minus',
  ghosted: 'ghost',
};

/** The Closed stage before you've said how it ended. */
export const CLOSED_ICON: IconName = 'archive';

/** Each status's colour family: blue along the way, green for an offer, solid green once accepted, red when rejected, grey when it ended quietly. */
const TONE: Record<Status | 'closed', string> = {
  saved: 'open',
  applied: 'open',
  screening: 'open',
  interviewing: 'open',
  offer: 'offer',
  accepted: 'accepted',
  rejected: 'rejected',
  declined: 'closed',
  ghosted: 'closed',
  closed: 'closed',
};

/**
 * A status's icon in a small round badge, tinted by what it means. 'closed' is the Closed stage
 * before it's said how it ended.
 */
export function StatusIcon({ status, size = 14 }: { status: Status | 'closed'; size?: number }) {
  const box = Math.round(size * 1.6);
  return (
    <span
      className={`sti-badge sti-${TONE[status]}`}
      style={{ width: box, height: box }}
      title={status === 'closed' ? 'Closed' : statusLabel(status)}
    >
      <Icon
        name={status === 'closed' ? CLOSED_ICON : STATUS_ICON[status]}
        size={Math.round(size * 0.86)}
        className={`sti sti-${status}`}
      />
    </span>
  );
}

/** A status: its icon and name on a plain chip. */
export function StatusChip({ status, small }: { status: Status; small?: boolean }) {
  return (
    <span className={cx('st', `s-${status}`, small && 'sm')}>
      <StatusIcon status={status} size={small ? 13 : 14} />
      {statusLabel(status)}
    </span>
  );
}

/** The company mark: its first letter on ink. */
export function CompanyMark({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span
      className="cmark"
      style={{ width: size, height: size, fontSize: size * 0.46 }}
      aria-hidden="true"
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}
