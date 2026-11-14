// Knock Knock's notifications on top of the Selfhost Kit's push (src/worker/kit/push.ts):
// interviews today, follow-ups for quiet applications, and debrief reminders. The words and
// the rules are in src/shared/logic/notify.ts.
import { dueNotices, NOTIFY_KINDS } from '@shared/logic/notify';
import { first, loadState } from './db';
import {
  pushRoutes,
  runPushJob,
  type PushCandidate,
  type PushDevice,
  type PushJobOptions,
} from './kit/push';

const ICON = '/pwa-192x192.png';

/** Whether this device already got this notice (on any day). */
async function alreadySent(db: D1Database, device: PushDevice, kind: string, key: string) {
  return !!(await first(
    db,
    'SELECT 1 AS x FROM selfhost_push_sent WHERE device_id = ? AND kind = ? AND key = ? LIMIT 1',
    device.id,
    kind,
    key,
  ));
}

/** The notifications a device could get now (the state is loaded once per run). */
export function knockPush(db: D1Database): Pick<PushJobOptions, 'build'> {
  let state: ReturnType<typeof loadState> | null = null;
  return {
    async build(device: PushDevice, now: Date): Promise<PushCandidate[]> {
      const s = await (state ??= loadState(db));
      const out: PushCandidate[] = [];
      for (const n of dueNotices(s, now, device.tz)) {
        if (await alreadySent(db, device, n.kind, n.key)) continue;
        out.push({
          kind: n.kind,
          key: n.key,
          message: { title: n.title, body: n.body, url: n.url, tag: n.tag },
        });
      }
      return out;
    },
  };
}

/** The hourly cron's notification run: anything due goes out from 8:00 local to 21:00. */
export function runNotifications(db: D1Database, o: Partial<PushJobOptions> = {}) {
  return runPushJob(db, { ...knockPush(db), icon: ICON, ...o });
}

/** /api/push/*: behind Knock Knock's sign-in (mounted after the guard in app.ts). No badge. */
export const push = pushRoutes({
  title: 'Knock Knock',
  kinds: NOTIFY_KINDS.map((k) => k.id),
  icon: ICON,
  fallbackSubject: 'mailto:knockknock@tylerclass.net',
});
