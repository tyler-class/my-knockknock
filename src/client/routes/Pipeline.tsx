import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { OPEN_STATUSES, statusLabel, type Status } from '@shared/lookups';
import { isUpcoming, quietDays } from '@shared/logic/timeline';
import type { AppState, Application } from '@shared/types';
import { keys, useActions, useData } from '../lib/queries';
import { CompanyLogo } from '../components/CompanyLogo';
import { compLabel } from '../lib/format';
import {
  CLOSED_STAGES,
  STAGES,
  defaultStage,
  isStage,
  stageCounts,
  stageName,
  stageStatuses,
  type Stage,
} from '../lib/filters';
import { useViewState } from '../lib/viewState';
import { useSheets } from '../sheets/context';
import { StatusChip, StatusIcon } from '../components/StatusChip';
import { Icon } from '../components/Icon';
import { PageHeader, SearchClear, SlideToggle } from '../components/ui';
import { TrackerTabs } from './Directory';

type View = 'board' | 'list';

/**
 * Something to act on, when there is one: a meeting coming up, an offer to decide on, or a quiet
 * spell long enough to follow up. Null otherwise (the status already says the rest).
 */
function nextStep(
  a: Application,
  data: NonNullable<ReturnType<typeof useData>>,
  now: Date,
): string | null {
  const meet = (data.eventsByApp.get(a.id) ?? [])
    .filter((e) => isUpcoming(e, now))
    .sort((x, y) => x.occurred_at.localeCompare(y.occurred_at))[0];
  // Just that there is one (its title can run long; the job's timeline has the details).
  if (meet) return 'Upcoming meeting';
  if (a.status === 'offer') return 'Decide on the offer';
  const q = quietDays(a, now, data.state.events);
  if (a.status !== 'saved' && q >= data.state.settings.follow_up_days)
    return `${q}d quiet · follow up`;
  return null;
}

/** "Last activity today", "… yesterday", "… 3d ago". */
function lastActivityLabel(
  a: Application,
  data: NonNullable<ReturnType<typeof useData>>,
  now: Date,
) {
  const q = quietDays(a, now, data.state.events);
  return `Last activity ${q === 0 ? 'today' : q === 1 ? 'yesterday' : `${q}d ago`}`;
}

function Card({
  a,
  data,
  now,
  lifted = false,
}: {
  a: Application;
  data: NonNullable<ReturnType<typeof useData>>;
  now: Date;
  /** The copy that follows the pointer while dragging. */
  lifted?: boolean;
}) {
  const pay = compLabel(a);
  return (
    <Link
      to={`/a/${a.id}`}
      className={`kcard${lifted ? ' kcard-lifted' : ''}`}
      draggable={false}
      tabIndex={lifted ? -1 : undefined}
    >
      <span className="kcard-head">
        <span className="row-text">
          <strong>{a.company}</strong>
          <span className="kcard-title">{a.title}</span>
        </span>
        <CompanyLogo company={data.state.companies.find((c) => c.id === a.company_id)} />
      </span>
      <span className="tags">
        {pay && <span className="tag mono">{pay}</span>}
        {a.work_mode && (
          <span className="tag">
            {a.work_mode === 'onsite'
              ? 'On-site'
              : a.work_mode[0]!.toUpperCase() + a.work_mode.slice(1)}
          </span>
        )}
      </span>
      {/* Only when anything last happened (no source, no follow-up nudge, on the board). */}
      <span className="kcard-foot">
        <span className="pill when-pill">{lastActivityLabel(a, data, now)}</span>
      </span>
    </Link>
  );
}

/**
 * A board card you can pick up and drop in another place in its lane (your own order) or on
 * another lane (a status change). A tap still opens it.
 */
function DragCard({
  a,
  dropping,
  children,
}: {
  a: Application;
  /** True while a drag is ending: the click that follows it mustn't open the card. */
  dropping: React.RefObject<boolean>;
  children: ReactNode;
}) {
  const { setNodeRef, isDragging, attributes, listeners, transform, transition } = useSortable({
    id: a.id,
  });
  return (
    <div
      ref={setNodeRef}
      className={`kdrag${isDragging ? ' kdrag-away' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      // A drag ends with a click on the card's link: don't open it then.
      onClickCapture={(e) => {
        if (dropping.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {children}
    </div>
  );
}

/**
 * A lane that takes a dropped card. While a card from another lane is over it, a dashed slot
 * at the end shows where it will go.
 */
/** The board lane a status sits in: each open status its own, every ending in Closed. */
const laneOf = (s: Status) => ((CLOSED_STAGES as readonly string[]).includes(s) ? 'closed' : s);

/**
 * A lane in your order: cards not yet placed by hand at the top (newest activity first), then the
 * ones you've dragged into place, in that order.
 */
function laneOrder(list: Application[]): Application[] {
  return [...list].sort((x, y) => {
    const px = x.board_position,
      py = y.board_position;
    if (px == null && py == null) return y.last_activity_at.localeCompare(x.last_activity_at);
    if (px == null) return -1;
    if (py == null) return 1;
    return px - py;
  });
}

function Lane({
  id,
  label,
  dragging,
  over,
  className,
  children,
}: {
  id: string;
  label: string;
  dragging: Application | null;
  /** The lane the dragged card is over right now (over a card in it, or its empty space). */
  over: string | null;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id });
  const target = !!dragging && laneOf(dragging.status) !== id;
  const isOver = over === id;
  return (
    <section
      ref={setNodeRef}
      className={`col${className ? ` ${className}` : ''}${target ? ' col-target' : ''}${target && isOver ? ' col-over' : ''}`}
      aria-label={label}
      data-lane={id}
    >
      {children}
      {target && isOver && (
        <div className="drop-slot" aria-hidden>
          Move to {label}
        </div>
      )}
    </section>
  );
}

export function Pipeline() {
  const data = useData();
  const sheets = useSheets();
  // The search is remembered on this device and kept in the address (?q=acme). The stage isn't
  // remembered: Jobs opens on the furthest stage with a job in it (see defaultStage), and a tab
  // picked lasts while you're on the page (?stage=applied). The view isn't remembered either: it
  // opens as the board on a computer and the list on a phone (?view=list while switched).
  const [choice, choose] = useViewState('kk:pipeline', { q: '' });
  const [params, setParams] = useSearchParams();
  const opening = defaultStage(data?.apps ?? []);
  const askedStage = params.get('stage') ?? '';
  const stage: Stage = isStage(askedStage) ? askedStage : opening;
  const setStage = (s: Stage) =>
    setParams(
      (p) => {
        const q = new URLSearchParams(p);
        if (s === opening) q.delete('stage');
        else q.set('stage', s);
        return q;
      },
      { replace: true },
    );
  // The board opens scrolled to that stage's lane (the furthest one with a job in it).
  const boardScroll = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = boardScroll.current;
    if (!el || !data || scrolledFor.current === 'done') return;
    scrolledFor.current = 'done';
    const lane = [...OPEN_STATUSES].reverse().find((s) => data.apps.some((a) => a.status === s));
    const col = lane && el.querySelector<HTMLElement>(`[data-lane="${lane}"]`);
    if (col) el.scrollLeft = Math.max(0, col.offsetLeft - 12);
  });
  const wide = window.matchMedia('(min-width: 900px)').matches;
  const asked = params.get('view');
  const view: View = asked === 'list' || asked === 'board' ? asked : wide ? 'board' : 'list';
  const setView = (v: View) =>
    setParams(
      (p) => {
        const q = new URLSearchParams(p);
        if (v === (wide ? 'board' : 'list')) q.delete('view');
        else q.set('view', v);
        return q;
      },
      { replace: true },
    );
  // Dragging a card to another lane opens the status sheet set to that lane (note optional).
  const [dragId, setDragId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<string | null>(null);
  const dropping = useRef(false);
  const qc = useQueryClient();
  const act = useActions();
  const sensors = useSensors(
    // A mouse picks a card up after a short move. (Pointer events would also catch touches and
    // start a drag the browser is already scrolling, so touch has its own sensor below.)
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Phones: a short press picks a card up, so a swipe still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const q = choice.q;
  if (!data) return null;
  const now = new Date();
  const ql = q.trim().toLowerCase();
  const apps = data.apps.filter((a) => !ql || `${a.company} ${a.title}`.toLowerCase().includes(ql));
  const counts = stageCounts(apps);
  const by = counts.byStatus;
  const dragged = dragId ? (data.appById.get(dragId) ?? null) : null;
  /** Which lane a drop target is: a card's lane, or the lane itself. */
  const laneAt = (id: string | null) => {
    if (!id) return null;
    const card = data.appById.get(id);
    return card ? laneOf(card.status) : id;
  };
  // Over cards, the nearest card under the pointer (a place in that lane); over a lane's empty
  // space, the lane. Keyboard drags (no pointer) use the nearest of either.
  const collide: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    const cards = hits.filter((h) => data.appById.has(String(h.id)));
    if (cards.length)
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) =>
          cards.some((h) => h.id === c.id),
        ),
      });
    return hits.length ? hits : closestCenter(args);
  };
  /** Your own order in a lane: shown straight away, saved, and put back if saving fails. */
  const reorder = (ids: string[]) => {
    const before = qc.getQueryData<AppState>(keys.state);
    qc.setQueryData<AppState>(keys.state, (cur) =>
      cur
        ? {
            ...cur,
            applications: cur.applications.map((x) => {
              const i = ids.indexOf(x.id);
              return i >= 0 ? { ...x, board_position: i } : x;
            }),
          }
        : cur,
    );
    void act.post('/applications/board-order', { ids }).then((ok) => {
      if (!ok && before) qc.setQueryData(keys.state, before);
    });
  };

  return (
    <>
      <PageHeader
        title="Jobs"
        icon="briefcase"
        action={
          <button type="button" className="btn primary" onClick={sheets.addJob}>
            <Icon name="plus" size={18} /> Add Job
          </button>
        }
      />
      <TrackerTabs />
      <div className="toolbar">
        <label className="search-in">
          <Icon name="search" size={16} />
          <input
            value={q}
            onChange={(e) => choose({ q: e.target.value })}
            placeholder="Company or title"
            aria-label="Search applications"
          />
          <SearchClear value={q} onClear={() => choose({ q: '' })} />
        </label>
        <SlideToggle
          label="View"
          value={view}
          onChange={setView}
          options={[
            ['board', 'Board'],
            ['list', 'List'],
          ]}
        />
      </div>

      {view === 'board' ? (
        <DndContext
          sensors={sensors}
          collisionDetection={collide}
          onDragStart={(e) => setDragId(String(e.active.id))}
          onDragOver={(e) => setOverLane(laneAt(e.over ? String(e.over.id) : null))}
          onDragCancel={() => {
            setDragId(null);
            setOverLane(null);
          }}
          onDragEnd={(e) => {
            setDragId(null);
            setOverLane(null);
            dropping.current = true;
            setTimeout(() => (dropping.current = false), 0);
            const app = data.appById.get(String(e.active.id));
            const overId = e.over ? String(e.over.id) : null;
            const to = laneAt(overId);
            if (!app || !overId || !to) return;
            if (to === laneOf(app.status)) {
              // Within its lane: a new place among the others there.
              const ids = laneOrder(by(app.status)).map((x) => x.id);
              const from = ids.indexOf(app.id);
              const at = ids.indexOf(overId);
              if (at >= 0 && from >= 0 && at !== from) reorder(arrayMove(ids, from, at));
              return;
            }
            if (to === 'closed') {
              // Closing asks which way it ended (rejected, declined, ghosted).
              if (!(CLOSED_STAGES as readonly string[]).includes(app.status))
                sheets.status(app.id, 'closed');
            } else sheets.status(app.id, to as Status);
          }}
        >
          <div ref={boardScroll} className="card board-scroll">
            {/* "crossing": the card is over another lane, so its old place isn't where it lands. */}
            <div
              className={
                dragged && overLane && overLane !== laneOf(dragged.status)
                  ? 'board crossing'
                  : 'board'
              }
            >
              {OPEN_STATUSES.map((s) => (
                <Lane key={s} id={s} label={statusLabel(s)} dragging={dragged} over={overLane}>
                  <div className="col-h">
                    <StatusIcon status={s} size={15} />
                    <strong>{statusLabel(s)}</strong>
                    <span className="count">{by(s).length}</span>
                  </div>
                  <SortableContext
                    items={laneOrder(by(s)).map((a) => a.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {laneOrder(by(s)).map((a) => (
                      <DragCard key={a.id} a={a} dropping={dropping}>
                        <Card a={a} data={data} now={now} />
                      </DragCard>
                    ))}
                  </SortableContext>
                </Lane>
              ))}
              <Lane
                id="closed"
                label="Closed"
                dragging={dragged}
                over={overLane}
                className="closed-col"
              >
                <div className="col-h">
                  <StatusIcon status="closed" size={15} />
                  <strong>Closed</strong>
                  <span className="count">{counts.count('closed')}</span>
                </div>
                <div className="closed-box">
                  {CLOSED_STAGES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="closed-line"
                      // One address change for both (two in a row would drop the first).
                      onClick={() =>
                        setParams(
                          (p) => {
                            const q = new URLSearchParams(p);
                            q.set('stage', s);
                            q.set('view', 'list');
                            return q;
                          },
                          { replace: true },
                        )
                      }
                    >
                      <StatusChip status={s} small />
                      <span className="count">{by(s).length}</span>
                    </button>
                  ))}
                </div>
              </Lane>
            </div>
          </div>
          {/* No drop animation: the card stays where it lands while the status sheet opens. */}
          <DragOverlay dropAnimation={null}>
            {dragged ? <Card a={dragged} data={data} now={now} lifted /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <>
          {/* The list's stages are tabs (the job page's style), not a second toggle under View. */}
          <div className="tabs stage-tabs" role="tablist" aria-label="Stage">
            {[
              ...STAGES,
              // A closed status picked from the board's Closed box stays a choice here.
              ...(STAGES.includes(stage) ? [] : [stage]),
            ].map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={stage === s}
                className="tab"
                onClick={() => setStage(s)}
              >
                <StatusIcon status={s === 'active' ? 'interviewing' : s} size={15} />
                {stageName(s)}
                <span className="count">{counts.count(s)}</span>
              </button>
            ))}
          </div>
          <div className="card plist">
            {stageStatuses(stage).map((s) => {
              const rows = by(s);
              if (!rows.length) return null;
              return (
                <section key={s}>
                  <div className="plist-h">
                    <StatusIcon status={s} size={15} />
                    <strong>{statusLabel(s)}</strong>
                    <span className="count">{rows.length}</span>
                  </div>
                  {rows.map((a) => {
                    const next = nextStep(a, data, now);
                    const pay = compLabel(a);
                    return (
                      <Link key={a.id} to={`/a/${a.id}`} className="prow">
                        <span className="row-text">
                          {/* One line: "Acme · Senior PM" (cut short with … when it's long). */}
                          <strong className="ell">
                            {a.company} <span className="at">·</span>{' '}
                            <span className="job-t">{a.title}</span>
                          </strong>
                          <span className="prow-pills">
                            {pay && <span className="pill">{pay}</span>}
                            {next && <span className="pill hot-pill">{next}</span>}
                            <span className="pill when-pill">
                              {lastActivityLabel(a, data, now)}
                            </span>
                          </span>
                        </span>
                        <CompanyLogo
                          company={data.state.companies.find((c) => c.id === a.company_id)}
                          size={36}
                        />
                      </Link>
                    );
                  })}
                </section>
              );
            })}
            {!apps.length ? (
              <p className="empty">
                {ql ? 'Nothing matches.' : 'No applications in this round yet.'}
              </p>
            ) : (
              !counts.count(stage) && <p className="empty">Nothing here right now.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
