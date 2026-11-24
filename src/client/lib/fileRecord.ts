// A file's record (its name, kind, when it was added, a comment): its entry on its job's
// timeline, or a transcript's meeting. Opened the same way from Files and from a job's Files tab.
import type { FileRef } from '@shared/types';
import { fileUrl } from './api';
import { useData } from './queries';
import { useSheets } from '../sheets/context';

/** Opens the file itself, in a new tab. */
export const openFile = (id: string) =>
  window.open(fileUrl(id, true), '_blank', 'noopener,noreferrer');

/**
 * Opens a file's record: its entry on a job (the job given, else the first it's on). A file on no
 * job has no record, so it just opens.
 */
export function useOpenFileRecord(): (f: FileRef, appId?: string) => void {
  const data = useData();
  const sheets = useSheets();
  return (f, appId) => {
    const on = appId ?? f.application_ids[0] ?? f.application_id;
    const evs = on && data ? (data.eventsByApp.get(on) ?? []) : [];
    const ev =
      evs.find((e) => e.type === 'note' && (e.data as { file_id?: string })?.file_id === f.id) ??
      evs.find((e) => e.id === f.event_id);
    if (on && ev) sheets.log(on, { eventId: ev.id });
    else openFile(f.id);
  };
}
