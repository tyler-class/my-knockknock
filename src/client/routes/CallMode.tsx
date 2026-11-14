// Call mode: open it beside the video call. Type the question you just heard and the stories
// whose probable questions match rise to the top (plain word overlap: instant, offline). This
// job's copies come first, then the whole bank. "Mark as told" logs it against the meeting.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { meetingKindLabel } from '@shared/lookups';
import { frameworkOf, searchStories } from '@shared/logic/stories';
import { isUpcoming } from '@shared/logic/timeline';
import { sectionLetter, type FrameworkSection } from '@shared/frameworks';
import type { JobStory, MeetingData, Story, TimelineEvent } from '@shared/types';
import { useActions, useData } from '../lib/queries';
import { whenLabel } from '../lib/format';
import { useSheets } from '../sheets/context';
import { Asterisk } from '../components/Brand';
import { Icon } from '../components/Icon';
import { SlideToggle, cx } from '../components/ui';

type Item = (JobStory | Story) & { kind: 'job' | 'bank'; defs: FrameworkSection[] };

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
  const sheets = useSheets();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [scratch, setScratch] = useState('');
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
  const tells = (jsId: string) => data.state.tells.filter((t) => t.job_story_id === jsId);
  const heardBy = (i: Item) =>
    i.kind === 'job'
      ? [...new Set(tells(i.id).flatMap((t) => t.heard_by))].filter((n) => attendees.includes(n))
      : [];
  const toldHere = (i: Item) =>
    i.kind === 'job' && meeting && tells(i.id).some((t) => t.event_id === meeting.id);
  const start = meeting ? Date.parse(meeting.occurred_at) : null;
  const live = start != null && now >= start && now - start < 4 * 3600_000;

  async function markTold(i: Item) {
    let jsId = i.id;
    if (i.kind === 'bank') {
      const js = await act.post<JobStory>(`/applications/${a!.id}/stories`, { story_id: i.id });
      if (!js) return;
      jsId = js.id;
      setSel(js.id);
    }
    await act.post(
      `/job-stories/${jsId}/tells`,
      { event_id: meeting?.id ?? null, heard_by: attendees },
      'Marked as told',
    );
  }

  async function saveScratch() {
    if (!scratch.trim()) return;
    const ok = await act.post(
      `/applications/${a!.id}/notes`,
      { body: scratch, title: 'During the call', parent_id: meeting?.id ?? null },
      'Saved to the meeting',
    );
    if (ok) setScratch('');
  }

  const row = (i: Item) => {
    const hit = hits.find((h) => h.item.id === i.id);
    const heard = heardBy(i);
    return (
      <button
        key={i.id}
        type="button"
        className={cx('srow', current?.id === i.id && 'on', i.kind === 'bank' && 'bank')}
        onClick={() => setSel(i.id)}
      >
        <span className="srow-top">
          <strong>{i.title}</strong>
          <span className="mono">{toldHere(i) ? 'TOLD ✓' : heard.length ? 'HEARD' : ''}</span>
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
            nav(`/a/${a.id}`);
            if (meeting) sheets.log(a.id, { type: 'note', parentId: meeting.id });
          }}
        >
          End call · debrief
        </button>
      </header>

      <div className="call-cols">
        <aside className="call-left">
          {meeting && attendees.length > 0 && (
            <section className="card">
              <span className="lbl">In the room</span>
              {md!.attendees.map((p) => {
                const heard = items.filter(
                  (i) => i.kind === 'job' && tells(i.id).some((t) => t.heard_by.includes(p.name)),
                );
                return (
                  <div key={p.name} className="room-p">
                    <strong>{p.name}</strong>
                    {p.title && <span className="sub"> · {p.title}</span>}
                    {heard.length > 0 && (
                      <div className="heard">Heard: {heard.map((h) => h.title).join(', ')}</div>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          {md?.agenda && (
            <section className="card">
              <span className="lbl">Topics</span>
              <p className="pre">{md.agenda}</p>
            </section>
          )}
          <section className="card">
            <span className="lbl">Scratch note</span>
            <textarea
              className="in"
              rows={5}
              value={scratch}
              onChange={(e) => setScratch(e.target.value)}
              placeholder="Saved to this meeting as a note"
            />
            <button
              type="button"
              className="btn sm"
              disabled={!scratch.trim()}
              onClick={saveScratch}
              style={{ marginTop: 8 }}
            >
              Save note
            </button>
          </section>
        </aside>

        <article className="call-reader card">
          {current ? (
            <>
              <div className="reader-meta">
                <span className="lbl">
                  {frameworkOf(current.framework_key, data.state.frameworks)?.name ??
                    current.framework_key}{' '}
                  · {current.kind === 'job' ? 'linked to this job' : 'from the bank'}
                </span>
                {current.tags.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
                {heardBy(current).length > 0 && (
                  <span className="heard-badge">{heardBy(current).join(' + ')} heard this</span>
                )}
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
              {current.questions.length > 0 && (
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
              <div className="reader-foot">
                <button
                  type="button"
                  className={cx('btn', !toldHere(current) && 'primary')}
                  disabled={!!toldHere(current)}
                  onClick={() => markTold(current)}
                >
                  {toldHere(current) ? 'Told it ✓' : 'Mark as told'}
                </button>
                <span className="sub">
                  {meeting
                    ? `Logs to this meeting${attendees.length ? `, heard by ${attendees.join(', ')}` : ''}.`
                    : 'No meeting picked: logs to the application.'}
                </span>
              </div>
            </>
          ) : (
            <p className="empty">
              No stories yet. Add some in the <Link to="/stories">story bank</Link>.
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
    </div>
  );
}
