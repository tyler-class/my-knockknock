// The search this device is looking at. Everything but Stories (Home, Pipeline, Report,
// counts) follows it. Remembered on the device; picking one also tells the server, so new
// applications and assistants (MCP's "current search") follow the latest pick.
import { useSyncExternalStore } from 'react';

const KEY = 'knockknock-search';
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let current = read();

export function setDeviceSearch(id: string | null) {
  current = id;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: still applies for this visit */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const useDeviceSearch = () =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
