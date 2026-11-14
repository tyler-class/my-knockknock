import { createContext, useContext } from 'react';
import type { Status } from '@shared/lookups';

export type LogType = 'meeting' | 'email' | 'note';

export interface SheetApi {
  addJob: () => void;
  editApp: (id: string) => void;
  status: (appId: string, to?: Status) => void;
  /** Log a new event, or edit one (eventId). parentId attaches a note to an event. */
  log: (appId: string, o?: { type?: LogType; eventId?: string; parentId?: string }) => void;
  person: (appId: string, personId?: string) => void;
  search: (id?: string) => void;
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
  editApp: noop,
  status: noop,
  log: noop,
  person: noop,
  search: noop,
  story: noop,
  newStory: noop,
  jobStory: noop,
  linkStory: noop,
  framework: noop,
  about: noop,
  close: noop,
});

export const useSheets = () => useContext(SheetCtx);
