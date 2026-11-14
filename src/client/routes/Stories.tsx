import { useMemo, useState } from 'react';
import { frameworkOf, searchStories } from '@shared/logic/stories';
import { useData } from '../lib/queries';
import { useSheets } from '../sheets/context';
import { Icon } from '../components/Icon';
import { PageHeader, SlideToggle, cx } from '../components/ui';

export function Stories() {
  const data = useData();
  const sheets = useSheets();
  const [q, setQ] = useState('');
  const [fw, setFw] = useState<string>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const stories = useMemo(() => data?.state.stories ?? [], [data]);
  const tags = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of stories) for (const t of s.tags) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [stories]);
  if (!data) return null;
  const frameworks = data.state.frameworks;
  const used = frameworks.filter((f) => stories.some((s) => s.framework_key === f.key));
  const pool = stories.filter(
    (s) => s.archived === archived && (fw === 'all' || s.framework_key === fw),
  );
  const hits = searchStories(pool, q, tag);
  const custom = frameworks.filter((f) => !f.builtin);

  return (
    <>
      <PageHeader
        title="Story bank"
        action={
          <button type="button" className="btn primary" onClick={() => sheets.newStory()}>
            <Icon name="plus" size={18} /> New story
          </button>
        }
      />
      <p className="sub page-sub">
        Templates. Linking one to a job makes a copy you can tailor; the bank only changes when you
        push.
      </p>
      <div className="toolbar">
        <label className="search-in">
          <Icon name="search" size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search, or type a question"
            aria-label="Search stories"
          />
        </label>
      </div>
      {used.length > 1 && (
        <SlideToggle
          label="Framework"
          value={fw}
          onChange={setFw}
          options={[
            ['all', `All ${stories.filter((s) => s.archived === archived).length}`],
            ...used.map(
              (f) =>
                [
                  f.key,
                  `${f.name} ${stories.filter((s) => s.framework_key === f.key && s.archived === archived).length}`,
                ] as const,
            ),
          ]}
        />
      )}
      {tags.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <SlideToggle
            label="Competency"
            value={tag}
            onChange={setTag}
            allowClear
            options={tags.map((t) => [t, t] as const)}
          />
        </div>
      )}
      <div className="story-grid">
        {hits.map(({ item: s, question }) => {
          const copies = data.state.job_stories.filter((j) => j.story_id === s.id);
          const told = data.state.tells.filter((t) =>
            copies.some((c) => c.id === t.job_story_id),
          ).length;
          return (
            <button
              key={s.id}
              type="button"
              className="story-card"
              onClick={() => sheets.story({ id: s.id })}
            >
              <span className="fw-tag">
                {frameworkOf(s.framework_key, frameworks)?.name ?? s.framework_key}
              </span>
              <strong className="story-title">{s.title}</strong>
              {s.hook && <span className="sub">{s.hook}</span>}
              {question && q && <span className="answers">Answers: “{question}”</span>}
              {s.tags.length > 0 && (
                <span className="tags">
                  {s.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </span>
              )}
              <span className="mono sub">
                v{s.version} · in {copies.length} {copies.length === 1 ? 'job' : 'jobs'} · told{' '}
                {told}×
              </span>
            </button>
          );
        })}
      </div>
      {!stories.length && (
        <div className="card empty-state">
          <h2>Your stories, written once.</h2>
          <p className="sub">
            Start with an Introduction (tell me about yourself) and a Why this job, then the five or
            six STAR stories you tell most. Or ask your assistant: “Write a STAR story about the
            time I… and add it to my story bank.”
          </p>
          <button type="button" className="btn primary" onClick={() => sheets.newStory()}>
            New story
          </button>
        </div>
      )}
      {stories.length > 0 && !hits.length && <p className="empty">Nothing matches.</p>}
      <div className="acts" style={{ marginTop: 18 }}>
        <button
          type="button"
          className={cx('btn sm', archived && 'primary')}
          onClick={() => setArchived((v) => !v)}
        >
          {archived ? 'Show current' : 'Show archived'}
        </button>
      </div>

      <section className="sec">
        <div className="sec-h">
          <h2>Custom frameworks</h2>
          <button type="button" className="more" onClick={() => sheets.framework()}>
            + New framework
          </button>
        </div>
        {custom.length ? (
          <div className="card list">
            {custom.map((f) => (
              <button
                key={f.key}
                type="button"
                className="recent"
                onClick={() => sheets.framework(f.key)}
              >
                <strong>{f.name}</strong>
                <span className="sub">{f.sections.map((x) => x.label).join(' · ')}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="sub">
            STAR, CAR, SOAR, Introduction, Why this job, Why I’m looking, Failure, Weakness and
            Design decision are built in. Add your own here.
          </p>
        )}
      </section>
    </>
  );
}
