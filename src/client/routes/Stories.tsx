import { useMemo, useState } from 'react';
import { frameworkOf, searchStories } from '@shared/logic/stories';
import { useData } from '../lib/queries';
import { storyCounts } from '../lib/filters';
import { useViewState } from '../lib/viewState';
import { useSheets } from '../sheets/context';
import { Icon } from '../components/Icon';
import { FilterButton, FilterGroup, FilterSheet, PageHeader, cx } from '../components/ui';

export function Stories() {
  const data = useData();
  const sheets = useSheets();
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState(false);
  // Remembered on this device and kept in the address (?fw=star&archived=1).
  const [choice, choose] = useViewState('kk:stories', { fw: 'all', archived: '' });
  const archived = choice.archived === '1';
  const stories = useMemo(() => data?.state.stories ?? [], [data]);
  const frameworks = useMemo(() => data?.state.frameworks ?? [], [data]);
  const counts = useMemo(
    () => storyCounts(stories, frameworks, archived),
    [stories, frameworks, archived],
  );
  if (!data) return null;
  const used = counts.frameworks;
  // A framework from an old link that no longer has stories falls back to all.
  const fw = used.some((f) => f.key === choice.fw) ? choice.fw : 'all';
  const pool = stories.filter(
    (s) => s.archived === archived && (fw === 'all' || s.framework_key === fw),
  );
  const hits = searchStories(pool, q, frameworks);
  const custom = frameworks.filter((f) => !f.builtin);

  return (
    <>
      <PageHeader
        title="Stories"
        icon="quote"
        action={
          <button type="button" className="btn primary" onClick={() => sheets.newStory()}>
            <Icon name="plus" size={18} /> New story
          </button>
        }
      />
      <p className="sub page-sub">
        Linking a story to a job gives that job its own copy to tailor. Changing it there doesn’t
        change it here unless you choose to.
      </p>
      {/* Current stories, and the archive beside them: two tabs, each with its count. */}
      <div className="tabs" role="tablist" aria-label="Which stories">
        {(
          [
            ['', 'Current', stories.filter((x) => !x.archived).length],
            ['1', 'Archived', stories.filter((x) => x.archived).length],
          ] as const
        ).map(([v, l, n]) => (
          <button
            key={l}
            type="button"
            role="tab"
            aria-selected={choice.archived === v || (!v && !archived)}
            className="tab"
            onClick={() => choose({ archived: v })}
          >
            {l}
            <span className="count">{n}</span>
          </button>
        ))}
      </div>
      <div className="toolbar" style={{ marginTop: 14 }}>
        <label className="search-in">
          <Icon name="search" size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search, or type a question"
            aria-label="Search stories"
          />
        </label>
        {/* Only the frameworks that have stories, so every choice finds something. */}
        {used.length > 1 && (
          <FilterButton count={fw === 'all' ? 0 : 1} onClick={() => setFilters(true)} />
        )}
      </div>
      {filters && (
        <FilterSheet
          count={fw === 'all' ? 0 : 1}
          onClose={() => setFilters(false)}
          onClear={() => choose({ fw: 'all' })}
        >
          <FilterGroup title="Framework">
            <div className="check-list" role="radiogroup" aria-label="Framework">
              {[{ key: 'all', name: 'All', n: counts.all }, ...used].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="radio"
                  aria-checked={fw === f.key}
                  className={cx('check-opt', fw === f.key && 'on')}
                  onClick={() => choose({ fw: f.key })}
                >
                  <span className="check-box" aria-hidden="true">
                    {fw === f.key && <Icon name="check" size={13} />}
                  </span>
                  {f.name}
                  <span className="count">{f.n}</span>
                </button>
              ))}
            </div>
          </FilterGroup>
        </FilterSheet>
      )}
      <div className="story-grid">
        {hits.map(({ item: s }) => {
          const copies = data.state.job_stories.filter((j) => j.story_id === s.id);
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
              <span className="mono sub">
                v{s.version} · in {copies.length} {copies.length === 1 ? 'job' : 'jobs'}
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
            time I… and add it to my Stories.”
          </p>
          <button type="button" className="btn primary" onClick={() => sheets.newStory()}>
            New story
          </button>
        </div>
      )}
      {stories.length > 0 && !hits.length && <p className="empty">Nothing matches.</p>}
      <section className="sec">
        <div className="sec-h">
          <h2>Custom Frameworks</h2>
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
