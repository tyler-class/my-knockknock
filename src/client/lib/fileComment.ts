import type { FileRef, TimelineEvent } from '@shared/types';
import { fileKindLabel } from '@shared/lookups';

/**
 * A file entry's comment: its body, except the "Transcript · name.txt" line older uploads wrote
 * there automatically, which isn't a comment.
 */
export function fileComment(ev: TimelineEvent, f?: Pick<FileRef, 'kind' | 'filename'>) {
  const body = ev.body ?? '';
  if (
    f ? body === `${fileKindLabel(f.kind)} · ${f.filename}` : /^[^\n·]+ · [^\n]+\.\w+$/.test(body)
  )
    return '';
  return body;
}
