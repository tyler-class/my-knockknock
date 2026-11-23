import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Status } from '@shared/lookups';
import { keys, useData } from '../lib/queries';
import { AboutSheet } from './AboutSheet';
import { ApplicationSheet, PersonSheet, RoundSheet, StatusSheet } from './AppSheets';
import { EventSheet } from './EventSheet';
import { EventView } from './EventView';
import {
  FrameworkPicker,
  FrameworkSheet,
  JobStorySheet,
  LinkStorySheet,
  StorySheet,
} from './StorySheets';
import { SheetCtx, type LogType, type SheetApi } from './context';

type Open =
  | { type: 'app'; n: number }
  | { type: 'status'; appId: string; to?: Status | 'closed'; n: number }
  | {
      type: 'log';
      appId: string;
      logType?: LogType;
      eventId?: string;
      parentId?: string;
      n: number;
    }
  | { type: 'person'; appId: string | null; id?: string; companyId?: string; n: number }
  | { type: 'round'; id?: string; n: number }
  | { type: 'story'; id?: string; framework?: string; n: number }
  | { type: 'pick'; appId?: string; n: number }
  | { type: 'jobStory'; id?: string; appId?: string; framework?: string; n: number }
  | { type: 'link'; appId: string; n: number }
  | { type: 'framework'; key?: string; n: number }
  | { type: 'about' };

/** One sheet at a time, reachable from anywhere through useSheets(). */
export function SheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const data = useData();
  const qc = useQueryClient();
  // A person opened by id that isn't in the data yet (just added): fetch the state again.
  const missingPerson =
    open?.type === 'person' &&
    !!open.id &&
    !!data &&
    !data.state.people.some((x) => x.id === open.id);
  useEffect(() => {
    if (missingPerson) void qc.invalidateQueries({ queryKey: keys.state });
  }, [missingPerson, qc]);
  const api = useMemo<SheetApi>(() => {
    let n = 0;
    return {
      addJob: () => setOpen({ type: 'app', n: ++n }),
      status: (appId, to) => setOpen({ type: 'status', appId, to, n: ++n }),
      log: (appId, o = {}) =>
        setOpen({
          type: 'log',
          appId,
          logType: o.type,
          eventId: o.eventId,
          parentId: o.parentId,
          n: ++n,
        }),
      person: (appId, id, companyId) => setOpen({ type: 'person', appId, id, companyId, n: ++n }),
      round: (id) => setOpen({ type: 'round', id, n: ++n }),
      story: (o) => setOpen({ type: 'story', ...o, n: ++n }),
      newStory: (appId) => setOpen({ type: 'pick', appId, n: ++n }),
      jobStory: (o) => setOpen({ type: 'jobStory', ...o, n: ++n }),
      linkStory: (appId) => setOpen({ type: 'link', appId, n: ++n }),
      framework: (key) => setOpen({ type: 'framework', key, n: ++n }),
      about: () => setOpen({ type: 'about' }),
      close: () => setOpen(null),
    };
  }, []);

  let sheet: ReactNode = open?.type === 'about' ? <AboutSheet /> : null;
  if (open && open.type !== 'about' && data) {
    const k = `${open.type}${open.n}`;
    if (open.type === 'app') sheet = <ApplicationSheet key={k} />;
    if (open.type === 'status')
      sheet = <StatusSheet key={k} data={data} appId={open.appId} to={open.to} />;
    if (open.type === 'log') {
      // An entry already logged opens as itself, edited in place; otherwise a new one is logged.
      const ev = open.eventId
        ? data.eventsByApp.get(open.appId)?.find((e) => e.id === open.eventId)
        : undefined;
      sheet = ev ? (
        <EventView key={k} data={data} appId={open.appId} ev={ev} />
      ) : (
        <EventSheet
          key={k}
          data={data}
          appId={open.appId}
          type={open.logType}
          parentId={open.parentId}
        />
      );
    }
    // Opening a person by id: wait until it's in the data (just added, still loading) rather
    // than showing an empty form, and key on it so the fields fill when it arrives.
    if (open.type === 'person') {
      const found = !open.id || data.state.people.some((x) => x.id === open.id);
      sheet = found ? (
        <PersonSheet
          key={k}
          data={data}
          appId={open.appId}
          id={open.id}
          companyId={open.companyId}
        />
      ) : null;
    }
    if (open.type === 'round') sheet = <RoundSheet key={k} data={data} id={open.id} />;
    if (open.type === 'story')
      sheet = <StorySheet key={k} data={data} id={open.id} framework={open.framework} />;
    if (open.type === 'pick')
      sheet = (
        <FrameworkPicker
          key={k}
          data={data}
          onPick={(f) =>
            open.appId
              ? api.jobStory({ appId: open.appId, framework: f })
              : api.story({ framework: f })
          }
        />
      );
    if (open.type === 'jobStory')
      sheet = (
        <JobStorySheet
          key={k}
          data={data}
          id={open.id}
          appId={open.appId}
          framework={open.framework}
        />
      );
    if (open.type === 'link') sheet = <LinkStorySheet key={k} data={data} appId={open.appId} />;
    if (open.type === 'framework') sheet = <FrameworkSheet key={k} data={data} fwKey={open.key} />;
  }

  return (
    <SheetCtx.Provider value={api}>
      {children}
      {sheet}
    </SheetCtx.Provider>
  );
}
