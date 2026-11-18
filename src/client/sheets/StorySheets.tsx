// The Stories's sheets: a story from Stories, picking a framework, a job's copy of a story,
// linking from Stories, and custom frameworks.
//
// A job keeps its own copy of a story from Stories, so it can be tailored. The copy says in plain
// words how it compares with Stories ("You changed this for PwC") and offers at most the
// one or two actions that make sense, never version numbers.
import { useMemo, useState } from 'react';
import { sectionLetter, type FrameworkSection } from '@shared/frameworks';
import {
  COPY_LABEL,
  frameworkOf,
  searchStories,
  switchFramework,
  syncState,
} from '@shared/logic/stories';
import type { Framework, JobStory, Story } from '@shared/types';
import { useActions, type Data } from '../lib/queries';
import { useToast } from '../components/Toast';
import { AutoTextarea, ConfirmButton, Field, Select, Sheet, cx } from '../components/ui';
import { Icon } from '../components/Icon';
import { useSheets } from './context';

/** What the story editors change: the framework, the title, the parts and any notes. */
interface Content {
  framework_key: string;
  title: string;
  sections: Record<string, string>;
  notes: string;
}

const contentOf = (s?: Story | JobStory, framework?: string): Content => ({
  framework_key: s?.framework_key ?? framework ?? 'star',
  title: s?.title ?? '',
  sections: s?.sections ?? {},
  notes: s?.notes ?? '',
});

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
  const showNotes = !!v.notes.trim();
  return (
    <>
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
        <input className="in" value={v.title} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <ol className="fw-parts" aria-label={`${fw?.name ?? 'Story'} parts`}>
        {defs.map((sec) => (
          <li key={sec.key} className="fw-part">
            <b aria-hidden="true">{sectionLetter(sec.label)}</b>
            <Field label={sec.label}>
              {sec.prompt && <span className="part-hint">{sec.prompt}</span>}
              <AutoTextarea
                className="in"
                rows={3}
                value={v.sections[sec.key] ?? ''}
                onChange={(e) => set({ sections: { ...v.sections, [sec.key]: e.target.value } })}
              />
            </Field>
          </li>
        ))}
      </ol>
      {showNotes && (
        <Field label="Notes">
          <AutoTextarea
            className="in"
            rows={2}
            value={v.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </Field>
      )}
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
  const toast = useToast();
  const s = id ? data.state.stories.find((x) => x.id === id) : undefined;
  const [v, setV] = useState<Content>(() => contentOf(s, framework));
  const set = (p: Partial<Content>) => setV((x) => ({ ...x, ...p }));
  const fw = frameworkOf(v.framework_key, data.state.frameworks);
  const copies = s ? data.state.job_stories.filter((j) => j.story_id === s.id) : [];

  async function save() {
    const ok = s
      ? await act.patch(`/stories/${s.id}`, v, 'Saved')
      : await act.post('/stories', v, 'Added to Stories');
    if (ok) sheets.close();
  }

  return (
    <Sheet
      title={s ? 'Edit story' : 'New story'}
      sub={
        s
          ? `${fw?.name ?? s.framework_key} · used in ${copies.length} ${copies.length === 1 ? 'job' : 'jobs'}`
          : undefined
      }
      onClose={sheets.close}
      footer={
        <>
          {s && (
            <ConfirmButton
              className="left"
              confirm="Delete? Jobs keep their copies."
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
              onClick={async () => {
                const was = s.archived;
                if (!(await act.patch(`/stories/${s.id}`, { archived: !was }))) return;
                sheets.close();
                toast({
                  text: was ? 'Unarchived' : 'Archived',
                  action: {
                    label: 'Undo',
                    run: () => void act.patch(`/stories/${s.id}`, { archived: was }),
                  },
                });
              }}
            >
              {s.archived ? 'Unarchive' : 'Archive'}
            </button>
          )}
          {/* A new story: back to the framework picker, to choose a different one. */}
          {!s && (
            <button type="button" className="btn left" onClick={() => sheets.newStory()}>
              Cancel
            </button>
          )}
          <button type="button" className="btn primary" disabled={!v.title.trim()} onClick={save}>
            {s ? 'Save' : 'Add to Stories'}
          </button>
        </>
      }
    >
      <StoryForm data={data} v={v} set={set} defs={fw?.sections ?? []} />
      {copies.length > 0 && (
        <div className="callout">
          <span className="lbl">
            Used in {copies.length === 1 ? '1 job' : `${copies.length} jobs`}
          </span>
          <p className="sub">
            Each job keeps its own copy. Saving here doesn’t change them; a job with an older
            version offers to use this one.
          </p>
          {copies.map((c) => {
            const a = data.appById.get(c.application_id);
            const st = syncState(c, s);
            return (
              <div key={c.id} className="copy-row">
                <span>
                  <strong>{a?.company ?? 'Deleted application'}</strong>{' '}
                  <span className="sub">{a?.title}</span>
                </span>
                <span className={cx('sync', `sync-${st}`)}>{COPY_LABEL[st]}</span>
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
      sub="Every framework is just named sections. Same bank, same copies, same Call Mode."
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
  const company = app.company;
  // What to say about this copy, and what you can do about it.
  const status: Record<string, string> = {
    job_only: 'Only on this job.',
    source_gone: 'The original in Stories was deleted.',
    in_sync: 'Same as the story in Stories.',
    edited: `You changed this for ${company}.`,
    bank_newer: 'The story in Stories has changed since you added it here.',
    both: `You changed this for ${company}, and the one in Stories changed too.`,
  };

  return (
    <Sheet
      title={js ? js.title : 'New story'}
      sub={
        js ? company : `${company} · only on this job (add it to Stories later if it’s a keeper)`
      }
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
          {!js && (
            <button type="button" className="btn left" onClick={() => sheets.newStory(app.id)}>
              Cancel
            </button>
          )}
          <button type="button" className="btn primary" disabled={!v.title.trim()} onClick={save}>
            Save
          </button>
        </>
      }
    >
      {js && (
        <div className={cx('callout', (st === 'bank_newer' || st === 'both') && 'warn')}>
          <p className="sync-line">{status[st]}</p>
          <div className="acts">
            {(st === 'job_only' || st === 'source_gone') && (
              <button
                type="button"
                className="btn sm"
                onClick={() => runAndClose('save-as-new', 'Added to Stories')}
              >
                Add to Stories
              </button>
            )}
            {st === 'edited' && bank && (
              <button
                type="button"
                className="btn sm"
                onClick={() => runAndClose('push', 'Updated in Stories')}
              >
                Update it in Stories too
              </button>
            )}
            {st === 'bank_newer' && bank && (
              <button
                type="button"
                className="btn sm"
                onClick={() => runAndClose('pull', 'Using the new version')}
              >
                Use the new version
              </button>
            )}
            {st === 'both' && bank && (
              <>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => runAndClose('push', 'Updated in Stories')}
                >
                  Keep mine, update Stories
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => runAndClose('pull', 'Using the version in Stories')}
                >
                  Use the version in Stories
                </button>
              </>
            )}
            {bank && (st === 'bank_newer' || st === 'both') && (
              <button type="button" className="btn sm ghost" onClick={() => setCompare((c) => !c)}>
                {compare ? 'Hide differences' : 'See differences'}
              </button>
            )}
          </div>
          {compare && bank && (
            <Compare js={js} bank={bank} company={company} frameworks={data.state.frameworks} />
          )}
        </div>
      )}
      <Field label={`Angle for ${company}: how to frame it here (doesn’t change the story)`}>
        <AutoTextarea
          className="in angle"
          rows={2}
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
        />
      </Field>
      <StoryForm data={data} v={v} set={set} defs={defs} />
    </Sheet>
  );
}

function Compare({
  js,
  bank,
  company,
  frameworks,
}: {
  js: JobStory;
  bank: Story;
  company: string;
  frameworks: Framework[];
}) {
  const defs = frameworkOf(bank.framework_key, frameworks)?.sections ?? js.section_defs;
  const keys = [...new Set([...js.section_defs, ...defs].map((d) => d.key))];
  const label = (k: string) => [...js.section_defs, ...defs].find((d) => d.key === k)?.label ?? k;
  return (
    <div className="compare">
      <div className="compare-col">
        <span className="lbl">For {company}</span>
        {keys.map((k) => (
          <p key={k} className={cx((js.sections[k] ?? '') !== (bank.sections[k] ?? '') && 'diff')}>
            <b>{label(k)}:</b> {js.sections[k] || '—'}
          </p>
        ))}
      </div>
      <div className="compare-col">
        <span className="lbl">In Stories</span>
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
        data.state.frameworks,
      ).slice(0, 40),
    [data.state.stories, data.state.frameworks, q],
  );
  if (!app) return null;
  return (
    <Sheet
      title="Link from Stories"
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
        {hits.map(({ item: s }) => {
          const on = linked.has(s.id);
          return (
            <div key={s.id} className="link-row">
              <div style={{ minWidth: 0 }}>
                <div className="link-title">{s.title}</div>
                <div className="sub">
                  {frameworkOf(s.framework_key, data.state.frameworks)?.name}
                </div>
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
          <p className="empty">Nothing in Stories matches. Write one with “New story”.</p>
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
    const body = { name, blurb, sections };
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
          <input className="in" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="When to use it">
          <input className="in" value={blurb} onChange={(e) => setBlurb(e.target.value)} />
        </Field>
      </div>
      <Field label="Sections: a name, and an optional nudge">
        {secs.map((s, i) => (
          <div key={i} className="two sec-row">
            <input
              className="in"
              value={s.label}
              aria-label="Section name"
              onChange={(e) =>
                setSecs((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
              }
            />
            <div className="att-last">
              <input
                className="in"
                value={s.prompt}
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
    </Sheet>
  );
}
