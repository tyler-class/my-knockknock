// The story bank's sheets: a bank story, picking a framework, a job's copy of a story (with
// push, pull and save-as-new), linking from the bank, and custom frameworks.
import { useMemo, useState } from 'react';
import type { FrameworkSection } from '@shared/frameworks';
import {
  SYNC_LABEL,
  frameworkOf,
  searchStories,
  switchFramework,
  syncState,
} from '@shared/logic/stories';
import type { Framework, JobStory, Story } from '@shared/types';
import { useActions, type Data } from '../lib/queries';
import { ConfirmButton, Field, Select, Sheet, TagInput, cx } from '../components/ui';
import { Icon } from '../components/Icon';
import { useSheets } from './context';

interface Content {
  framework_key: string;
  title: string;
  hook: string;
  tags: string[];
  sections: Record<string, string>;
  questions: string[];
  notes: string;
}

const contentOf = (s?: Story | JobStory, framework?: string): Content => ({
  framework_key: s?.framework_key ?? framework ?? 'star',
  title: s?.title ?? '',
  hook: s?.hook ?? '',
  tags: s?.tags ?? [],
  sections: s?.sections ?? {},
  questions: s?.questions ?? [],
  notes: s?.notes ?? '',
});

/** Every tag used anywhere, for suggestions. */
const allTags = (d: Data) =>
  [...new Set([...d.state.stories, ...d.state.job_stories].flatMap((s) => s.tags))].sort();

function StoryForm({
  data,
  v,
  set,
  defs,
}: {
  data: Data;
  v: Content;
  set: (p: Partial<Content>) => void;
  defs: FrameworkSection[];
}) {
  const fw = frameworkOf(v.framework_key, data.state.frameworks);
  const suggestions = (fw?.questions ?? []).filter((q) => !v.questions.includes(q));
  return (
    <>
      <div className="two">
        <Field label="Framework">
          <Select
            value={v.framework_key}
            onChange={(k) => {
              const to = frameworkOf(k, data.state.frameworks);
              if (!to) return;
              const moved = switchFramework(v.sections, defs, to.sections, v.notes || null);
              set({ framework_key: k, sections: moved.sections, notes: moved.notes ?? '' });
            }}
            groups={['Opener', 'Behavioral', 'Technical', 'Custom'].map((g) => ({
              label: g,
              options: data.state.frameworks
                .filter((f) => f.group === g)
                .map((f) => ({ value: f.key, label: f.name })),
            }))}
          />
        </Field>
        <Field label="Title">
          <input
            className="in"
            value={v.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Event bus for 14 integrations"
          />
        </Field>
      </div>
      <Field label="Hook: the line you say first">
        <input
          className="in"
          value={v.hook}
          onChange={(e) => set({ hook: e.target.value })}
          placeholder="14 point-to-point integrations → one bus. Sev-1s 3 a quarter → 0."
        />
      </Field>
      {defs.map((sec) => (
        <Field key={sec.key} label={sec.label}>
          <textarea
            className="in"
            rows={3}
            value={v.sections[sec.key] ?? ''}
            placeholder={sec.prompt}
            onChange={(e) => set({ sections: { ...v.sections, [sec.key]: e.target.value } })}
          />
        </Field>
      ))}
      <Field label="Competencies">
        <TagInput
          value={v.tags}
          onChange={(tags) => set({ tags })}
          suggestions={allTags(data)}
          placeholder="conflict, architecture, finance…"
        />
      </Field>
      <Field label="Probable questions (call mode matches what you type against these)">
        <TagInput
          value={v.questions}
          onChange={(questions) => set({ questions })}
          suggestions={[]}
          placeholder="Tell me about a time you disagreed with a leader."
        />
        {suggestions.length > 0 && (
          <div className="seg" style={{ marginTop: 8 }}>
            {suggestions.map((q) => (
              <button
                key={q}
                type="button"
                className="chip sm new"
                onClick={() => set({ questions: [...v.questions, q] })}
              >
                <Icon name="plus" size={13} /> {q}
              </button>
            ))}
          </div>
        )}
      </Field>
      <Field label="Notes">
        <textarea
          className="in"
          rows={2}
          value={v.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </Field>
    </>
  );
}

export function StorySheet({
  data,
  id,
  framework,
}: {
  data: Data;
  id?: string;
  framework?: string;
}) {
  const sheets = useSheets();
  const act = useActions();
  const s = id ? data.state.stories.find((x) => x.id === id) : undefined;
  const [v, setV] = useState<Content>(() => contentOf(s, framework));
  const set = (p: Partial<Content>) => setV((x) => ({ ...x, ...p }));
  const fw = frameworkOf(v.framework_key, data.state.frameworks);
  const copies = s ? data.state.job_stories.filter((j) => j.story_id === s.id) : [];
  const told = data.state.tells.filter((t) => copies.some((c) => c.id === t.job_story_id)).length;

  async function save() {
    const ok = s
      ? await act.patch(`/stories/${s.id}`, v, 'Saved')
      : await act.post('/stories', v, 'Added to the bank');
    if (ok) sheets.close();
  }

  return (
    <Sheet
      title={s ? 'Edit story' : `New ${fw?.name ?? ''} story`}
      sub={
        s
          ? `${fw?.name ?? s.framework_key} · v${s.version} · in ${copies.length} jobs · told ${told}×`
          : fw?.blurb
      }
      onClose={sheets.close}
      footer={
        <>
          {s && (
            <ConfirmButton
              className="left"
              confirm="Delete? Job copies stay."
              onConfirm={async () =>
                (await act.del(`/stories/${s.id}`, 'Deleted')) && sheets.close()
              }
            >
              Delete
            </ConfirmButton>
          )}
          {s && (
            <button
              type="button"
              className="btn"
              onClick={async () =>
                (await act.patch(`/stories/${s.id}`, { archived: !s.archived })) && sheets.close()
              }
            >
              {s.archived ? 'Unarchive' : 'Archive'}
            </button>
          )}
          <button type="button" className="btn primary" disabled={!v.title.trim()} onClick={save}>
            {s ? `Save as v${s.version + 1}` : 'Add to bank'}
          </button>
        </>
      }
    >
      <StoryForm data={data} v={v} set={set} defs={fw?.sections ?? []} />
      {copies.length > 0 && (
        <div className="callout">
          <span className="lbl">Copies in jobs · {copies.length}</span>
          <p className="sub">Saving here never changes these. Each job decides whether to pull.</p>
          {copies.map((c) => {
            const a = data.appById.get(c.application_id);
            const st = syncState(c, s);
            return (
              <div key={c.id} className="copy-row">
                <span>
                  <strong>{a?.company ?? 'Deleted application'}</strong>{' '}
                  <span className="sub">{a?.title}</span>
                </span>
                <span className={cx('sync', `sync-${st}`)}>{SYNC_LABEL[st]}</span>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

export function FrameworkPicker({ data, onPick }: { data: Data; onPick: (key: string) => void }) {
  const sheets = useSheets();
  return (
    <Sheet
      title="Pick a framework"
      sub="Every framework is just named sections. Same bank, same copies, same call mode."
      onClose={sheets.close}
    >
      <div className="fw-grid">
        {data.state.frameworks.map((f) => (
          <button key={f.key} type="button" className="fw-card" onClick={() => onPick(f.key)}>
            <span className="fw-name">
              {f.name}
              <span className="fw-group">{f.group}</span>
            </span>
            <span className="sub">{f.blurb}</span>
            <span className="fw-secs">
              {f.sections.map((s) => (
                <span key={s.key} className="fw-sec">
                  <b>{s.label[0]}</b>
                  {s.label}
                </span>
              ))}
            </span>
            {f.questions.length > 0 && <span className="fw-q">“{f.questions[0]}”</span>}
          </button>
        ))}
        <button type="button" className="fw-card custom" onClick={() => sheets.framework()}>
          <span className="fw-name">Custom</span>
          <span className="sub">Name your own sections. Saved as a framework you can reuse.</span>
        </button>
      </div>
    </Sheet>
  );
}

export function JobStorySheet({
  data,
  id,
  appId,
  framework,
}: {
  data: Data;
  id?: string;
  appId?: string;
  framework?: string;
}) {
  const sheets = useSheets();
  const act = useActions();
  const js = id ? data.state.job_stories.find((x) => x.id === id) : undefined;
  const app = data.appById.get(js?.application_id ?? appId ?? '');
  const bank = js?.story_id ? data.state.stories.find((s) => s.id === js.story_id) : undefined;
  const [v, setV] = useState<Content>(() => contentOf(js, framework));
  const [angle, setAngle] = useState(js?.angle ?? '');
  const [compare, setCompare] = useState(false);
  const set = (p: Partial<Content>) => setV((x) => ({ ...x, ...p }));
  const fw = frameworkOf(v.framework_key, data.state.frameworks);
  const defs = js && js.framework_key === v.framework_key ? js.section_defs : (fw?.sections ?? []);
  const st = js ? syncState({ ...js, ...v } as JobStory, bank) : 'job_only';
  if (!app) return null;

  async function save() {
    const body = { ...v, angle: angle || null };
    const ok = js
      ? await act.patch(`/job-stories/${js.id}`, body, 'Saved')
      : await act.post(`/applications/${app!.id}/stories`, body, 'Added');
    if (ok) sheets.close();
  }
  const runAndClose = async (path: string, done: string) => {
    if (js && (await act.post(`/job-stories/${js.id}/${path}`, {}, done))) sheets.close();
  };

  return (
    <Sheet
      title={js ? js.title : `New ${fw?.name ?? ''} story for this job`}
      sub={`${app.company} · ${js ? SYNC_LABEL[st] : 'Job-only: add it to the bank later if it’s a keeper'}`}
      onClose={sheets.close}
      footer={
        <>
          {js && (
            <ConfirmButton
              className="left"
              confirm="Remove from this job?"
              onConfirm={async () => (await act.del(`/job-stories/${js.id}`)) && sheets.close()}
            >
              Remove
            </ConfirmButton>
          )}
          <button type="button" className="btn primary" disabled={!v.title.trim()} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <Field label="Angle: how to frame it for this job (never counts as an edit)">
        <textarea
          className="in angle"
          rows={2}
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
          placeholder="For Leah: open with close time, skip the Apex detail."
        />
      </Field>
      {js && (
        <div className={cx('callout', (st === 'bank_newer' || st === 'both') && 'warn')}>
          <div className="sync-line">
            <span className={cx('sync', `sync-${st}`)}>{SYNC_LABEL[st]}</span>
            <span className="sub">
              {js.story_id && bank
                ? `Copied from bank v${js.source_version}; bank is v${bank.version}.`
                : js.story_id
                  ? 'The bank story was deleted.'
                  : 'Only on this job.'}
            </span>
          </div>
          <div className="acts">
            {bank && (st === 'bank_newer' || st === 'both') && (
              <button type="button" className="btn sm" onClick={() => setCompare((c) => !c)}>
                {compare ? 'Hide' : 'Compare'}
              </button>
            )}
            {bank && st !== 'in_sync' && st !== 'edited' && (
              <button
                type="button"
                className="btn sm"
                onClick={() => runAndClose('pull', 'Pulled from the bank')}
              >
                Pull bank v{bank.version}
                {st === 'both' ? ' (lose my edits)' : ''}
              </button>
            )}
            {bank && (st === 'edited' || st === 'both') && (
              <button
                type="button"
                className="btn sm"
                onClick={() => runAndClose('push', `Bank updated to v${bank.version + 1}`)}
              >
                Push to bank → v{bank.version + 1}
              </button>
            )}
            {(st === 'edited' || st === 'both' || st === 'job_only' || st === 'source_gone') && (
              <button
                type="button"
                className="btn sm primary"
                onClick={() => runAndClose('save-as-new', 'Saved to the bank')}
              >
                Save as new bank story
              </button>
            )}
          </div>
          {compare && bank && <Compare js={js} bank={bank} frameworks={data.state.frameworks} />}
        </div>
      )}
      <StoryForm data={data} v={v} set={set} defs={defs} />
    </Sheet>
  );
}

function Compare({ js, bank, frameworks }: { js: JobStory; bank: Story; frameworks: Framework[] }) {
  const defs = frameworkOf(bank.framework_key, frameworks)?.sections ?? js.section_defs;
  const keys = [...new Set([...js.section_defs, ...defs].map((d) => d.key))];
  const label = (k: string) => [...js.section_defs, ...defs].find((d) => d.key === k)?.label ?? k;
  return (
    <div className="compare">
      <div className="compare-col">
        <span className="lbl">This job</span>
        {keys.map((k) => (
          <p key={k} className={cx((js.sections[k] ?? '') !== (bank.sections[k] ?? '') && 'diff')}>
            <b>{label(k)}:</b> {js.sections[k] || '—'}
          </p>
        ))}
      </div>
      <div className="compare-col">
        <span className="lbl">Bank v{bank.version}</span>
        {keys.map((k) => (
          <p key={k} className={cx((js.sections[k] ?? '') !== (bank.sections[k] ?? '') && 'diff')}>
            <b>{label(k)}:</b> {bank.sections[k] || '—'}
          </p>
        ))}
      </div>
    </div>
  );
}

export function LinkStorySheet({ data, appId }: { data: Data; appId: string }) {
  const sheets = useSheets();
  const act = useActions();
  const [q, setQ] = useState('');
  const app = data.appById.get(appId);
  const linked = new Set(
    data.state.job_stories.filter((j) => j.application_id === appId).map((j) => j.story_id),
  );
  const hits = useMemo(
    () =>
      searchStories(
        data.state.stories.filter((s) => !s.archived),
        q,
      ).slice(0, 40),
    [data.state.stories, q],
  );
  if (!app) return null;
  return (
    <Sheet
      title="Link from the bank"
      sub={`To ${app.company}. Linking makes a copy for this job; edit it freely.`}
      onClose={sheets.close}
    >
      <input
        className="in"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search, or type a question you expect"
      />
      <div className="link-list">
        {hits.map(({ item: s, question }) => {
          const on = linked.has(s.id);
          return (
            <div key={s.id} className="link-row">
              <div style={{ minWidth: 0 }}>
                <div className="link-title">{s.title}</div>
                <div className="sub">
                  {frameworkOf(s.framework_key, data.state.frameworks)?.name} ·{' '}
                  {s.tags.join(', ') || 'no tags'}
                </div>
                {question && <div className="answers">Answers: “{question}”</div>}
              </div>
              <button
                type="button"
                className={cx('btn sm', on ? 'linked' : 'primary')}
                disabled={on}
                onClick={() =>
                  act.post(
                    `/applications/${appId}/stories`,
                    { story_id: s.id },
                    `Linked ${s.title}`,
                  )
                }
              >
                {on ? 'Linked ✓' : '+ Link'}
              </button>
            </div>
          );
        })}
        {!hits.length && (
          <p className="empty">Nothing in the bank matches. Write one with “New story”.</p>
        )}
      </div>
      <button type="button" className="btn" onClick={() => sheets.newStory(appId)}>
        <Icon name="plus" size={16} /> Write a job-only story
      </button>
    </Sheet>
  );
}

export function FrameworkSheet({ data, fwKey }: { data: Data; fwKey?: string }) {
  const sheets = useSheets();
  const act = useActions();
  const f = fwKey ? data.state.frameworks.find((x) => x.key === fwKey && !x.builtin) : undefined;
  const [name, setName] = useState(f?.name ?? '');
  const [blurb, setBlurb] = useState(f?.blurb ?? '');
  const [secs, setSecs] = useState<FrameworkSection[]>(
    f?.sections ?? [{ key: '', label: '', prompt: '' }],
  );
  const [questions, setQuestions] = useState<string[]>(f?.questions ?? []);
  const keyOf = (label: string, i: number) =>
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || `section_${i + 1}`;
  async function save() {
    const sections = secs
      .filter((s) => s.label.trim())
      .map((s, i) => ({
        key: s.key || keyOf(s.label, i),
        label: s.label.trim(),
        prompt: s.prompt,
      }));
    const body = { name, blurb, sections, questions };
    const ok = f
      ? await act.patch(`/frameworks/${f.key}`, body)
      : await act.post('/frameworks', body, 'Framework added');
    if (ok) sheets.close();
  }
  return (
    <Sheet
      title={f ? 'Edit framework' : 'Custom framework'}
      sub="Named sections, in order. Stories in it get one box per section."
      onClose={sheets.close}
      footer={
        <>
          {f && (
            <ConfirmButton
              className="left"
              confirm="Delete it?"
              onConfirm={async () => (await act.del(`/frameworks/${f.key}`)) && sheets.close()}
            >
              Delete
            </ConfirmButton>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={!name.trim() || !secs.some((s) => s.label.trim())}
            onClick={save}
          >
            Save
          </button>
        </>
      }
    >
      <div className="two">
        <Field label="Name">
          <input
            className="in"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="PAR"
          />
        </Field>
        <Field label="When to use it">
          <input
            className="in"
            value={blurb}
            onChange={(e) => setBlurb(e.target.value)}
            placeholder="Short project stories."
          />
        </Field>
      </div>
      <Field label="Sections">
        {secs.map((s, i) => (
          <div key={i} className="two sec-row">
            <input
              className="in"
              value={s.label}
              placeholder={`Section ${i + 1}`}
              aria-label="Section name"
              onChange={(e) =>
                setSecs((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
              }
            />
            <div className="att-last">
              <input
                className="in"
                value={s.prompt}
                placeholder="A nudge (optional)"
                aria-label="Prompt"
                onChange={(e) =>
                  setSecs((l) => l.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))
                }
              />
              <button
                type="button"
                className="xbtn"
                aria-label="Remove section"
                onClick={() => setSecs((l) => l.filter((_, j) => j !== i))}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn sm"
          onClick={() => setSecs((l) => [...l, { key: '', label: '', prompt: '' }])}
        >
          <Icon name="plus" size={14} /> Add a section
        </button>
      </Field>
      <Field label="Questions it answers">
        <TagInput
          value={questions}
          onChange={setQuestions}
          suggestions={[]}
          placeholder="Tell me about a project you led."
        />
      </Field>
    </Sheet>
  );
}
