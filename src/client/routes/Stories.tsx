import { useMemo, useState } from 'react';
import { frameworkOf, searchStories } from '@shared/logic/stories';
import { useData } from '../lib/queries';
import { storyCounts } from '../lib/filters';
import { useViewState } from '../lib/viewState';
import { useSheets } from '../sheets/context';
import { Icon } from '../components/Icon';
import {
  FilterButton,
  FilterGroup,
  FilterSheet,
  PageHeader,
  SearchClear,
  cx,
} from '../components/ui';

export function Stories() {
  const data = useData();
  const sheets = useSheets();
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState(false);
  // Remembered on this device and kept in the address (?fw=star,car&group=framework&archived=1).
  const [choice, choose] = useViewState('kk:stories', { fw: 'all', archived: '', group: '' });
  const grouped = choice.group === 'framework';
  const archived = choice.archived === '1';
  const stories = useMemo(() => data?.state.stories ?? [], [data]);
  const frameworks = useMemo(() => data?.state.frameworks ?? [], [data]);
  const counts = useMemo(
    () => storyCounts(stories, frameworks, archived),
    [stories, frameworks, archived],
  );
  if (!data) return null;
  const used = counts.frameworks;
  // The frameworks picked (any number; none picked is All). One from an old link that no longer
  // has stories is dropped.
  const picked = new Set(choice.fw.split(',').filter((k) => used.some((f) => f.key === k)));
  const all = picked.size === 0;
  const pick = (next: Set<string>) => choose({ fw: next.size ? [...next].join(',') : 'all' });
  const toggle = (key: string) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    pick(next);
  };
  const pool = stories.filter(
    (s) => s.archived === archived && (all || picked.has(s.framework_key)),
  );
  const hits = searchStories(pool, q, frameworks);
  // Grouped by framework: one section per framework, in the frameworks' own order.
  const groups = grouped
    ? frameworks
        .map((f) => ({ f, items: hits.filter((h) => h.item.framework_key === f.key) }))
        .filter((g) => g.items.length)
    : [{ f: null, items: hits }];
  const on = (all ? 0 : 1) + (grouped ? 1 : 0);
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
      {/* Current stories, and the archive beside them: two tabs, each with its count. */}
      <div className="tabs" role="tablist" aria-label="Which stories">
        {(
          [
            ['', 'Current', 'book', stories.filter((x) => !x.archived).length],
            ['1', 'Archive', 'archive', stories.filter((x) => x.archived).length],
          ] as const
        ).map(([v, l, icon, n]) => (
          <button
            key={l}
            type="button"
            role="tab"
            aria-selected={choice.archived === v || (!v && !archived)}
            className="tab"
            onClick={() => choose({ archived: v })}
          >
            <Icon name={icon} size={16} />
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
          <SearchClear value={q} onClear={() => setQ('')} />
        </label>
        {/* Filters offer only frameworks that have stories; grouping whenever there are stories. */}
        {counts.all > 0 && <FilterButton count={on} onClick={() => setFilters(true)} />}
      </div>
      {filters && (
        <FilterSheet
          count={on}
          onClose={() => setFilters(false)}
          onClear={() => choose({ fw: 'all', group: '' })}
        >
          {/* Any number of frameworks; All clears the others (and is on when none is). */}
          <FilterGroup title="Framework">
            <div className="check-list" role="group" aria-label="Framework">
              {[{ key: 'all', name: 'All', n: counts.all }, ...used].map((f) => {
                const checked = f.key === 'all' ? all : picked.has(f.key);
                return (
                  <button
                    key={f.key}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    className={cx('check-opt', checked && 'on')}
                    onClick={() => (f.key === 'all' ? pick(new Set()) : toggle(f.key))}
                  >
                    <span className="check-box" aria-hidden="true">
                      {checked && <Icon name="check" size={13} />}
                    </span>
                    {f.name}
                    <span className="count">{f.n}</span>
                  </button>
                );
              })}
            </div>
          </FilterGroup>
          <FilterGroup title="Group by">
            <div className="check-list" role="radiogroup" aria-label="Group by">
              {(
                [
                  ['', 'None'],
                  ['framework', 'Framework'],
                ] as const
              ).map(([v, l]) => {
                const checked = (choice.group || '') === v;
                return (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    className={cx('check-opt radio', checked && 'on')}
                    onClick={() => choose({ group: v })}
                  >
                    <span className="check-box" aria-hidden="true">
                      {checked && <Icon name="check" size={13} />}
                    </span>
                    {l}
                  </button>
                );
              })}
            </div>
          </FilterGroup>
        </FilterSheet>
      )}
      {groups.map((g) => (
        <section key={g.f?.key ?? 'all'} className={g.f ? 'story-group' : undefined}>
          {g.f && (
            <h2 className="story-group-h">
              {g.f.name}
              <span className="count">{g.items.length}</span>
            </h2>
          )}
          <div className="story-grid">
            {g.items.map(({ item: s }) => {
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
        </section>
      ))}
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
