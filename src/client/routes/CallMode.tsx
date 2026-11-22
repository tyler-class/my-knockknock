// Call mode: open it beside the video call. Type the question you just heard and the stories
// whose title, framework or parts share its words rise to the top (plain word overlap: instant,
// offline). This
// job's copies come first, then the whole bank. The notepad saves itself into one note on
// the job's timeline (on the meeting, if there is one) and stays on screen; ending the call
// asks how it went and saves that as its own note.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { meetingKindLabel } from '@shared/lookups';
import { frameworkOf, searchStories } from '@shared/logic/stories';
import { isUpcoming } from '@shared/logic/timeline';
import { sectionLetter, type FrameworkSection } from '@shared/frameworks';
import type { JobStory, MeetingData, Story, TimelineEvent } from '@shared/types';
import { useActions, useData } from '../lib/queries';
import { whenLabel } from '../lib/format';
import { Icon } from '../components/Icon';
import { AutoTextarea, Field, Sheet, cx } from '../components/ui';
import './callmode.css';

// The notes editor (CodeMirror) is big: it loads on its own, after the page.
const NotesEditor = lazy(() => import('../components/notes/NotesEditor'));

const MOD =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

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
  const [reflection, setReflection] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
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
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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
      const r = noteId.current
        ? await act.patch<TimelineEvent>(`/events/${noteId.current}`, { body: text })
        : await act.post<TimelineEvent>(`/applications/${a.id}/notes`, {
            body: text,
            title: 'Call notes',
            parent_id: meeting?.id ?? null,
            external_ref: ref,
          });
      if (!r) return setSaveState('error');
      noteId.current = r.id;
      saved.current = text;
      if (latest.current === text) {
        writeDraft(ref, null);
        setSaveState('saved');
      }
    });
    return queue.current;
  }, [a, act, meeting?.id, ref]);

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
        : saveState === 'saved'
          ? `Saved to the timeline${meeting ? ', on the meeting' : ''}.`
          : 'Saves as you type.';

  return (
    <div className="cmv">
      <header className="cmv-bar">
        <Link className="btn sm cmv-back" to={`/a/${a.id}`}>
          <Icon name="back" size={16} /> Back
        </Link>
        <span className={cx('cmv-badge', live && 'live')}>
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

      <div className="cmv-grid">
        <div className="cmv-left">
          {((meeting && attendees.length > 0) || md?.agenda) && (
            <div className="cmv-info">
              {meeting && attendees.length > 0 && (
                <section className="cmv-card">
                  <h2 className="cmv-h">In the Room</h2>
                  {md!.attendees.map((p) => (
                    <div key={p.name} className="cmv-person">
                      <strong>{p.name}</strong>
                      {p.title && <span> · {p.title}</span>}
                    </div>
                  ))}
                </section>
              )}
              {md?.agenda && (
                <section className="cmv-card">
                  <h2 className="cmv-h">Topics</h2>
                  <p className="cmv-pre">{md.agenda}</p>
                </section>
              )}
            </div>
          )}
          <section className="cmv-card cmv-notes">
            <div className="cmv-notes-head">
              <h2 className="cmv-h">Call Notes</h2>
              <span className={cx('cmv-save', saveState === 'error' && 'bad')} aria-live="polite">
                {notesStatus}
              </span>
            </div>
            <Suspense fallback={<div className="notes-editor cmv-notes-wait" />}>
              <NotesEditor
                value={notes}
                onChange={typeNotes}
                onBlur={() => void save()}
                label="Call notes"
                placeholder="Jot it down as you go…"
              />
            </Suspense>
            <p className="cmv-hints" aria-hidden="true">
              <span>
                <kbd>{MOD}B</kbd> bold
              </span>
              <span>
                <kbd>{MOD}I</kbd> italic
              </span>
              <span>
                <kbd>{MOD}U</kbd> underline
              </span>
              <span>
                <kbd>-</kbd> list
              </span>
              <span>
                <kbd>1.</kbd> numbered
              </span>
              <span>
                <kbd>[ ]</kbd> task
              </span>
            </p>
          </section>
        </div>

        <section className="cmv-card cmv-stories">
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
            />
            <kbd>/</kbd>
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
