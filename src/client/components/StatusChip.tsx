import { statusLabel, type Status } from '@shared/lookups';
import { Icon, type IconName } from './Icon';
import { cx } from './ui';

/** Each status's icon: what it means, rather than a colour to learn. */
export const STATUS_ICON: Record<Status, IconName> = {
  saved: 'bookmark',
  applied: 'send',
  screening: 'phone',
  interviewing: 'users',
  offer: 'coin',
  accepted: 'checkCircle',
  rejected: 'xCircle',
  declined: 'logout',
  ghosted: 'ghost',
};

/** The Closed stage before you've said how it ended. */
export const CLOSED_ICON: IconName = 'archive';

/** A status: its icon and name on a plain chip (no colour coding). */
export function StatusChip({ status, small }: { status: Status; small?: boolean }) {
  return (
    <span className={cx('st', `s-${status}`, small && 'sm')}>
      <Icon name={STATUS_ICON[status]} size={small ? 13 : 14} />
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
