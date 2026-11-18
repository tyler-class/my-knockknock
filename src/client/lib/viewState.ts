// View choices (Jobs view, stage and search; Stories filters) remembered on this device and
// kept in the address so a view can be bookmarked or shared. The address wins when it says
// something; otherwise the last choice on this device; otherwise the default.
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

type Values<K extends string> = Record<K, string>;

function readStored(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeStored(key: string, v: Record<string, string>) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode or storage full: the address still has it */
  }
}

/**
 * One group of view choices. `defaults` gives every key; a value equal to its default is left out
 * of the address. Set several at once with one call so they land in one address change.
 */
export function useViewState<K extends string>(
  storageKey: string,
  defaults: Values<K>,
): [Values<K>, (patch: Partial<Values<K>>) => void] {
  const [params, setParams] = useSearchParams();
  // Bumped on every choice, so a choice that leaves the address unchanged still re-reads storage.
  const [tick, setTick] = useState(0);
  const keys = Object.keys(defaults) as K[];
  const sig = keys.map((k) => `${k}=${params.get(k) ?? ''}`).join('&');
  const defSig = keys.map((k) => defaults[k]).join('\u0000');

  const values = useMemo(() => {
    const stored = readStored(storageKey);
    const out = {} as Values<K>;
    for (const k of keys) out[k] = params.get(k) ?? stored[k] ?? defaults[k];
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, sig, defSig, tick]);

  const set = useCallback(
    (patch: Partial<Values<K>>) => {
      const next = { ...values, ...patch };
      writeStored(storageKey, next);
      setTick((t) => t + 1);
      setParams(
        (p) => {
          const q = new URLSearchParams(p);
          for (const k of keys) {
            if (next[k] === defaults[k] || next[k] === '') q.delete(k);
            else q.set(k, next[k]);
          }
          return q;
        },
        { replace: true },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey, values, setParams, defSig],
  );

  return [values, set];
}
