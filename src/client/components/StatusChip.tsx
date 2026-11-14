import { statusLabel, type Status } from '@shared/lookups';
import { cx } from './ui';

export function StatusChip({ status, small }: { status: Status; small?: boolean }) {
  return <span className={cx('st', `s-${status}`, small && 'sm')}>{statusLabel(status)}</span>;
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
