// Call mode: open it beside the video call. Type the question you just heard and the stories
// whose probable questions match rise to the top (plain word overlap: instant, offline). This
// job's copies come first, then the whole bank. The notepad saves itself into one note on
// the job's timeline (on the meeting, if there is one) and stays on screen; ending the call
// asks how it went and saves that as its own note.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { meetingKindLabel } from '@shared/lookups';
import { frameworkOf, searchStories } from '@shared/logic/stories';
import { isUpcoming } from '@shared/logic/timeline';
import { sectionLetter, storyExtras, type FrameworkSection } from '@shared/frameworks';
import type { JobStory, MeetingData, Story, TimelineEvent } from '@shared/types';
import { useActions, useData } from '../lib/queries';
import { whenLabel } from '../lib/format';
import { Asterisk } from '../components/Brand';
import { Icon } from '../components/Icon';
import { AutoTextarea, Field, Sheet, SlideToggle, cx } from '../components/ui';

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
  const [tag, setTag] = useState<string | null>(null);
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
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
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

  const hits = useMemo(() => searchStories(items, q, tag), [items, q, tag]);
  const tags = useMemo(() => {
    const count = new Map<string, number>();
    for (const i of items)
      for (const t of i.tags) count.set(t, (count.get(t) ?? 0) + (i.kind === 'job' ? 3 : 1));
    return [...count.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 10)
      .map(([t]) => t);
  }, [items]);

  if (!data) return null;
  if (!a)
    return (
      <div className="empty">
        That application is gone. <Link to="/pipeline">Back</Link>
      </div>
    );

  const md = meeting?.data as MeetingData | undefined;
  const attendees = md?.attendees.map((x) => x.name) ?? [];
  const current = items.find((i) => i.id === sel) ?? hits[0]?.item ?? items[0];
  const curHit = hits.find((h) => h.item.id === current?.id);
  const start = meeting ? Date.parse(meeting.occurred_at) : null;
  const live = start != null && now >= start && now - start < 4 * 3600_000;

  const row = (i: Item) => {
    const hit = hits.find((h) => h.item.id === i.id);
    return (
      <button
        key={i.id}
        type="button"
        className={cx('srow', current?.id === i.id && 'on', i.kind === 'bank' && 'bank')}
        onClick={() => setSel(i.id)}
      >
        <span className="srow-top">
          <strong>{i.title}</strong>
        </span>
        {i.hook && <span className="srow-hook">{i.hook}</span>}
        {hit?.question && q && <span className="answers">Answers: “{hit.question}”</span>}
      </button>
    );
  };
  const jobHits = hits.filter((h) => h.item.kind === 'job').map((h) => h.item);
  const bankHits = hits.filter((h) => h.item.kind === 'bank').map((h) => h.item);

  return (
    <div className="call">
      <header className="call-bar">
        <Asterisk size={22} />
        <span className="call-tag">CALL MODE</span>
        <strong className="call-name">
          {meeting ? meeting.title || meetingKindLabel(md!.kind) : 'Interview'} · {a.company}
        </strong>
        <span className="call-sub">
          {a.title}
          {meeting ? ` · ${whenLabel(meeting.occurred_at)}` : ''}
        </span>
        <span className="call-clock mono">
          {live ? (
            <>
              <i className="live" /> LIVE {clock(now - start!)}
            </>
          ) : start && start > now ? (
            `Starts in ${clock(start - now)}`
          ) : null}
        </span>
        {md?.join_url && (
          <a className="btn sm" href={md.join_url} target="_blank" rel="noreferrer">
            Join
          </a>
        )}
        <button
          type="button"
          className="btn sm primary"
          onClick={() => {
            void save();
            setEnding(true);
          }}
        >
          End call
        </button>
      </header>

      <div className="call-cols">
        <aside className="call-left">
          {meeting && attendees.length > 0 && (
            <section className="card">
              <span className="lbl">In the room</span>
              {md!.attendees.map((p) => (
                <div key={p.name} className="room-p">
                  <strong>{p.name}</strong>
                  {p.title && <span className="sub"> · {p.title}</span>}
                </div>
              ))}
            </section>
          )}
          {md?.agenda && (
            <section className="card">
              <span className="lbl">Topics</span>
              <p className="pre">{md.agenda}</p>
            </section>
          )}
          <section className="card">
            <span className="lbl">Call notes</span>
            <p className="sub" aria-live="polite">
              {saveState === 'saving'
                ? 'Saving…'
                : saveState === 'error'
                  ? 'Couldn’t save yet; kept on this device.'
                  : `${saveState === 'saved' ? 'Saved' : 'Saves as you type'} to this job’s timeline${meeting ? ', on the meeting' : ''}.`}
            </p>
            <AutoTextarea
              className="in"
              rows={5}
              value={notes}
              onChange={(e) => typeNotes(e.target.value)}
              onBlur={() => void save()}
              placeholder="Jot things down as you go"
            />
          </section>
        </aside>

        <article className="call-reader card">
          {current ? (
            <>
              <div className="reader-meta">
                <span className="lbl">
                  {frameworkOf(current.framework_key, data.state.frameworks)?.name ??
                    current.framework_key}{' '}
                  · {current.kind === 'job' ? 'linked to this job' : 'from Stories'}
                </span>
                {current.tags.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
              <h2 className="reader-title">{current.title}</h2>
              {'angle' in current && current.angle && (
                <div className="angle-line big">{current.angle}</div>
              )}
              {current.hook && <p className="reader-hook">{current.hook}</p>}
              {current.defs.map((d) =>
                current.sections[d.key]?.trim() ? (
                  <div key={d.key} className="reader-sec">
                    <b aria-hidden="true">{sectionLetter(d.label)}</b>
                    <div>
                      <span className="lbl">{d.label}</span>
                      <p className="pre">{current.sections[d.key]}</p>
                    </div>
                  </div>
                ) : null,
              )}
              {current.questions.length > 0 &&
                storyExtras(
                  frameworkOf(current.framework_key, data.state.frameworks)?.group,
                ).includes('questions') && (
                  <div className="reader-qs">
                    <span className="lbl">Probable questions</span>
                    <div className="tags">
                      {current.questions.map((x) => (
                        <span key={x} className={cx('tag', curHit?.question === x && 'hit')}>
                          {x}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
            </>
          ) : (
            <p className="empty">
              No stories yet. Add some in <Link to="/stories">Stories</Link>.
            </p>
          )}
        </article>

        <aside className="call-right">
          <label className="call-search">
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
          {tags.length > 0 && (
            <SlideToggle
              label="Competency"
              value={tag}
              onChange={setTag}
              allowClear
              options={tags.map((t) => [t, t] as const)}
            />
          )}
          <span className="lbl">This job · {jobHits.length}</span>
          {jobHits.map(row)}
          <span className="lbl">Full bank · {bankHits.length}</span>
          {bankHits.map(row)}
          {!hits.length && <p className="sub">Nothing matches. Try fewer words.</p>}
        </aside>
      </div>

      {ending && (
        <Sheet
          title="How did it go?"
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
              placeholder="What went well, what to follow up on"
            />
          </Field>
        </Sheet>
      )}
    </div>
  );
}
