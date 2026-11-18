// The app's own date and time pickers (the browsers' differ by device and ignore the app's look).
// Each is a field-like button that opens a small pop-up: a month calendar for dates, a list of
// quarter hours for times. The pop-up sits on the page body (so sheets and scrolling areas can't
// clip it), stays on screen, and closes on Escape, a tap outside or tabbing away.
// Ported from Nitrogen's DateTimePicker, restyled for Knock Knock and given arrow-key navigation.
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { cx } from './ui';
import {
  addDays,
  addMonths,
  clockLabel,
  dateKey,
  dateKeyLabel,
  joinLocal,
  monthCells,
  parseKey,
  splitLocal,
  timesWith,
  todayKey,
} from '../lib/dates';

/** Closes the open pop-up after a pick. */
const DoneCtx = createContext<() => void>(() => undefined);

interface PopProps {
  label: string;
  icon: IconName;
  text: string;
  /** Shown as a placeholder (nothing chosen yet). */
  empty?: boolean;
  /** Opens as soon as it appears (inline editors). */
  autoOpen?: boolean;
  /** Called when the pop-up closes without a pick (Escape, a tap outside, tabbing away). */
  onDismiss?: () => void;
  className?: string;
  /** The pop-up's content; it closes the pop-up after a pick with `useContext(DoneCtx)`. */
  children: ReactNode;
}

/** A field-like button and its pop-up, placed under it (or above when there's no room). */
function Pop({ label, icon, text, empty, autoOpen, onDismiss, className, children }: PopProps) {
  const [open, setOpen] = useState(!!autoOpen);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      const p = pop.current?.getBoundingClientRect();
      if (!r || !p) return;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const left = Math.max(8, Math.min(r.left, vw - 8 - p.width));
      const below = r.bottom + 6;
      const room = vh - 8 - below;
      const top =
        p.height <= room
          ? below
          : r.top - 6 - p.height >= 8
            ? r.top - 6 - p.height
            : Math.max(8, vh - 8 - p.height);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Close: after a pick focus returns to the button; a dismissal tells the owner.
  function close(how: 'pick' | 'dismiss', refocus = true) {
    setOpen(false);
    if (refocus) btn.current?.focus({ preventScroll: true });
    if (how === 'dismiss') onDismiss?.();
  }
  const done = () => close('pick');

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) close('dismiss', false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  });

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // Only the pop-up closes: not the sheet or the inline editor around it.
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    close('dismiss');
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={cx('in dt-field', empty && 'ph', className)}
        aria-label={`${label}: ${text}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => {
          if (open) return close('dismiss', false);
          setPos(null);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setPos(null);
            setOpen(true);
          }
        }}
      >
        <Icon name={icon} size={16} />
        <span className="dt-text">{text}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            id={popId}
            className="dt-pop"
            role="dialog"
            aria-label={label}
            style={
              pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }
            }
            onKeyDown={onKey}
            onBlur={(e) => {
              const to = e.relatedTarget as Node | null;
              if (to && !pop.current?.contains(to) && !btn.current?.contains(to))
                close('dismiss', false);
            }}
          >
            <DoneCtx.Provider value={done}>{children}</DoneCtx.Provider>
          </div>,
          document.body,
        )}
    </>
  );
}

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => ({
  // Nov 1, 2026 is a Sunday.
  short: new Date(2026, 10, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }),
  long: new Date(2026, 10, 1 + i).toLocaleDateString(undefined, { weekday: 'long' }),
}));

/** A month calendar. Arrows move by day and week, Page Up/Down by month, Enter picks. */
function Calendar({
  value,
  start,
  onPick,
  clearLabel,
  onClear,
}: {
  value: string;
  /** Where it opens when nothing is picked. */
  start: string;
  onPick: (k: string) => void;
  clearLabel?: string;
  onClear?: () => void;
}) {
  const done = useContext(DoneCtx);
  const pick = (k: string) => {
    onPick(k);
    done();
  };
  const today = todayKey();
  const [focus, setFocus] = useState(parseKey(value) ? value : start);
  const grid = useRef<HTMLDivElement>(null);
  const f = parseKey(focus)!;

  // Keyboard focus follows the day: on open and after each arrow (not the month buttons).
  const follow = useRef(true);
  useLayoutEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-day="${focus}"]`)?.focus({
      preventScroll: true,
    });
  }, [focus]);

  const go = (k: string) => {
    follow.current = true;
    setFocus(k);
  };
  const onKey = (e: ReactKeyboardEvent) => {
    const step: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
      Home: () => addDays(focus, -new Date(f.y, f.m, f.d).getDay()),
      End: () => addDays(focus, 6 - new Date(f.y, f.m, f.d).getDay()),
    };
    const next = step[e.key];
    if (!next) return;
    e.preventDefault();
    go(next());
  };
  // The month arrows keep focus on themselves, moving the day along.
  const month = (n: number) => setFocus((k) => addMonths(k, n));

  const title = new Date(f.y, f.m, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const cells = monthCells(f.y, f.m);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div className="cal">
      <div className="cal-head">
        <button
          type="button"
          className="cal-nav"
          onClick={() => month(-1)}
          aria-label="Previous month"
        >
          <Icon name="back" size={16} />
        </button>
        <span className="cal-title" aria-live="polite">
          {title}
        </span>
        <button type="button" className="cal-nav" onClick={() => month(1)} aria-label="Next month">
          <Icon name="chevRight" size={16} />
        </button>
      </div>
      <div className="cal-grid" role="grid" aria-label={title} ref={grid} onKeyDown={onKey}>
        <div role="row" className="cal-row">
          {WEEKDAYS.map((w) => (
            <span key={w.long} role="columnheader" className="cal-dow" aria-label={w.long}>
              <span aria-hidden>{w.short}</span>
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div role="row" className="cal-row" key={wi}>
            {week.map((d, di) => {
              if (d === null) return <span key={`x${di}`} role="gridcell" />;
              const k = dateKey(f.y, f.m, d);
              const on = k === value;
              return (
                <span role="gridcell" key={k} aria-selected={on}>
                  <button
                    type="button"
                    data-day={k}
                    tabIndex={k === focus ? 0 : -1}
                    className={cx('cal-day', on && 'on', k === today && 'today')}
                    aria-label={`${dateKeyLabel(k)}${k === today ? ', today' : ''}`}
                    aria-pressed={on}
                    onClick={() => pick(k)}
                  >
                    {d}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="cal-foot">
        {onClear && (
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => {
              onClear();
              done();
            }}
          >
            {clearLabel ?? 'No date'}
          </button>
        )}
        <button type="button" className="btn sm" onClick={() => pick(today)}>
          Today
        </button>
      </div>
    </div>
  );
}

/** A date as 'YYYY-MM-DD' (or null for none), picked from a month calendar. */
export function DatePicker({
  value,
  onChange,
  label = 'Date',
  placeholder = 'No date',
  clearable,
  autoOpen,
  onDismiss,
  openAt,
  className,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label?: string;
  placeholder?: string;
  /** Offers "No date" in the pop-up. */
  clearable?: boolean;
  autoOpen?: boolean;
  onDismiss?: () => void;
  /** The month to show when nothing is picked (a 'YYYY-MM-DD' in it); today by default. */
  openAt?: string;
  className?: string;
}) {
  const v = value && parseKey(value) ? value : '';
  return (
    <Pop
      label={label}
      icon="cal"
      text={v ? dateKeyLabel(v) : placeholder}
      empty={!v}
      autoOpen={autoOpen}
      onDismiss={onDismiss}
      className={className}
    >
      <Calendar
        value={v}
        start={openAt && parseKey(openAt) ? openAt : todayKey()}
        onPick={onChange}
        clearLabel={placeholder}
        onClear={clearable ? () => onChange(null) : undefined}
      />
    </Pop>
  );
}

/** Quarter hours to pick from; arrows move, Enter picks, letters aren't needed. */
function TimeList({ value, onPick }: { value: string; onPick: (t: string) => void }) {
  const done = useContext(DoneCtx);
  const list = useRef<HTMLDivElement>(null);
  const times = timesWith(value);
  // Open on the chosen time, or around 9 a.m., with it focused.
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(
      `[data-time="${value && times.includes(value) ? value : '09:00'}"]`,
    );
    if (el && list.current) {
      list.current.scrollTop = el.offsetTop - list.current.clientHeight / 3;
      el.focus({ preventScroll: true });
    }
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onKey = (e: ReactKeyboardEvent) => {
    const opts = Array.from(list.current?.querySelectorAll<HTMLElement>('.time-opt') ?? []);
    const i = opts.indexOf(document.activeElement as HTMLElement);
    const to =
      e.key === 'ArrowDown'
        ? i + 1
        : e.key === 'ArrowUp'
          ? i - 1
          : e.key === 'PageDown'
            ? i + 8
            : e.key === 'PageUp'
              ? i - 8
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? opts.length - 1
                  : null;
    if (to === null) return;
    e.preventDefault();
    const el = opts[Math.max(0, Math.min(opts.length - 1, to))];
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  };
  return (
    <div className="time-list" ref={list} role="listbox" aria-label="Times" onKeyDown={onKey}>
      {times.map((t) => (
        <button
          key={t}
          type="button"
          role="option"
          data-time={t}
          tabIndex={-1}
          aria-selected={t === value}
          className={cx('time-opt', t === value && 'on')}
          onClick={() => {
            onPick(t);
            done();
          }}
        >
          {clockLabel(t)}
        </button>
      ))}
    </div>
  );
}

/** A time as 'HH:MM', picked from a list of quarter hours. */
export function TimePicker({
  value,
  onChange,
  label = 'Time',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  className?: string;
}) {
  return (
    <Pop
      label={label}
      icon="clock"
      text={value ? clockLabel(value) : 'Time'}
      empty={!value}
      className={className}
    >
      <TimeList value={value} onPick={onChange} />
    </Pop>
  );
}

/**
 * A date and time as 'YYYY-MM-DDTHH:MM' (a datetime-local value): a date button and a time
 * button side by side. With `optional`, the date can be cleared ('' out) and the time hides.
 */
export function DateTimeField({
  value,
  onChange,
  label,
  optional,
  fallback,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  optional?: boolean;
  /** A datetime-local value to borrow the month and time from when this one is empty. */
  fallback?: string;
}) {
  const { date, time } = splitLocal(value);
  const fb = splitLocal(fallback ?? '');
  return (
    <div className={cx('dt-pair', !date && 'solo')}>
      <DatePicker
        label={`${label} date`}
        value={date || null}
        clearable={optional}
        openAt={fb.date || undefined}
        onChange={(d) => onChange(d ? joinLocal(d, time || fb.time || '09:00') : '')}
      />
      {date && (
        <TimePicker
          label={`${label} time`}
          value={time}
          onChange={(t) => onChange(joinLocal(date, t))}
        />
      )}
    </div>
  );
}
