import { createContext, useContext } from 'react';
import type { Status } from '@shared/lookups';

export type LogType = 'meeting' | 'email' | 'note';

export interface SheetApi {
  addJob: () => void;
  status: (appId: string, to?: Status | 'closed') => void;
  /** Log a new event, or open one (eventId) to edit in place. parentId puts a note on an event. */
  log: (appId: string, o?: { type?: LogType; eventId?: string; parentId?: string }) => void;
  /** A person on a job (appId), or at a company with no job in view (appId null, companyId). */
  person: (appId: string | null, personId?: string, companyId?: string) => void;
  round: (id?: string) => void;
  /** A bank story: edit one, or a new one in a framework. */
  story: (o: { id?: string; framework?: string }) => void;
  /** Pick a framework, then open a new story in it (bank, or job-only on an application). */
  newStory: (appId?: string) => void;
  jobStory: (o: { id?: string; appId?: string; framework?: string }) => void;
  linkStory: (appId: string) => void;
  framework: (key?: string) => void;
  about: () => void;
  close: () => void;
}

const noop = () => {};
export const SheetCtx = createContext<SheetApi>({
  addJob: noop,
  status: noop,
  log: noop,
  person: noop,
  round: noop,
  story: noop,
  newStory: noop,
  jobStory: noop,
  linkStory: noop,
  framework: noop,
  about: noop,
  close: noop,
});

export const useSheets = () => useContext(SheetCtx);
