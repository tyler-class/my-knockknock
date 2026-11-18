// An application's timeline: upcoming meetings above a NOW line, then everything else newest
// first, each a card with its own icon; notes about an event sit under it.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { emailCategoryLabel, meetingKindLabel, type EventType } from '@shared/lookups';
import { timelineView } from '@shared/logic/timeline';
import type { EmailData, MeetingData, StatusData, TimelineEvent } from '@shared/types';
import { relDays, whenLabel } from '../lib/format';
import { fileUrl } from '../lib/api';
import { EVENT_ICON } from '../sheets/EventSheet';
import { useSheets } from '../sheets/context';
import { Icon } from './Icon';
import { StatusChip } from './StatusChip';
import { Asterisk } from './Brand';
import { SlideToggle, cx } from './ui';

type Filter = 'all' | 'meeting' | 'email' | 'note' | 'status';

function Source({ e }: { e: TimelineEvent }) {
  return e.source === 'agent' ? (
    <span className="src agent">via {e.source_name ?? 'assistant'}</span>
  ) : // Entries you made yourself carry no tag; only an assistant's are named.
  null;
}

function NoteBlock({ n, appId }: { n: TimelineEvent; appId: string }) {
  const sheets = useSheets();
  return (
    <button
      type="button"
      id={`ev-${n.id}`}
      className="nested-note"
      onClick={() => sheets.log(appId, { eventId: n.id })}
    >
      <span className="lbl">Note · {whenLabel(n.occurred_at)}</span>
      {n.title && <strong>{n.title}</strong>}
      <span className="pre">{n.body}</span>
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
  const edit = () => sheets.log(appId, { eventId: e.id });
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
            <button type="button" className="btn sm" onClick={edit}>
              Edit
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
          Created as <StatusChip status={d.to} small />
        </div>
      ) : (
        <div className="status-move">
          {d.from && <StatusChip status={d.from} small />}
          <Icon name="arrowRight" size={16} />
          <StatusChip status={d.to} small />
          {d.reason && <span className="sub">{d.reason}</span>}
        </div>
      );
  } else if (fileId) {
    // A file being added: its own entry, dated when it was uploaded (editable like a note).
    label = 'File';
    body = (
      <>
        <div className="ev-title">{e.title}</div>
        {e.body && <p className="sub">{e.body}</p>}
        <div className="acts">
          <a className="btn sm" href={fileUrl(fileId, true)} target="_blank" rel="noreferrer">
            Open <Icon name="external" size={14} />
          </a>
        </div>
      </>
    );
  } else {
    label = 'Note';
    body = (
      <>
        {e.title && <div className="ev-title">{e.title}</div>}
        <p className="pre">{e.body}</p>
      </>
    );
  }
  // Created and status entries are records of what happened, not things you write: no Edit.
  // (A status change is undone from its toast, or changed by moving the stage again.)
  const editable = e.type !== 'created' && e.type !== 'status';
  return (
    <div id={`ev-${e.id}`} className={cx('ev', `ev-${e.type}`, upcoming && 'upcoming')}>
      <div className="node" aria-hidden="true">
        {e.type === 'created' ? (
          <Asterisk size={16} />
        ) : (
          <Icon name={fileId ? 'file' : EVENT_ICON[e.type]!} size={18} />
        )}
      </div>
      <article className="ev-card">
        <div className="ev-head">
          <span className="lbl">{label}</span>
          <span className="ev-meta">
            <Source e={e} />
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
        {editable && !upcoming && (
          <div className="ev-foot">
            {(e.type === 'meeting' || e.type === 'email') && !fileId && (
              <button
                type="button"
                className="linkish"
                onClick={() => sheets.log(appId, { type: 'note', parentId: e.id })}
              >
                + Note
              </button>
            )}
            <button type="button" className="linkish" onClick={edit}>
              Edit
            </button>
          </div>
        )}
      </article>
    </div>
  );
}

export function Timeline({ events, appId }: { events: TimelineEvent[]; appId: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const now = new Date();
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
  const count = (t: EventType | 'status') =>
    events.filter(
      (e) =>
        !e.parent_id &&
        (t === 'status' ? e.type === 'status' || e.type === 'created' : e.type === t),
    ).length;
  const show = (e: TimelineEvent) =>
    filter === 'all' ||
    (filter === 'status' ? e.type === 'status' || e.type === 'created' : e.type === filter);
  const past = view.past.filter(show);
  const upcoming = view.upcoming.filter(show);
  return (
    <section aria-label="Timeline" className="timeline-wrap">
      <SlideToggle
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          ['all', `All ${events.filter((e) => !e.parent_id).length}`],
          ['meeting', `Meetings ${count('meeting')}`],
          ['email', `Emails ${count('email')}`],
          ['note', `Notes ${count('note')}`],
          ['status', `Status ${count('status')}`],
        ]}
      />
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
        <div className="now">
          <span>NOW</span>
          <i />
          <time>
            {now.toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </time>
        </div>
        {past.map((e) => (
          <EventCard key={e.id} e={e} notes={view.children.get(e.id) ?? []} appId={appId} />
        ))}
        {!past.length && <p className="empty">Nothing here yet.</p>}
      </div>
    </section>
  );
}
