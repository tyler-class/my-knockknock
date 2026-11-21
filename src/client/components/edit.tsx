// Editing in place: each value sits in an edit container with its pencil at the right. Tap it to
// edit right there; single fields save on Enter or blur, groups and long text have Save and
// Cancel, and Escape cancels. Used by a job's Details and by a timeline entry's panel.
import { useState, type ReactNode } from 'react';
import { withScheme } from '@shared/url';
import { AutoTextarea, Select, TagInput, cx } from './ui';
import { Icon } from './Icon';

/**
 * One value (or a small group that edits together) in its edit container: the value with a
 * pencil at the right. Tap either to edit in place.
 */
export function EditBox({
  label,
  full,
  shown,
  editing,
  onEdit,
  children,
}: {
  label: string;
  full?: boolean;
  /** What it shows when not editing; empty shows "Add". */
  shown: ReactNode;
  editing: boolean;
  onEdit: () => void;
  /** The editor. */
  children: ReactNode;
}) {
  const empty = shown == null || shown === '' || (Array.isArray(shown) && !shown.length);
  return (
    <div className={cx('kv ikv', full && 'kv-full')}>
      <span className="kv-l">{label}</span>
      {editing ? (
        children
      ) : (
        <button
          type="button"
          className={cx('kv-v', empty && 'empty-v')}
          onClick={onEdit}
          aria-label={`${label}${empty ? ': not set' : ''}. Edit`}
        >
          <span>{empty ? 'Add' : shown}</span>
          <Icon name="edit" size={13} />
        </button>
      )}
    </div>
  );
}

/** Save and Cancel under a group editor (Enter saves, Escape cancels, where Enter is free). */
export function EditActs({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return (
    <div className="acts mt-s">
      <button type="button" className="btn sm" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="btn sm primary" onClick={onSave}>
        Save
      </button>
    </div>
  );
}

/** Escape cancels; Enter saves unless something inside (a list, a tag field) used it. */
export const groupKeys = (save: () => void, cancel: () => void, enterSaves = true) => ({
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancel();
    } else if (
      enterSaves &&
      e.key === 'Enter' &&
      (e.target as HTMLElement).tagName === 'INPUT' &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      save();
    }
  },
});

/** A link shown short: no scheme, no www, no trailing slash. */
export const ShortLink = ({ url }: { url: string }) => (
  <a href={withScheme(url)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
    {url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
  </a>
);

/**
 * A one-line value: tap it, change it, Enter or leaving the field saves. Escape puts it back.
 * `onSave` gets the trimmed text ('' when cleared) and says whether it saved.
 */
export function LineEdit({
  label,
  value,
  onSave,
  url,
  email,
  full,
  required,
}: {
  label: string;
  value: string;
  onSave: (v: string) => Promise<unknown>;
  url?: boolean;
  email?: boolean;
  full?: boolean;
  /** Can't be emptied: an empty value puts the old one back. */
  required?: boolean;
}) {
  // What was just typed, shown until the save lands, so the old value never flashes back.
  const [pending, setPending] = useState<string | null>(null);
  const raw = pending ?? value;
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(raw);
  const save = async () => {
    setEditing(false);
    const next = v.trim();
    if (next === raw || (required && !next)) return;
    setPending(next);
    await onSave(next);
    setPending(null);
  };
  return (
    <EditBox
      label={label}
      full={full}
      shown={raw && url ? <ShortLink url={raw} /> : raw}
      editing={editing}
      onEdit={() => {
        setV(raw);
        setEditing(true);
      }}
    >
      <input
        className="in sm"
        autoFocus
        {...(url || email
          ? {
              inputMode: url ? ('url' as const) : ('email' as const),
              autoCapitalize: 'off',
              spellCheck: false,
            }
          : {})}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setV(raw);
            setEditing(false);
          }
        }}
      />
    </EditBox>
  );
}

/** A pick from a list: tapping it opens the list straight away; a pick saves. */
export function ChoiceEdit<T extends string>({
  label,
  value,
  choices,
  onSave,
  full,
}: {
  label: string;
  value: T;
  choices: readonly (readonly [T, string])[];
  onSave: (v: T) => Promise<unknown>;
  full?: boolean;
}) {
  const [pending, setPending] = useState<T | null>(null);
  const raw = pending ?? value;
  const [editing, setEditing] = useState(false);
  const pick = async (next: T) => {
    setEditing(false);
    if (next === raw) return;
    setPending(next);
    await onSave(next);
    setPending(null);
  };
  return (
    <EditBox
      label={label}
      full={full}
      shown={choices.find(([k]) => k === raw)?.[1] ?? raw}
      editing={editing}
      onEdit={() => setEditing(true)}
    >
      <Select
        className="sm"
        autoOpen
        value={raw}
        onChange={(next) => void pick(next as T)}
        onClose={() => setEditing(false)}
        groups={[{ options: choices.map(([k, l]) => ({ value: k, label: l })) }]}
      />
    </EditBox>
  );
}

/** Long text, edited where it's shown, with Save and Cancel. */
export function TextEdit({
  label,
  value,
  onSave,
  rows = 3,
  required,
}: {
  label: string;
  value: string;
  onSave: (v: string) => Promise<unknown>;
  rows?: number;
  required?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  const save = async () => {
    if (required && !v.trim()) return;
    if (v === value || (await onSave(v.trim() ? v : ''))) setEditing(false);
  };
  return (
    <EditBox
      label={label}
      full
      shown={value ? <span className="pre">{value}</span> : null}
      editing={editing}
      onEdit={() => {
        setV(value);
        setEditing(true);
      }}
    >
      <div {...groupKeys(save, () => setEditing(false), false)}>
        <AutoTextarea
          className="in"
          rows={rows}
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
        <EditActs onSave={() => void save()} onCancel={() => setEditing(false)} />
      </div>
    </EditBox>
  );
}

/** A list of short tags, with Save and Cancel. */
export function TagsEdit({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string[];
  onSave: (v: string[]) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<string[]>([]);
  const save = async () => {
    if (v.join('\n') === value.join('\n') || (await onSave(v))) setEditing(false);
  };
  return (
    <EditBox
      label={label}
      full
      shown={
        value.length ? (
          <span className="tags">
            {value.map((m) => (
              <span key={m} className="tag">
                {m}
              </span>
            ))}
          </span>
        ) : null
      }
      editing={editing}
      onEdit={() => {
        setV(value);
        setEditing(true);
      }}
    >
      <div {...groupKeys(save, () => setEditing(false), false)}>
        <TagInput value={v} onChange={setV} suggestions={[]} placeholder="Add one, press Enter" />
        <EditActs onSave={() => void save()} onCancel={() => setEditing(false)} />
      </div>
    </EditBox>
  );
}
