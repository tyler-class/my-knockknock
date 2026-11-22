import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Spinner } from '../components/Brand';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EXAMPLE_PROMPTS } from '@shared/examples';
import { api, errorMessage } from '../lib/api';
import { useActions, useData } from '../lib/queries';
import { isStandalone } from '../lib/pwa';
import { useSheets } from '../sheets/context';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { ConfirmButton, InfoTip, PageHeader, SlideToggle, Switch } from '../components/ui';
import { isSourceRepo, runUrl, setupUrl, UPSTREAM, useLatestVersion } from '../lib/updates';
import {
  autoUpdatesInfo,
  howUpdatesWork,
  UPDATE_TEXT,
  updateStatus,
  whatsShared,
  workflowFileUrl,
} from '../kit/updates';
import { buildFlags } from '@shared/kit/build';
import { assistants, ASSISTANT_INTRO, CONNECTED_TEXT, signInNote } from '../kit/assistants';
import {
  disablePush,
  enablePush,
  getState,
  installSteps,
  pushBlocker,
  pushInfo,
  PUSH_TEXT,
  sendTest,
  setPrefs,
  type PushState,
} from '../kit/push';
import { NOTIFY_KINDS } from '@shared/logic/notify';

const BADGE_MEANS = undefined;

/** What the usage counts count, in words (matches USAGE_TABLES in the worker). */
const USAGE_COUNTED = 'searches, applications, timeline events, stories and files';

function Section({
  title,
  trailing,
  id,
  children,
}: {
  title: string;
  trailing?: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section className="sec" id={id}>
      <div className="sec-h">
        <h2>{title}</h2>
        {trailing}
      </div>
      <div className="card flat">{children}</div>
    </section>
  );
}

export function Settings() {
  const data = useData();
  const actions = useActions();
  const sheets = useSheets();
  if (!data) return null;
  const s = data.state.settings;
  return (
    <div>
      <PageHeader
        title="Settings"
        icon="settings"
        action={
          <button type="button" className="btn sm about-m" onClick={sheets.about}>
            {/* Phones: just "About"; wider screens: "About Knock Knock". */}
            <Icon name="info" size={15} /> About<span className="wide-only"> Knock Knock</span>
          </button>
        }
      />
      <Section
        title="Searches"
        trailing={
          <button type="button" className="more" onClick={() => sheets.search()}>
            + New search
          </button>
        }
      >
        <div className="list">
          {data.state.searches.map((x) => (
            <button key={x.id} type="button" className="recent" onClick={() => sheets.search(x.id)}>
              <strong>
                {x.name}
                {x.id === data.search?.id ? ' · current' : ''}
              </strong>
              <span className="sub">
                {x.status === 'active' ? 'Active' : x.status === 'accepted' ? 'Accepted' : 'Ended'}{' '}
                · {data.state.applications.filter((a) => a.search_id === x.id).length} applications
              </span>
            </button>
          ))}
          {!data.state.searches.length && (
            <p className="sub">Your first search starts when you add your first job.</p>
          )}
        </div>
      </Section>
      <Section title="Follow-ups">
        <div className="two">
          <div className="fg">
            <label className="lbl" htmlFor="fu">
              Follow up after (days quiet)
            </label>
            <input
              id="fu"
              className="in"
              type="number"
              min={1}
              max={90}
              defaultValue={s.follow_up_days}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v >= 1 && v <= 90 && v !== s.follow_up_days)
                  void actions.saveSettings({ follow_up_days: v });
              }}
            />
          </div>
          <div className="fg">
            <label className="lbl" htmlFor="gh">
              Suggest Ghosted after (days)
            </label>
            <input
              id="gh"
              className="in"
              type="number"
              min={7}
              max={365}
              defaultValue={s.ghost_days}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v >= 7 && v <= 365 && v !== s.ghost_days)
                  void actions.saveSettings({ ghost_days: v });
              }}
            />
          </div>
        </div>
        <p className="hint">Ghosted is only ever suggested. You confirm it.</p>
      </Section>
      <Notifications />
      <ConnectAI />
      {/* Already installed: nothing to do here, so no section. */}
      {!isStandalone() && (
        <Section title="Install on Your Phone" id="install">
          <InstallHint />
        </Section>
      )}
      <Backup />
      <Updates
        setUp={buildFlags().updatesOn || s.updates_set_up}
        onSetUp={() => actions.saveSettings({ updates_set_up: true })}
        telemetry={s.telemetry}
        onTelemetry={(telemetry) => actions.saveSettings({ telemetry })}
      />
      <Section title="Account">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            await api.post('/logout');
            window.location.reload();
          }}
        >
          <Icon name="logout" size={16} /> Sign out
        </button>
      </Section>
    </div>
  );
}

const KINDS = NOTIFY_KINDS.map((k) => k.id);

/** Settings → Notifications: this device's own choices (Selfhost Kit layout and words). */
function Notifications() {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    getState()
      .then((s) => live && setState(s))
      .catch((e) => live && toast({ text: errorMessage(e), tone: 'bad' }));
    return () => {
      live = false;
    };
  }, [toast]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast({ text: errorMessage(e), tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  const info = pushInfo({ badge: BADGE_MEANS, title: 'Knock Knock' });
  const blocker = state && pushBlocker(state, 'Knock Knock');
  const on = !!state?.on;
  const row = { borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 };

  return (
    <Section
      title={PUSH_TEXT.heading}
      trailing={
        <InfoTip label={PUSH_TEXT.about}>
          <ul>
            {info.lines.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </InfoTip>
      }
    >
      {!state ? (
        <div style={{ minHeight: 34 }} />
      ) : blocker ? (
        <>
          <div className="upd-row">
            <span className="grow">
              {blocker.text}
              {blocker.install && (
                <InfoTip label={PUSH_TEXT.howToInstall}>
                  {installSteps('Knock Knock').map((g) => (
                    <div key={g.label}>
                      <p style={{ color: 'var(--ink)', fontWeight: 600, margin: '0 0 4px' }}>
                        {g.label}
                      </p>
                      <ol style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                        {g.steps.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </InfoTip>
              )}
            </span>
          </div>
          {blocker.install && !state.standalone && (
            <button
              type="button"
              className="btn sm"
              style={{ marginTop: 12 }}
              onClick={() =>
                document
                  .getElementById('install')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              <Icon name="phone" size={15} /> {PUSH_TEXT.installLink}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="upd-row">
            <span className="grow">
              {PUSH_TEXT.master}
              {state.standalone && (
                <InfoTip label={PUSH_TEXT.whyItWorks}>
                  <p>{PUSH_TEXT.installed('Knock Knock')}</p>
                </InfoTip>
              )}
            </span>
            <Switch
              on={on}
              disabled={busy}
              label={PUSH_TEXT.master}
              // Straight from the tap: the permission prompt needs it.
              onChange={(v) =>
                act(async () => setState(await (v ? enablePush(KINDS) : disablePush())))
              }
            />
          </div>
          {on &&
            NOTIFY_KINDS.map((k) => (
              <div key={k.id} className="upd-row" style={row}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {k.label}
                  <span className="sub" style={{ display: 'block', marginTop: 2 }}>
                    {k.description}
                  </span>
                </span>
                <Switch
                  on={state.device?.prefs[k.id] !== false}
                  label={k.label}
                  onChange={(v) =>
                    act(async () => {
                      // Show it now; the server agrees or the toast says why.
                      setState((s) =>
                        s?.device
                          ? {
                              ...s,
                              device: { ...s.device, prefs: { ...s.device.prefs, [k.id]: v } },
                            }
                          : s,
                      );
                      const device = await setPrefs({ [k.id]: v });
                      if (device) setState((s) => s && { ...s, device });
                    })
                  }
                />
              </div>
            ))}
          {on && (
            <div style={row}>
              <button
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await sendTest();
                    toast({ text: PUSH_TEXT.testSent });
                  })
                }
              >
                <Icon name="bell" size={15} /> {PUSH_TEXT.test}
              </button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked: the text is selectable */
        }
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={15} /> {done ? 'Copied' : 'Copy'}
    </button>
  );
}

const codeStyle = {
  display: 'block',
  overflowX: 'auto' as const,
  whiteSpace: 'nowrap' as const,
  background: 'var(--surface2)',
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: 13,
  userSelect: 'all' as const,
  flex: 1,
  minWidth: 0,
};

/** “Connect an AI assistant” (Selfhost Kit layout: src/client/kit/assistants.ts). */
function ConnectAI() {
  const url = `${window.location.origin}/mcp`;
  const setups = assistants('Knock Knock', 'knockknock', url);
  const [open, setOpen] = useState<string | null>(null);
  const [examples, setExamples] = useState(false);
  const shown = setups.find((a) => a.id === open);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['connections'],
    queryFn: () =>
      api.get<{ connections: { id: string; name: string; created_at: string | null }[] }>(
        '/connections',
      ),
  });
  const list = q.data?.connections ?? [];
  return (
    <Section title="Connect an AI Assistant">
      <p style={{ marginTop: 0 }}>{ASSISTANT_INTRO('job search')}</p>
      <label className="lbl">{CONNECTED_TEXT.urlLabel('Knock Knock')}</label>
      <div className="flexrow" style={{ flexWrap: 'nowrap' }}>
        <code style={codeStyle}>{url}</code>
        <Copy text={url} />
      </div>
      <p className="sub" style={{ marginTop: 8 }}>
        {signInNote('Knock Knock')}
      </p>
      <h3 style={{ fontSize: 16, marginTop: 16 }}>{CONNECTED_TEXT.heading}</h3>
      {q.isPending && <Spinner size={24} label="Loading connections" />}
      {!q.isPending && !list.length && <p className="sub">{CONNECTED_TEXT.none}</p>}
      {list.map((c) => (
        <div className="ri" key={c.id}>
          <div className="rm">
            <Icon name="sparkle" size={18} />
            <div className="mid">{c.name}</div>
            {c.created_at && (
              <span className="sub">{new Date(c.created_at).toLocaleDateString()}</span>
            )}
          </div>
        </div>
      ))}
      {list.length > 0 && (
        <ConfirmButton
          confirm={CONNECTED_TEXT.confirm}
          onConfirm={async () => {
            try {
              await api.post('/connections/revoke-all');
              await qc.invalidateQueries({ queryKey: ['connections'] });
            } catch (e) {
              toast({ text: errorMessage(e), tone: 'bad' });
            }
          }}
        >
          {CONNECTED_TEXT.disconnectAll}
        </ConfirmButton>
      )}
      <h3 style={{ fontSize: 16, marginTop: 16 }}>{CONNECTED_TEXT.setUp}</h3>
      <SlideToggle
        label="AI assistant"
        value={open}
        allowClear
        onChange={setOpen}
        options={setups.map((a) => [a.id, a.name] as const)}
      />
      {shown && (
        <div style={{ marginTop: 10 }}>
          {shown.steps.length > 0 && (
            <ol className="sub" style={{ paddingLeft: 20, margin: 0 }}>
              {shown.steps.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          )}
          {shown.commandIntro && <p className="sub">{shown.commandIntro}</p>}
          {shown.command && (
            <div className="flexrow" style={{ flexWrap: 'nowrap' }}>
              <code style={codeStyle}>{shown.command}</code>
              <Copy text={shown.command} />
            </div>
          )}
          {shown.after && <p className="sub">{shown.after}</p>}
        </div>
      )}
      <button
        type="button"
        className="fold"
        aria-expanded={examples}
        onClick={() => setExamples((v) => !v)}
      >
        {CONNECTED_TEXT.examples}
        <span className={examples ? 'fold-chev open' : 'fold-chev'}>
          <Icon name="chevDown" size={14} />
        </span>
      </button>
      {examples && (
        <>
          <p className="sub" style={{ marginTop: 0 }}>
            {CONNECTED_TEXT.examplesHint}
          </p>
          <ul className="try-list">
            {EXAMPLE_PROMPTS.slice(0, 6).map((e) => (
              <li key={e.prompt}>
                <button
                  type="button"
                  title="Copy"
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(e.prompt)
                      .then(() => toast({ text: 'Copied.' }))
                  }
                >
                  “{e.prompt}”
                </button>
              </li>
            ))}
          </ul>
          <p className="sub">Claude also lists ready-made Knock Knock prompts in its + menu.</p>
        </>
      )}
    </Section>
  );
}

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}

function InstallHint() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  return (
    <div>
      {prompt && (
        <button type="button" className="btn primary sm" onClick={() => prompt.prompt()}>
          <Icon name="download" size={15} /> Install Knock Knock
        </button>
      )}
      <p className="sub" style={{ marginBottom: 0 }}>
        iPhone: open this page in Safari, tap Share, then “Add to Home Screen”. Android: open the
        Chrome menu and tap “Install app”.
      </p>
    </div>
  );
}

function Backup() {
  const file = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Backup">
      <p style={{ marginTop: 0 }} className="sub">
        A backup is one JSON file with every search, application, timeline and story. Files stay in
        your storage bucket; restoring into this same Knock Knock keeps them attached.
      </p>
      <div className="flexrow">
        <a className="btn" href="/api/export" download>
          <Icon name="download" size={16} /> Download backup
        </a>
        <button type="button" className="btn" disabled={busy} onClick={() => file.current?.click()}>
          <Icon name="upload" size={16} /> {busy ? 'Restoring…' : 'Restore from backup'}
        </button>
      </div>
      <p className="sub" style={{ marginBottom: 0 }}>
        Restoring replaces everything currently in Knock Knock.
      </p>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          try {
            await api.post('/import', JSON.parse(await f.text()));
            await qc.invalidateQueries();
            toast({ text: 'Restored' });
          } catch (err) {
            toast({
              text: err instanceof SyntaxError ? 'That file is not JSON.' : errorMessage(err),
              tone: 'bad',
            });
          } finally {
            setBusy(false);
          }
        }}
      />
    </Section>
  );
}

/**
 * Updates: is a newer Knock Knock out, and links into this copy's own GitHub repo to add the
 * update workflow (once) or run it. Updates go Knock Knock → their repo → their Cloudflare.
 */
function Updates({
  setUp,
  onSetUp,
  telemetry,
  onTelemetry,
}: {
  setUp: boolean;
  onSetUp: () => void;
  telemetry: boolean;
  onTelemetry: (on: boolean) => void;
}) {
  const latest = useLatestVersion();
  const repo = __SOURCE_REPO__;
  const isSource = isSourceRepo(repo, UPSTREAM);
  const auto = autoUpdatesInfo('Knock Knock');
  const status = updateStatus('Knock Knock', __APP_VERSION__, latest.data, latest.isError);
  const how = howUpdatesWork('Knock Knock');
  const shared = whatsShared('Knock Knock', USAGE_COUNTED, true);
  return (
    <Section
      title={UPDATE_TEXT.heading}
      trailing={
        !isSource && (
          <InfoTip label={UPDATE_TEXT.howUpdatesWork}>
            <p>{how.intro}</p>
            <ol style={{ margin: '0 0 8px', paddingLeft: 18 }}>
              {how.steps.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
            <p>{how.outro}</p>
          </InfoTip>
        )
      }
    >
      <p style={{ marginTop: 0, color: status.newer ? 'var(--ink)' : undefined }} className="sub">
        {status.text}
      </p>
      {setUp && repo && !isSource && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            margin: '0 0 12px',
            color: 'var(--ink)',
          }}
        >
          <span style={{ display: 'inline-flex', color: 'var(--ink)' }}>
            <Icon name="check" size={16} />
          </span>
          {UPDATE_TEXT.autoOn}
          <InfoTip label={UPDATE_TEXT.aboutAutoOn}>
            <p>{auto.what}</p>
            <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
              {auto.how.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p>{auto.off}</p>
            <a
              href={workflowFileUrl(repo, __SOURCE_BRANCH__)}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--ink)' }}
            >
              {auto.fileLink}
            </a>
          </InfoTip>
        </div>
      )}
      {isSource ? null : !repo ? (
        <p className="sub">{UPDATE_TEXT.byHand}</p>
      ) : (
        <>
          <div className="flexrow">
            {setUp ? (
              <a
                className={status.newer ? 'btn primary' : 'btn'}
                href={runUrl(repo)}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="reset" size={16} /> {UPDATE_TEXT.updateNow}
              </a>
            ) : (
              <a
                className="btn primary"
                href={setupUrl(repo, __SOURCE_BRANCH__)}
                target="_blank"
                rel="noreferrer"
                onClick={onSetUp}
              >
                <Icon name="github" size={16} /> {UPDATE_TEXT.setUp}
              </a>
            )}
            <a
              className="upd-repo"
              href={`https://github.com/${repo}`}
              target="_blank"
              rel="noreferrer"
            >
              {repo}
            </a>
          </div>
          <p className="sub" style={{ marginBottom: 0 }}>
            {setUp ? (
              <>
                {UPDATE_TEXT.updateNowHint}{' '}
                <a href={workflowFileUrl(repo, __SOURCE_BRANCH__)} target="_blank" rel="noreferrer">
                  {UPDATE_TEXT.updateFile}
                </a>
              </>
            ) : (
              UPDATE_TEXT.setUpHint
            )}
          </p>
        </>
      )}
      <div
        className="upd-row"
        style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 14 }}
      >
        <span className="grow">
          {UPDATE_TEXT.telemetry}
          <InfoTip label={UPDATE_TEXT.whatsShared}>
            <p>{shared.intro}</p>
            <ul>
              {shared.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p>{shared.outro}</p>
          </InfoTip>
        </span>
        <Switch on={telemetry} onChange={onTelemetry} label={UPDATE_TEXT.telemetry} />
      </div>
    </Section>
  );
}
