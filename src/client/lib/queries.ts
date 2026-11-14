import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { AppState, Application, Search, Settings, TimelineEvent } from '@shared/types';
import { api, errorMessage } from './api';
import { useToast } from '../components/Toast';

export const keys = { state: ['state'] as const, session: ['session'] as const };

export function useAppState() {
  return useQuery({
    queryKey: keys.state,
    queryFn: () => api.get<AppState>('/state'),
    staleTime: 15_000,
  });
}

export interface Data {
  state: AppState;
  search: Search | null;
  /** Applications in the current search. */
  apps: Application[];
  appById: Map<string, Application>;
  eventsByApp: Map<string, TimelineEvent[]>;
}

/** The state plus the joins every screen needs, rebuilt only when the data changes. */
export function useData(): Data | null {
  const { data } = useAppState();
  return useMemo(() => {
    if (!data) return null;
    const search =
      data.searches.find((s) => s.id === data.settings.current_search_id) ??
      data.searches[0] ??
      null;
    const eventsByApp = new Map<string, TimelineEvent[]>();
    for (const e of data.events) {
      if (!eventsByApp.has(e.application_id)) eventsByApp.set(e.application_id, []);
      eventsByApp.get(e.application_id)!.push(e);
    }
    return {
      state: data,
      search,
      apps: data.applications.filter((a) => !search || a.search_id === search.id),
      appById: new Map(data.applications.map((a) => [a.id, a])),
      eventsByApp,
    };
  }, [data]);
}

/**
 * Writes. Each refetches the state afterwards (it's small, and the server recomputes statuses
 * and versions). Errors show as a toast and resolve to undefined.
 */
export function useActions() {
  const qc = useQueryClient();
  const toast = useToast();

  const run = useCallback(
    async <T>(fn: () => Promise<T>, done?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        await qc.invalidateQueries({ queryKey: keys.state });
        if (done) toast({ text: done });
        return r;
      } catch (e) {
        toast({ text: errorMessage(e), tone: 'bad' });
        return undefined;
      }
    },
    [qc, toast],
  );

  return useMemo(
    () => ({
      run,
      refresh: () => qc.invalidateQueries({ queryKey: keys.state }),
      post: <T>(path: string, body?: unknown, done?: string) =>
        run(() => api.post<T>(path, body), done),
      patch: <T>(path: string, body: unknown, done?: string) =>
        run(() => api.patch<T>(path, body), done),
      del: (path: string, done?: string) => run(() => api.del<{ ok: true }>(path), done),
      saveSettings: (patch: Partial<Settings>) =>
        run(async () => {
          const settings = await api.patch<Settings>('/settings', patch);
          const cur = qc.getQueryData<AppState>(keys.state);
          if (cur) qc.setQueryData(keys.state, { ...cur, settings });
          return settings;
        }),
    }),
    [run, qc],
  );
}

export type Actions = ReturnType<typeof useActions>;
