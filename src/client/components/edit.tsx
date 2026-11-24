// Editing in place: each value sits in an edit container with its pencil at the right. Tap it to
// edit right there; single fields save on Enter or blur, groups and long text have Save and
// Cancel, and Escape cancels. Used by a job's Details and by a timeline entry's panel.
import { useState, type ReactNode } from 'react';
import { withScheme } from '@shared/url';
import { AutoTextarea, Select, cx } from './ui';
import { Icon } from './Icon';

/**
 * One value (or a small group that edits together) in its edit container: the value with a
 * pencil at the right. Tap either to edit in place.
 */
export function EditBox({
  label,
  href,
  full,
  shown,
  editing,
  onEdit,
  children,
}: {
  label: string;
  /** A link the value points to: a small new-tab button beside the label opens it. */
  href?: string;
  full?: boolean;
  /** What it shows when not editing; empty shows an em dash. */
  shown: ReactNode;
  editing: boolean;
  onEdit: () => void;
  /** The editor. */
  children: ReactNode;
}) {
  const empty = shown == null || shown === '' || (Array.isArray(shown) && !shown.length);
  return (
    <div className={cx('kv ikv', full && 'kv-full')}>
      <span className="kv-l">
        {label}
        {href && (
          <a
            className="kv-open"
            href={withScheme(href)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${label} in a new tab`}
            title="Open in a new tab"
          >
            <Icon name="external" size={12} />
          </a>
        )}
      </span>
      {editing ? (
        children
      ) : (
        <button
          type="button"
          className={cx('kv-v', empty && 'empty-v')}
          onClick={onEdit}
          aria-label={`${label}${empty ? ': not set' : ''}. Edit`}
        >
          <span>{empty ? '—' : shown}</span>
          <Icon name="edit" size={13} />
        </button>
      )}
    </div>
  );
}

/**
 * Formerly Save and Cancel under a group editor. Groups now save like single fields: on Enter,
 * or when focus leaves the group (a click or Tab away); Escape cancels. Kept so callers needn't
 * change; it draws nothing.
 */
export function EditActs(_props: { onSave: () => void; onCancel: () => void }) {
  return null;
}

/** Escape cancels; Enter saves unless something inside (a list, a tag field) used it. */
export const groupKeys = (save: () => void, cancel: () => void, enterSaves = true) => ({
  // Leaving the group (a click elsewhere, or Tab past its last field) saves it. A date picker's
  // pop-up sits outside the group, so its being open doesn't count as leaving.
  onBlur: (e: React.FocusEvent<HTMLElement>) => {
    const root = e.currentTarget;
    const next = e.relatedTarget as Node | null;
    if (next && root.contains(next)) return;
    setTimeout(() => {
      if (!root.isConnected || root.contains(document.activeElement)) return;
      if (document.querySelector('.dt-pop')) return;
      save();
    }, 0);
  },
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

/** A link as it's shown and edited: no scheme, no www, no trailing slash. */
export const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

/**
 * A link shown short (no scheme, www or trailing slash), as text: tapping it edits it, and the
 * new-tab button beside the label opens it.
 */
export const ShortLink = ({ url }: { url: string }) => (
  <span className="link-v">{shortUrl(url)}</span>
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
  // A link is edited exactly as it's shown (short); unchanged, it keeps its stored form.
  const asShown = (x: string) => (url ? shortUrl(x) : x);
  const [v, setV] = useState(raw);
  const save = async () => {
    setEditing(false);
    const next = v.trim();
    if (next === asShown(raw) || (required && !next)) return;
    setPending(next);
    await onSave(next);
    setPending(null);
  };
  return (
    <EditBox
      label={label}
      full={full}
      href={url && raw ? raw : undefined}
      shown={raw && url ? <ShortLink url={raw} /> : raw}
      editing={editing}
      onEdit={() => {
        setV(asShown(raw));
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
  rows: _rows,
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
          rows={1}
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
  quals,
}: {
  label: string;
  value: string[];
  onSave: (v: string[]) => Promise<unknown>;
  /** Qualifications: rounded squares (they run long), light blue if required, grey if preferred. */
  quals?: 'required' | 'preferred';
}) {
  const tagsClass = quals ? `tags quals quals-${quals}` : 'tags';
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  // Whatever is still typed counts too (clicking away before pressing Enter keeps it).
  const withDraft = (list: string[]) => {
    const t = draft.trim();
    return t && !list.some((x) => x.toLowerCase() === t.toLowerCase()) ? [...list, t] : list;
  };
  const save = async () => {
    const next = withDraft(v);
    if (next.join('\n') === value.join('\n') || (await onSave(next))) setEditing(false);
  };
  return (
    <EditBox
      label={label}
      full
      shown={
        value.length ? (
          <span className={tagsClass}>
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
        setDraft('');
        setEditing(true);
      }}
    >
      {/* Editing keeps the pills exactly as they were (same box, place, size and style); each
          gets a small ✕ laid over its corner, and the box to add one opens underneath. */}
      <div className="tags-edit" {...groupKeys(save, () => setEditing(false), false)}>
        {v.length > 0 && (
          <div className="kv-v tags-edit-v">
            <span className={tagsClass}>
              {v.map((m) => (
                <span key={m} className="tag tag-x">
                  {m}
                  <button
                    type="button"
                    className="tag-del"
                    aria-label={`Remove ${m}`}
                    onClick={() => setV(v.filter((x) => x !== m))}
                  >
                    <Icon name="x" size={10} />
                  </button>
                </span>
              ))}
            </span>
            <Icon name="edit" size={13} className="ghost-pencil" />
          </div>
        )}
        <input
          autoFocus
          className="in"
          value={draft}
          placeholder="Add one, press Enter"
          aria-label={`Add to ${label}`}
          onChange={(e) => {
            const t = e.target.value;
            if (t.endsWith(',')) {
              setV(withDraft(v));
              setDraft('');
            } else setDraft(t);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            // Enter adds what's typed; Enter on an empty box saves and closes.
            if (draft.trim()) {
              setV(withDraft(v));
              setDraft('');
            } else void save();
          }}
        />
      </div>
    </EditBox>
  );
}

/**
 * A pick list you can add to (Industry): tap the value and the list opens, the current choice
 * checked. Typing narrows it; when nothing matches, "Add …" adds what you typed. Picking saves;
 * leaving without picking changes nothing; Escape closes.
 */
export function ComboEdit({
  label,
  value,
  options,
  onSave,
  full,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onSave: (v: string) => Promise<unknown>;
  full?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const ql = q.trim().toLowerCase();
  // A value typed in earlier (not on the list) stays a choice.
  const all = value && !options.includes(value) ? [value, ...options] : [...options];
  const hits = all.filter((o) => !ql || o.toLowerCase().includes(ql));
  const canAdd = !!ql && !all.some((o) => o.toLowerCase() === ql);
  const rows = [
    ...hits.map((o) => ({ o, add: false })),
    ...(canAdd ? [{ o: q.trim(), add: true }] : []),
  ];
  const pick = async (v: string) => {
    setEditing(false);
    if (v !== value) await onSave(v);
  };
  return (
    <EditBox
      label={label}
      full={full}
      shown={value}
      editing={editing}
      onEdit={() => {
        setQ('');
        setHi(Math.max(0, all.indexOf(value)));
        setEditing(true);
      }}
    >
      <div className="co-pick">
        <input
          className="in"
          autoFocus
          value={q}
          placeholder={value || 'Search or add'}
          aria-label={label}
          aria-autocomplete="list"
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(false);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const d = e.key === 'ArrowDown' ? 1 : -1;
              setHi((i) => Math.max(0, Math.min(rows.length - 1, i + d)));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const r = rows[hi];
              if (r) void pick(r.o);
            }
          }}
        />
        <div className="sel-list co-list" role="listbox" aria-label={label}>
          <div>
            {rows.map((r, i) => (
              <div
                key={r.add ? '+add' : r.o}
                role="option"
                aria-selected={!r.add && r.o === value}
                className={cx('sel-opt', i === hi && 'hi', r.add && 'co-add')}
                ref={(el) => {
                  if (el && i === hi) el.scrollIntoView({ block: 'nearest' });
                }}
                // Before the field's blur, so the pick lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  void pick(r.o);
                }}
              >
                {r.add ? (
                  <span>
                    <Icon name="plus" size={14} /> Add “{r.o}”
                  </span>
                ) : (
                  <>
                    {r.o}
                    {r.o === value && <Icon name="check" size={14} />}
                  </>
                )}
              </div>
            ))}
            {!rows.length && <div className="sel-empty">No matches</div>}
          </div>
        </div>
      </div>
    </EditBox>
  );
}
