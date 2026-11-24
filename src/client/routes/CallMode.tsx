// Call mode: open it beside the video call. Type the question you just heard and the stories
// whose title, framework or parts share its words rise to the top (plain word overlap: instant,
// offline). This
// job's copies come first, then the whole bank. The notepad saves itself into one note on
// the job's timeline (on the meeting, if there is one) and stays on screen; ending the call
// asks how it went and saves that as its own note.
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { meetingKindLabel } from '@shared/lookups';
import { frameworkOf, searchStories } from '@shared/logic/stories';
import { isUpcoming } from '@shared/logic/timeline';
import { sectionLetter, type FrameworkSection } from '@shared/frameworks';
import type { CallQuestion, JobStory, MeetingData, Story, TimelineEvent } from '@shared/types';
import { useActions, useData } from '../lib/queries';
import { api, ApiError } from '../lib/api';
import { whenLabel } from '../lib/format';
import { Icon } from '../components/Icon';
import { AutoTextarea, Field, SearchClear, Sheet, cx } from '../components/ui';
import './callmode.css';
import { CallQuestions } from './CallQuestions';
import { callList, meetingKeeps, savable, withNoteQuestions } from '../lib/callQuestions';

/** The notes side's share of the width, at least and at most (the rest is stories). */
const MIN_SPLIT = 30;
const MAX_SPLIT = 70;

// The notes editor (CodeMirror) is big: it loads on its own, after the page.
const NotesEditor = lazy(() => import('../components/notes/NotesEditor'));
/** Sent on window to put the notes' cursor at their end (the editor listens). */
const FOCUS_NOTES_END = 'kk:notes-focus-end';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? '⌘' : 'Ctrl+';
/** The key that moves between the notes and the stories search. */
const ALT = MAC ? '⌥' : 'Alt+';

type Item = (JobStory | Story) & { kind: 'job' | 'bank'; defs: FrameworkSection[] };
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Which call a notepad belongs to: the meeting, else the application and today's date. */
function callRef(appId: string, meetingId: string | undefined) {
  if (meetingId) return `call-notes:${meetingId}`;
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `call-notes:${appId}:${day}`;
}

/** Unsaved notepad text, kept on the device so leaving the page by accident loses nothing. */
const draftKey = (ref: string) => `kk.${ref}`;
function readDraft(ref: string) {
  try {
    return localStorage.getItem(draftKey(ref));
  } catch {
    return null;
  }
}
function writeDraft(ref: string, text: string | null) {
  try {
    if (text == null) localStorage.removeItem(draftKey(ref));
    else localStorage.setItem(draftKey(ref), text);
  } catch {
    /* best-effort */
  }
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Call Mode's keys, at a glance: moving around, then writing notes. */
function Shortcuts({ onClose }: { onClose: () => void }) {
  const SHIFT = MAC ? '⇧' : 'Shift+';
  const groups: [string, [string, string][]][] = [
    [
      'Moving around',
      [
        [`${ALT}/`, 'Notes ⇄ stories search'],
        [`${ALT}N`, 'Notes'],
        [`${ALT}Q`, 'Questions'],
        ['/', 'Stories search (when you’re not typing)'],
        ['Esc', 'Clear the stories search'],
      ],
    ],
    [
      'In your notes',
      [
        [`${MOD}B`, 'Bold'],
        [`${MOD}I`, 'Italic'],
        [`${MOD}U`, 'Underline'],
        [`${MOD}${SHIFT}X`, 'Strikethrough'],
        ['Q: ', 'Quick-add a question (it joins Questions)'],
        ['- ', 'Bulleted list'],
        ['1. ', 'Numbered list'],
        ['[ ] ', 'Task'],
        ['Tab', 'Indent a list item'],
        [`${SHIFT}Tab`, 'Outdent it'],
        [`${SHIFT}Enter`, 'New line in the same item'],
        [`${MOD}Z`, 'Undo'],
      ],
    ],
    ['In Questions', [['Enter', 'Add the question you typed']]],
  ];
  return (
    <Sheet title="Keyboard Shortcuts" icon="keyboard" onClose={onClose}>
      <div className="kb-groups">
        {groups.map(([title, keys]) => (
          <section key={title} className="kb-group">
            <h3>{title}</h3>
            <dl>
              {keys.map(([k, what]) => (
                <div key={k} className="kb-row">
                  <dt>
                    <kbd>{k.trim()}</kbd>
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

export function CallMode() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const data = useData();
  const act = useActions();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [ending, setEnding] = useState(false);
  const [keys, setKeys] = useState(false);
  // How much of the width the notes side takes (the rest is stories), kept on this device.
  const grid = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(() => {
    try {
      const v = Number(localStorage.getItem('kk:call-split'));
      return v >= MIN_SPLIT && v <= MAX_SPLIT ? v : 50;
    } catch {
      return 50;
    }
  });
  const setSplitKept = (v: number) => {
    const next = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, v));
    setSplit(next);
    try {
      localStorage.setItem('kk:call-split', String(Math.round(next)));
    } catch {
      /* private mode: it lasts for this visit */
    }
  };
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = grid.current?.getBoundingClientRect();
    if (!box) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('cmv-dragging');
    const move = (ev: PointerEvent) => setSplitKept(((ev.clientX - box.left) / box.width) * 100);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('cmv-dragging');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  const [reflection, setReflection] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // The notes side: Notes, or the meeting's Questions.
  const [side, setSide] = useState<'notes' | 'questions'>('notes');
  /** To the notes, the cursor at their end (scrolled into view). */
  const toNotes = () => {
    setSide('notes');
    // Once the editor is there (it may be loading after a switch from Questions).
    let tries = 0;
    const go = () => {
      if (document.querySelector('.cmv-notes .cm-content'))
        window.dispatchEvent(new Event(FOCUS_NOTES_END));
      else if (tries++ < 20) requestAnimationFrame(go);
    };
    requestAnimationFrame(go);
  };
  // Keys: / goes to the stories search (when not typing); Option+/ (Alt+/) goes back and forth
  // between the notes and the search, from anywhere, so hands never leave the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const alt = e.altKey && !e.metaKey && !e.ctrlKey;
      // Option+/: between the notes and the stories search.
      if (alt && e.code === 'Slash') {
        e.preventDefault();
        e.stopPropagation();
        if (el && el === searchRef.current) toNotes();
        else searchRef.current?.focus();
        return;
      }
      // Option+N: the Notes tab (the cursor at the end); Option+Q: the Questions tab.
      if (alt && e.code === 'KeyN') {
        e.preventDefault();
        e.stopPropagation();
        toNotes();
        return;
      }
      if (alt && e.code === 'KeyQ') {
        e.preventDefault();
        e.stopPropagation();
        setSide('questions');
        requestAnimationFrame(() =>
          document.querySelector<HTMLInputElement>('.cmv-notes .cmq-add input')?.focus(),
        );
        return;
      }
      if (
        e.key === '/' &&
        el?.tagName !== 'INPUT' &&
        el?.tagName !== 'TEXTAREA' &&
        !el?.isContentEditable
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const a = data?.appById.get(id);
  const events = useMemo(() => (data && a ? (data.eventsByApp.get(a.id) ?? []) : []), [data, a]);
  const meeting: TimelineEvent | undefined = useMemo(() => {
    const want = params.get('meeting');
    const meetings = events.filter((e) => e.type === 'meeting');
    if (want) return meetings.find((m) => m.id === want);
    // The one happening now or next, else the most recent.
    const t = new Date();
    return (
      meetings.find((m) => Math.abs(Date.parse(m.occurred_at) - t.getTime()) < 2 * 3600_000) ??
      meetings
        .filter((m) => isUpcoming(m, t))
        .sort((x, y) => x.occurred_at.localeCompare(y.occurred_at))[0] ??
      meetings.sort((x, y) => y.occurred_at.localeCompare(x.occurred_at))[0]
    );
  }, [events, params]);

  // ---------- notepad: one note per call, saved as you type ----------
  const ref = a ? callRef(a.id, meeting?.id) : '';
  const noteEv = events.find((e) => e.type === 'note' && e.external_ref === ref);
  const noteId = useRef<string | null>(null);
  const eventsRef = useRef<TimelineEvent[]>([]);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);
  const meetingId = meeting?.id;
  // The meeting's own questions (and what was said to the job's), as saved on it.
  const meetingQs = useMemo(
    () => (meeting?.data as MeetingData | undefined)?.questions ?? [],
    [meeting],
  );
  // On the call: the job's questions (every call for it), then the meeting's own.
  const jobQs = useMemo(
    () => (data && a ? data.state.job_questions.filter((j) => j.application_id === a.id) : []),
    [data, a],
  );
  const questions = useMemo(() => callList(jobQs, meetingQs), [jobQs, meetingQs]);
  const questionsRef = useRef<CallQuestion[]>(meetingQs);
  useEffect(() => {
    questionsRef.current = meetingQs;
  }, [meetingQs]);
  const saveQuestions = useCallback(
    (list: CallQuestion[]) => {
      const keep = meetingKeeps(list);
      questionsRef.current = keep;
      if (meetingId) void act.patch(`/events/${meetingId}`, { questions: keep });
    },
    [act, meetingId],
  );
  const saved = useRef('');
  const latest = useRef('');
  const queue = useRef<Promise<void>>(Promise.resolve());
  const loadedFor = useRef<string | null>(null);

  const save = useCallback(() => {
    // One save at a time, so the first one creates the note and the rest update it.
    queue.current = queue.current.then(async () => {
      const text = latest.current;
      if (!a || !text.trim() || text === saved.current) return;
      setSaveState('saving');
      // This call's note may already exist (made on another device, or before the page reloaded):
      // then it's updated, never made twice.
      noteId.current ??= eventsRef.current.find((e) => e.external_ref === ref)?.id ?? null;
      const create = async () => {
        try {
          const made = await api.post<TimelineEvent>(`/applications/${a.id}/notes`, {
            body: text,
            title: 'Call notes',
            parent_id: meeting?.id ?? null,
            external_ref: ref,
          });
          await act.refresh();
          return made;
        } catch (e) {
          const existing =
            e instanceof ApiError && e.code === 'duplicate'
              ? (e.details as { event_id?: string } | undefined)?.event_id
              : undefined;
          if (existing) return act.patch<TimelineEvent>(`/events/${existing}`, { body: text });
          return act.run(() => Promise.reject(e));
        }
      };
      const r = noteId.current
        ? await act.patch<TimelineEvent>(`/events/${noteId.current}`, { body: text })
        : await create();
      if (!r) return setSaveState('error');
      noteId.current = r.id;
      saved.current = text;
      // Questions marked in the notes ("Q: …") join the meeting's list.
      if (meetingId) {
        const cur = questionsRef.current;
        const next = withNoteQuestions(cur, text);
        if (next !== cur) {
          questionsRef.current = next;
          await act.patch(`/events/${meetingId}`, { questions: savable(next) });
        }
      }
      if (latest.current === text) {
        writeDraft(ref, null);
        setSaveState('saved');
      }
    });
    return queue.current;
  }, [a, act, meeting?.id, meetingId, ref]);

  // Load this call's note (or an unsaved draft from this device) once.
  useEffect(() => {
    if (!data || !a || loadedFor.current === ref) return;
    loadedFor.current = ref;
    noteId.current = noteEv?.id ?? null;
    saved.current = noteEv?.body ?? '';
    const draft = readDraft(ref);
    const text = draft ?? saved.current;
    latest.current = text;
    setNotes(text);
    setSaveState(draft != null && draft !== saved.current ? 'idle' : noteEv ? 'saved' : 'idle');
    if (draft != null && draft !== saved.current) void save();
  }, [data, a, ref, noteEv, save]);

  // Save about a second after typing stops, and on the way out.
  useEffect(() => {
    if (notes === saved.current) return;
    const t = setTimeout(() => void save(), 1000);
    return () => clearTimeout(t);
  }, [notes, save]);
  useEffect(() => () => void save(), [save]);

  function typeNotes(text: string) {
    latest.current = text;
    setNotes(text);
    setSaveState('idle');
    writeDraft(ref, text);
  }

  async function leave(withReflection: boolean) {
    setBusy(true);
    await save();
    if (withReflection && reflection.trim()) {
      const ok = await act.post(
        `/applications/${a!.id}/notes`,
        { body: reflection, title: 'How it went', parent_id: meeting?.id ?? null },
        'Saved to the timeline',
      );
      if (!ok) return setBusy(false);
    }
    nav(`/a/${a!.id}`);
  }

  const items: Item[] = useMemo(() => {
    if (!data || !a) return [];
    const fw = data.state.frameworks;
    const job = data.state.job_stories
      .filter((j) => j.application_id === a.id)
      .sort((x, y) => x.position - y.position)
      .map((j) => ({ ...j, kind: 'job' as const, defs: j.section_defs }));
    const linked = new Set(job.map((j) => j.story_id));
    const bank = data.state.stories
      .filter((s) => !s.archived && !linked.has(s.id))
      .map((s) => ({
        ...s,
        kind: 'bank' as const,
        defs: frameworkOf(s.framework_key, fw)?.sections ?? [],
      }));
    return [...job, ...bank];
  }, [data, a]);

  const frameworks = data?.state.frameworks;
  const hits = useMemo(() => searchStories(items, q, frameworks), [items, q, frameworks]);

  if (!data) return null;
  if (!a)
    return (
      <div className="empty">
        That application is gone. <Link to="/jobs">Back</Link>
      </div>
    );

  const md = meeting?.data as MeetingData | undefined;
  const attendees = md?.attendees.map((x) => x.name) ?? [];
  const current = items.find((i) => i.id === sel) ?? hits[0]?.item ?? items[0];
  const start = meeting ? Date.parse(meeting.occurred_at) : null;
  const live = start != null && now >= start && now - start < 4 * 3600_000;

  const row = (i: Item) => (
    <button
      key={i.id}
      type="button"
      className={cx('cmv-row', current?.id === i.id && 'on')}
      aria-pressed={current?.id === i.id}
      onClick={() => setSel(i.id)}
    >
      <strong>{i.title}</strong>
      <span>{frameworkOf(i.framework_key, data.state.frameworks)?.name ?? i.framework_key}</span>
    </button>
  );
  const jobHits = hits.filter((h) => h.item.kind === 'job').map((h) => h.item);
  const bankHits = hits.filter((h) => h.item.kind === 'bank').map((h) => h.item);

  const notesStatus =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'error'
        ? 'Couldn’t save yet; kept on this device.'
        : '';

  return (
    <div className="cmv">
      <header className="cmv-bar">
        <Link className="btn sm cmv-back" to={`/a/${a.id}`}>
          <Icon name="back" size={16} /> Back
        </Link>
        <span className="cmv-badge live">
          <i aria-hidden="true" />
          CALL MODE
        </span>
        <div className="cmv-title">
          <strong>
            {meeting ? meeting.title || meetingKindLabel(md!.kind) : 'Interview'} · {a.company}
          </strong>
          <span>
            {a.title}
            {meeting ? ` · ${whenLabel(meeting.occurred_at)}` : ''}
          </span>
        </div>
        {/* Who's in the room and the topics, behind an "i" beside the title (hover, focus or tap). */}
        {((meeting && attendees.length > 0) || md?.agenda) && (
          <InfoTip label="Who's in the room and the topics">
            {meeting && attendees.length > 0 && (
              <span className="cmv-infosec">
                <strong className="cmv-h">In the Room</strong>
                {md!.attendees.map((p) => (
                  <span key={p.name} className="cmv-person">
                    <strong>{p.name}</strong>
                    {p.title && <span> · {p.title}</span>}
                  </span>
                ))}
              </span>
            )}
            {md?.agenda && (
              <span className="cmv-infosec">
                <strong className="cmv-h">Topics</strong>
                <span className="cmv-pre">{md.agenda}</span>
              </span>
            )}
          </InfoTip>
        )}
        <button type="button" className="btn sm" onClick={() => setKeys(true)}>
          <Icon name="keyboard" size={16} /> Shortcuts
        </button>
        <span className="cmv-clock">
          {live
            ? clock(now - start!)
            : start && start > now
              ? `Starts in ${clock(start - now)}`
              : null}
        </span>
        {md?.join_url && (
          <a className="btn sm" href={md.join_url} target="_blank" rel="noreferrer">
            Join
          </a>
        )}
        <button
          type="button"
          className="btn sm cmv-end"
          onClick={() => {
            void save();
            setEnding(true);
          }}
        >
          End call
        </button>
      </header>

      <div
        className="cmv-grid"
        ref={grid}
        style={{ '--cmv-split': `${split}%` } as React.CSSProperties}
      >
        <div className="cmv-left">
          <section className="cmv-card cmv-notes">
            <div className="cmv-notes-head">
              {/* Notes, or (with a meeting) its questions: prepared ahead or marked "Q:". */}
              {meeting ? (
                <div className="tabs cmv-tabs" role="tablist" aria-label="Notes or questions">
                  <button
                    type="button"
                    role="tab"
                    className="tab"
                    aria-selected={side === 'notes'}
                    title={`Notes (${ALT}N)`}
                    onClick={() => setSide('notes')}
                  >
                    Notes
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className="tab"
                    aria-selected={side === 'questions'}
                    title={`Questions (${ALT}Q)`}
                    onClick={() => setSide('questions')}
                  >
                    Questions
                    {questions.length > 0 && (
                      <span className="count">{questions.filter((x) => !x.asked).length}</span>
                    )}
                  </button>
                </div>
              ) : (
                <h2 className="cmv-h">Call Notes</h2>
              )}
              <span className="cmv-key" title="Go to the stories search">
                <kbd>{ALT}/</kbd>
              </span>
              <span className={cx('cmv-save', saveState === 'error' && 'bad')} aria-live="polite">
                {notesStatus}
              </span>
            </div>
            {side === 'questions' && meeting ? (
              // On the call: no adding from the bank (that's for preparing, on the meeting).
              <CallQuestions questions={questions} onChange={saveQuestions} />
            ) : (
              <Suspense fallback={<div className="notes-editor cmv-notes-wait" />}>
                <NotesEditor
                  value={notes}
                  onChange={typeNotes}
                  onBlur={() => void save()}
                  label="Call notes"
                  placeholder="Jot it down as you go…"
                />
              </Suspense>
            )}
          </section>
        </div>

        {/* Drag left or right to give notes or stories more room (30% to 70%); double-click
            puts it back in the middle. */}
        <div
          className="cmv-split"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize notes and stories"
          aria-valuenow={Math.round(split)}
          aria-valuemin={MIN_SPLIT}
          aria-valuemax={MAX_SPLIT}
          tabIndex={0}
          onPointerDown={startDrag}
          onDoubleClick={() => setSplitKept(50)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setSplitKept(split - 5);
            if (e.key === 'ArrowRight') setSplitKept(split + 5);
          }}
        >
          <span className="cmv-split-grip" aria-hidden />
        </div>

        <section className="cmv-card cmv-stories">
          <div className="cmv-notes-head">
            <h2 className="cmv-h">Stories</h2>
            <span className="cmv-key" title="Go to the notes">
              <kbd>{ALT}/</kbd>
            </span>
          </div>
          <label className="cmv-search">
            <Icon name="search" size={18} />
            <input
              ref={searchRef}
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSel(null);
              }}
              placeholder="Type the question you just heard…"
              aria-label="Search stories"
              onKeyDown={(e) => {
                // Escape clears the search.
                if (e.key === 'Escape' && q) {
                  e.preventDefault();
                  setQ('');
                  setSel(null);
                }
              }}
            />
            <SearchClear value={q} onClear={() => setQ('')} />
          </label>
          <div className="cmv-stories-body">
            <div className="cmv-list">
              {jobHits.length > 0 && (
                <>
                  <span className="cmv-group">This job · {jobHits.length}</span>
                  {jobHits.map(row)}
                </>
              )}
              {bankHits.length > 0 && (
                <>
                  <span className="cmv-group">Story Bank · {bankHits.length}</span>
                  {bankHits.map(row)}
                </>
              )}
              {!hits.length && items.length > 0 && (
                <p className="cmv-empty">Nothing matches. Try fewer words.</p>
              )}
            </div>
            <article className="cmv-reader">
              {current ? (
                <>
                  <span className="cmv-meta">
                    {frameworkOf(current.framework_key, data.state.frameworks)?.name ??
                      current.framework_key}{' '}
                    · {current.kind === 'job' ? 'linked to this job' : 'from Stories'}
                  </span>
                  <h2 className="cmv-reader-title">{current.title}</h2>
                  {'angle' in current && current.angle && (
                    <div className="cmv-angle">{current.angle}</div>
                  )}
                  {current.defs.map((d) =>
                    current.sections[d.key]?.trim() ? (
                      <div key={d.key} className="cmv-sec">
                        <b aria-hidden="true">{sectionLetter(d.label)}</b>
                        <div>
                          <span className="cmv-sec-label">{d.label}</span>
                          <p className="cmv-pre">{current.sections[d.key]}</p>
                        </div>
                      </div>
                    ) : null,
                  )}
                </>
              ) : (
                <p className="cmv-empty">
                  No stories yet. Add some in <Link to="/stories">Stories</Link>.
                </p>
              )}
            </article>
          </div>
        </section>
      </div>

      {keys && <Shortcuts onClose={() => setKeys(false)} />}
      {ending && (
        <Sheet
          title="How Did It Go?"
          icon="smile"
          sub="Your call notes are already saved."
          onClose={() => void leave(false)}
          footer={
            <>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void leave(false)}
              >
                Skip
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy || !reflection.trim()}
                onClick={() => void leave(true)}
              >
                Save to timeline
              </button>
            </>
          }
        >
          <Field label="Reflections">
            <AutoTextarea
              className="in"
              rows={6}
              autoFocus
              value={reflection}
              onChange={(e) => setReflection(e.target.value)}
            />
          </Field>
        </Sheet>
      )}
    </div>
  );
}

/**
 * The "i" beside Call Mode's title: who's in the room and the topics. Opens on hover or focus
 * on a computer and on tap on a phone (Safari doesn't focus a tapped button), and closes on a
 * tap elsewhere or Escape. It's placed under the button but kept inside the window, so it never
 * runs off either edge wherever the header puts the button.
 */
function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btn.current?.getBoundingClientRect();
      const w = pop.current?.offsetWidth ?? 0;
      if (!b) return;
      const gap = 12;
      const left = Math.max(gap, Math.min(b.left, window.innerWidth - w - gap));
      setPos({ top: b.bottom + 8, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <span
      ref={wrap}
      className="cmv-infotip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={btn}
        type="button"
        className="cmv-i"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="info" size={18} />
      </button>
      {open && (
        <span
          ref={pop}
          className="cmv-infopop"
          role="tooltip"
          style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
        >
          {children}
        </span>
      )}
    </span>
  );
}
