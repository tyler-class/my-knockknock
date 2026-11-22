// An application's timeline: upcoming meetings first, then everything else newest first, each
// a card with its own icon; notes about an event sit under it.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { emailCategoryLabel, meetingKindLabel } from '@shared/lookups';
import { timelineView } from '@shared/logic/timeline';
import type { EmailData, MeetingData, StatusData, TimelineEvent } from '@shared/types';
import { relDays, whenLabel } from '../lib/format';
import { fileUrl } from '../lib/api';
import { EVENT_ICON } from '../sheets/EventSheet';
import { useSheets } from '../sheets/context';
import { fileComment } from '../lib/fileComment';
import { Icon } from './Icon';
import { StatusChip } from './StatusChip';
import { Asterisk, StatusArrow } from './Brand';
import { NoteText } from './notes/NoteText';
import { AutoTextarea, cx } from './ui';
import { useActions } from '../lib/queries';

/**
 * A note under its meeting or email: a few lines of it, with Show more to open it to full size
 * in place. Tapping the note itself opens it to edit.
 */
function NoteBlock({ n, appId }: { n: TimelineEvent; appId: string }) {
  const sheets = useSheets();
  const [full, setFull] = useState(false);
  const long = (n.body ?? '').length > 220 || (n.body ?? '').split('\n').length > 4;
  return (
    <div
      id={`ev-${n.id}`}
      className="nested-note"
      role="button"
      tabIndex={0}
      onClick={(e) =>
        !(e.target as HTMLElement).closest('button') && sheets.log(appId, { eventId: n.id })
      }
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        sheets.log(appId, { eventId: n.id });
      }}
    >
      <span className="lbl">Note · {whenLabel(n.occurred_at)}</span>
      {n.title && <strong>{n.title}</strong>}
      <div className={cx('note-body', long && !full && 'clamp')}>
        <NoteText text={n.body ?? ''} />
      </div>
      {long && (
        <button
          type="button"
          className="linkish more"
          aria-expanded={full}
          onClick={() => setFull((f) => !f)}
        >
          {full ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/**
 * A status change's comment, on its own line under the change: tap it to edit (Enter or leaving
 * saves, Escape cancels), or add one when there's none.
 */
function StatusComment({ e, text }: { e: TimelineEvent; text: string | null }) {
  const act = useActions();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(text ?? '');
  const save = async () => {
    setEditing(false);
    const next = v.trim() || null;
    if (next !== (text ?? null)) await act.patch(`/events/${e.id}`, { reason: next });
  };
  if (editing)
    return (
      <AutoTextarea
        className="in status-note-in"
        rows={1}
        autoFocus
        value={v}
        placeholder="Comment"
        onChange={(x) => setV(x.target.value)}
        onBlur={() => void save()}
        onKeyDown={(x) => {
          if (x.key === 'Enter' && !x.shiftKey) {
            x.preventDefault();
            (x.target as HTMLTextAreaElement).blur();
          } else if (x.key === 'Escape') {
            x.stopPropagation();
            setV(text ?? '');
            setEditing(false);
          }
        }}
      />
    );
  return (
    <button
      type="button"
      className={text ? 'status-note' : 'linkish status-note-add'}
      onClick={() => {
        setV(text ?? '');
        setEditing(true);
      }}
    >
      {text ? (
        <>
          <span>{text}</span>
          <Icon name="edit" size={13} />
        </>
      ) : (
        '+ Comment'
      )}
    </button>
  );
}

export function EventCard({
  e,
  notes,
  appId,
  upcoming,
}: {
  e: TimelineEvent;
  notes: TimelineEvent[];
  appId: string;
  upcoming?: boolean;
}) {
  const sheets = useSheets();
  const open = () => sheets.log(appId, { eventId: e.id });
  const opens = e.type === 'meeting' || e.type === 'email' || e.type === 'note';
  const fileId = e.type === 'note' ? (e.data as { file_id?: string }).file_id : undefined;
  let label: string;
  let body: React.ReactNode;
  if (e.type === 'meeting') {
    const d = e.data as MeetingData;
    label = `Meeting · ${d.state} · ${meetingKindLabel(d.kind)}`;
    body = (
      <>
        <div className="ev-title">{e.title || meetingKindLabel(d.kind)}</div>
        {(d.agenda || e.body) && <p className="pre">{d.agenda || e.body}</p>}
        {(d.attendees.length > 0 || d.join_url || d.location) && (
          <div className="tags">
            {d.attendees.map((a, i) => (
              <span key={i} className="tag">
                {a.name}
                {a.title ? ` · ${a.title}` : ''}
              </span>
            ))}
            {d.location && <span className="tag">{d.location}</span>}
          </div>
        )}
        {upcoming && (
          <div className="acts">
            <Link className="btn sm primary" to={`/a/${appId}/call?meeting=${e.id}`}>
              Open Call Mode
            </Link>
            {d.join_url && (
              <a className="btn sm" href={d.join_url} target="_blank" rel="noreferrer">
                Join <Icon name="external" size={14} />
              </a>
            )}
            <button
              type="button"
              className="btn sm"
              onClick={() => sheets.log(appId, { type: 'note', parentId: e.id })}
            >
              + Note
            </button>
          </div>
        )}
      </>
    );
  } else if (e.type === 'email') {
    const d = e.data as EmailData;
    label = `Email · ${d.direction === 'in' ? 'in' : 'out'} · ${emailCategoryLabel(d.category)}`;
    body = (
      <>
        <div className="ev-title">{e.title || d.subject || 'Email'}</div>
        {e.body && <p className="pre">{e.body}</p>}
        {(d.key_points.length > 0 || d.counterpart_name) && (
          <div className="tags">
            {d.counterpart_name && (
              <span className="tag">
                {d.direction === 'in' ? 'From' : 'To'} {d.counterpart_name}
              </span>
            )}
            {d.key_points.map((k) => (
              <span key={k} className="tag key">
                {k}
              </span>
            ))}
          </div>
        )}
      </>
    );
  } else if (e.type === 'status' || e.type === 'created') {
    const d = e.data as StatusData;
    label = e.type === 'created' ? 'Created' : 'Status';
    body =
      e.type === 'created' ? (
        <div className="ev-title">
          Created in <StatusChip status={d.to} small />
        </div>
      ) : (
        <>
          <div className="status-move">
            {d.from && <StatusChip status={d.from} small />}
            <Icon name="chevRight" size={15} />
            <StatusChip status={d.to} small />
          </div>
          <StatusComment e={e} text={d.reason} />
        </>
      );
  } else if (fileId) {
    // A file being added: its own entry, dated when it was uploaded (editable like a note).
    label = 'File';
    body = (
      <>
        {/* The file's name, with a small round button right after it to open it in a new tab. */}
        <div className="ev-title file-title">
          {e.title}
          <a
            className="kv-open"
            href={fileUrl(fileId, true)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${e.title} in a new tab`}
            title="Open in a new tab"
          >
            <Icon name="external" size={14} />
          </a>
        </div>
        {fileComment(e) && <p className="pre">{fileComment(e)}</p>}
      </>
    );
  } else {
    label = 'Note';
    body = (
      <>
        {e.title && <div className="ev-title">{e.title}</div>}
        <NoteText text={e.body ?? ''} />
      </>
    );
  }
  return (
    <div id={`ev-${e.id}`} className={cx('ev', `ev-${e.type}`, upcoming && 'upcoming')}>
      <div className="node" aria-hidden="true">
        <span className="node-in">
          {e.type === 'created' ? (
            <Asterisk size={14} bar={17} />
          ) : e.type === 'status' ? (
            <StatusArrow size={16} />
          ) : (
            <Icon name={fileId ? 'paperclip' : EVENT_ICON[e.type]!} size={18} />
          )}
        </span>
      </div>
      {/* Meetings, emails, notes and files open on a tap anywhere on the card (their own buttons
          and links still work as they are). Status changes are the app's record: they don't. */}
      <article
        className={cx('ev-card', opens && 'open')}
        {...(opens
          ? {
              tabIndex: 0,
              'aria-label': `Open ${label}`,
              onClick: (x: React.MouseEvent) =>
                !(x.target as HTMLElement).closest('a, button, .nested-note') && open(),
              onKeyDown: (x: React.KeyboardEvent) => {
                if (x.target !== x.currentTarget || (x.key !== 'Enter' && x.key !== ' ')) return;
                x.preventDefault();
                open();
              },
            }
          : {})}
      >
        <div className="ev-head">
          <span className="lbl">{label}</span>
          <span className="ev-meta">
            <time dateTime={e.occurred_at}>
              {upcoming
                ? `${whenLabel(e.occurred_at)} · ${relDays(e.occurred_at)}`
                : whenLabel(e.occurred_at)}
            </time>
          </span>
        </div>
        {body}
        {notes.map((n) => (
          <NoteBlock key={n.id} n={n} appId={appId} />
        ))}
        {(e.type === 'meeting' || e.type === 'email') && !upcoming && (
          <div className="ev-foot">
            <button
              type="button"
              className="linkish"
              onClick={() => sheets.log(appId, { type: 'note', parentId: e.id })}
            >
              + Note
            </button>
          </div>
        )}
      </article>
    </div>
  );
}

export function Timeline({ events, appId }: { events: TimelineEvent[]; appId: string }) {
  // ?event=<id> (from Home's recent activity): scroll to that entry, flash it once, and take the
  // id back out of the address so it doesn't happen again.
  const [params, setParams] = useSearchParams();
  const target = params.get('event');
  useEffect(() => {
    if (!target) return;
    const el = document.getElementById(`ev-${target}`);
    if (el) {
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
      el.classList.add('flash');
      // Not cleared when the id leaves the address (that re-runs this effect): let it finish.
      setTimeout(() => el.classList.remove('flash'), 1800);
    }
    setParams(
      (p) => {
        const q = new URLSearchParams(p);
        q.delete('event');
        return q;
      },
      { replace: true },
    );
  }, [target, setParams]);
  const view = useMemo(() => timelineView(events, new Date()), [events]);
  // Everything, in order: no filter.
  const { past, upcoming } = view;
  return (
    <section aria-label="Timeline" className="timeline-wrap">
      <div className="timeline">
        {upcoming.length > 0 && <span className="lbl tl-label">Upcoming</span>}
        {upcoming.map((e) => (
          <EventCard
            key={e.id}
            e={e}
            notes={view.children.get(e.id) ?? []}
            appId={appId}
            upcoming
          />
        ))}
        {past.map((e) => (
          <EventCard key={e.id} e={e} notes={view.children.get(e.id) ?? []} appId={appId} />
        ))}
        {!past.length && <p className="empty">Nothing here yet.</p>}
      </div>
    </section>
  );
}
