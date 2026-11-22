// A note's text, formatted: the call notes editor's markdown (bold, italic, underline,
// strikethrough, bulleted, numbered and task lists) drawn read-only. Plain text shows as written,
// line breaks kept. Pass onChange to let a tap tick a task off (it hands back the new text).
import { Fragment, type ReactNode } from 'react';
import { parseInline, parseNote, type Inline, type ListBlock } from './noteMarkdown';
import './notes.css';

function inline(parts: Inline[]): ReactNode[] {
  return parts.map((p, k) => {
    if (typeof p === 'string') return p;
    if (p.t === 'code') return <code key={k}>{p.text}</code>;
    const c = inline(p.c);
    if (p.t === 'b') return <strong key={k}>{c}</strong>;
    if (p.t === 'i') return <em key={k}>{c}</em>;
    if (p.t === 'u') return <u key={k}>{c}</u>;
    return <s key={k}>{c}</s>;
  });
}

/** Text over several lines: each line's formatting, with the breaks kept. */
function lines(text: string): ReactNode[] {
  return text.split('\n').map((l, k) => (
    <Fragment key={k}>
      {k > 0 && <br />}
      {inline(parseInline(l))}
    </Fragment>
  ));
}

function toggleLine(src: string, line: number): string {
  const all = src.split('\n');
  const l = all[line];
  if (l === undefined) return src;
  all[line] = l.replace(/\[([ xX])\]/, (_m, c: string) => (c === ' ' ? '[x]' : '[ ]'));
  return all.join('\n');
}

function List({
  list,
  text,
  onChange,
}: {
  list: ListBlock;
  text: string;
  onChange?: (text: string) => void;
}) {
  const items = list.items.map((it) => (
    <li
      key={it.line}
      className={it.done === null ? undefined : it.done ? 'nt-task done' : 'nt-task'}
    >
      {it.done !== null &&
        (onChange ? (
          <button
            type="button"
            className="note-check"
            role="checkbox"
            aria-checked={it.done}
            aria-label={it.done ? 'Untick' : 'Tick'}
            onClick={(e) => {
              e.stopPropagation();
              onChange(toggleLine(text, it.line));
            }}
          />
        ) : (
          <span className="note-check" role="checkbox" aria-checked={it.done} aria-disabled />
        ))}
      <span className="nt-li">{lines(it.text)}</span>
      {it.children.map((c, k) => (
        <List key={k} list={c} text={text} onChange={onChange} />
      ))}
    </li>
  ));
  const tasks = list.items.every((i) => i.done !== null);
  return list.ordered ? (
    <ol start={list.start === 1 ? undefined : list.start}>{items}</ol>
  ) : (
    <ul className={tasks ? 'nt-tasks' : undefined}>{items}</ul>
  );
}

export function NoteText({
  text,
  className,
  onChange,
}: {
  /** The note's text (markdown, or plain). */
  text: string;
  className?: string;
  /** Ticking a task hands back the whole new text; leave out for read-only. */
  onChange?: (text: string) => void;
}) {
  const blocks = parseNote(text);
  return (
    <div className={className ? `note-text ${className}` : 'note-text'}>
      {blocks.map((b, k) =>
        b.kind === 'text' ? (
          <p key={k}>{lines(b.text)}</p>
        ) : (
          <List key={k} list={b} text={text} onChange={onChange} />
        ),
      )}
    </div>
  );
}
