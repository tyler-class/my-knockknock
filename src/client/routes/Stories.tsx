import { useMemo, useState } from 'react';
import { frameworkOf, searchStories } from '@shared/logic/stories';
import { useActions, useData } from '../lib/queries';
import { storyCounts } from '../lib/filters';
import { useViewState } from '../lib/viewState';
import { useSheets } from '../sheets/context';
import { Icon } from '../components/Icon';
import { PrepareTabs } from '../components/PrepareTabs';
import {
  FilterButton,
  FilterGroup,
  FilterSheet,
  PageHeader,
  SearchClear,
  cx,
} from '../components/ui';

/** A trash icon; tap it and it asks "Delete?"; tap that to delete. */
function BankDelete({ onDelete }: { onDelete: () => unknown }) {
  const [arm, setArm] = useState(false);
  return arm ? (
    <button
      type="button"
      className="rm-job armed"
      autoFocus
      onClick={() => void onDelete()}
      onBlur={() => setArm(false)}
    >
      Delete?
    </button>
  ) : (
    <button
      type="button"
      className="rm-job"
      aria-label="Delete from Stories"
      onClick={() => setArm(true)}
    >
      <Icon name="trash" size={14} />
    </button>
  );
}

export function Stories() {
  const data = useData();
  const sheets = useSheets();
  const act = useActions();
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
  const on = (all ? 0 : 1) + (grouped ? 1 : 0) + (archived ? 1 : 0);
  const archivedCount = stories.filter((x) => x.archived).length;

  return (
    <>
      <PageHeader
        title="Stories"
        icon="quote"
        action={
          <span className="page-h-acts">
            <button type="button" className="btn" onClick={() => sheets.framework()}>
              <Icon name="layers" size={18} /> Custom framework
            </button>
            <button type="button" className="btn primary" onClick={() => sheets.newStory()}>
              <Icon name="plus" size={18} /> New story
            </button>
          </span>
        }
      />
      <PrepareTabs />
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
        {(counts.all > 0 || archivedCount > 0) && (
          <FilterButton count={on} onClick={() => setFilters(true)} />
        )}
      </div>
      {filters && (
        <FilterSheet
          count={on}
          onClose={() => setFilters(false)}
          onClear={() => choose({ fw: 'all', group: '', archived: '' })}
        >
          {/* Current stories, or the archive (each with its count). */}
          <FilterGroup title="Show">
            <div className="check-list" role="radiogroup" aria-label="Show">
              {(
                [
                  ['', 'Current', stories.length - archivedCount],
                  ['1', 'Archive', archivedCount],
                ] as const
              ).map(([v, l, n]) => {
                const checked = (choice.archived || '') === v;
                return (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    className={cx('check-opt radio', checked && 'on')}
                    onClick={() => choose({ archived: v })}
                  >
                    <span className="check-box" aria-hidden="true">
                      {checked && <Icon name="check" size={13} />}
                    </span>
                    {l}
                    <span className="count">{n}</span>
                  </button>
                );
              })}
            </div>
          </FilterGroup>
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
          {/* One card, a row per story: its framework, its title, then where it's used. */}
          {g.items.length > 0 && (
            <div className="card list story-rows">
              {g.items.map(({ item: s }) => {
                const copies = data.state.job_stories.filter((j) => j.story_id === s.id);
                return (
                  // The row opens the story; its trash deletes it from the bank (two taps;
                  // jobs keep their copies).
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    className="story-line story-row"
                    onClick={() => sheets.story({ id: s.id })}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget || e.key !== 'Enter') return;
                      sheets.story({ id: s.id });
                    }}
                  >
                    <span className="fw-tag">
                      {frameworkOf(s.framework_key, frameworks)?.name ?? s.framework_key}
                    </span>
                    <strong className="sc-title">{s.title}</strong>
                    <span className="story-row-meta">
                      v{s.version} · in {copies.length} {copies.length === 1 ? 'job' : 'jobs'}
                    </span>
                    <span onClick={(e) => e.stopPropagation()}>
                      <BankDelete onDelete={() => act.del(`/stories/${s.id}`, 'Deleted')} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
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
    </>
  );
}
