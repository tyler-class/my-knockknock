// Reads a note's markdown (the call notes editor's dialect) into blocks and inline pieces, for
// NoteText. Only what the editor writes: **bold**, *italic* (or _italic_), <u>underline</u>,
// ~~strikethrough~~, `code`, and "- " bulleted, "1. " numbered and "- [ ] " task lists (nested by
// indenting). Everything else is plain text, line breaks kept.

export type Inline =
  string | { t: 'b' | 'i' | 'u' | 's'; c: Inline[] } | { t: 'code'; text: string };

export interface ListItem {
  /** The line's index in the text (for ticking a task). */
  line: number;
  /** null when it isn't a task. */
  done: boolean | null;
  /** Its text, and any lines carried on under it, joined by "\n". */
  text: string;
  children: ListBlock[];
}
export interface ListBlock {
  kind: 'list';
  ordered: boolean;
  start: number;
  items: ListItem[];
}
export interface TextBlock {
  kind: 'text';
  text: string;
}
export type Block = TextBlock | ListBlock;

const LIST_RE = /^([ \t]*)(?:([-*+])|(\d{1,9})[.)])[ \t]+(?:\[([ xX])\](?:[ \t]+|$))?(.*)$/;

interface Parsed {
  indent: number;
  ordered: boolean;
  num: number;
  done: boolean | null;
  text: string;
}

function parseLine(text: string): Parsed | null {
  const m = LIST_RE.exec(text);
  if (!m) return null;
  return {
    indent: m[1]!.replace(/\t/g, '    ').length,
    ordered: !m[2],
    num: m[3] ? Number(m[3]) : 1,
    done: m[4] === undefined ? null : m[4] !== ' ',
    text: m[5]!,
  };
}

/** The note's blocks: runs of plain lines, and lists (with their nested lists). */
export function parseNote(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let text: string[] = [];
  const flushText = () => {
    // Blank lines at the edges of a run go (the gap between blocks is drawn instead).
    while (text.length && !text[0]!.trim()) text.shift();
    while (text.length && !text[text.length - 1]!.trim()) text.pop();
    if (text.length) blocks.push({ kind: 'text', text: text.join('\n') });
    text = [];
  };
  /** The open lists, outermost first, with the column their items start at. */
  let stack: { indent: number; list: ListBlock }[] = [];
  let last: ListItem | null = null;

  lines.forEach((line, i) => {
    const p = parseLine(line);
    if (p) {
      flushText();
      while (stack.length && stack[stack.length - 1]!.indent > p.indent) stack.pop();
      const top = stack[stack.length - 1];
      const item: ListItem = { line: i, done: p.done, text: p.text, children: [] };
      if (top && top.indent === p.indent && top.list.ordered === p.ordered) {
        top.list.items.push(item);
      } else {
        const list: ListBlock = { kind: 'list', ordered: p.ordered, start: p.num, items: [item] };
        if (top && top.indent === p.indent) stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) parent.list.items[parent.list.items.length - 1]!.children.push(list);
        else blocks.push(list);
        stack.push({ indent: p.indent, list });
      }
      last = item;
      return;
    }
    // A line indented under a list item carries the item on.
    if (last && stack.length && /^[ \t]+\S/.test(line)) {
      last.text += `\n${line.trim()}`;
      return;
    }
    if (stack.length && !line.trim()) {
      // A blank line ends the list (it may start again below).
      stack = [];
      last = null;
      return;
    }
    stack = [];
    last = null;
    text.push(line);
  });
  flushText();
  return blocks;
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Where `mark` closes after `from` (not followed by more of its own character), or -1. */
function closing(s: string, mark: string, from: number): number {
  for (let j = s.indexOf(mark, from); j !== -1; j = s.indexOf(mark, j + 1)) {
    if (isSpace(s[j - 1])) continue;
    if (mark.length === 1 && (mark === '*' || mark === '_')) {
      // A single * isn't the start of a ** pair.
      if (s[j + 1] === mark) {
        j++;
        continue;
      }
      if (mark === '_' && isWord(s[j + 1])) continue;
    } else if (s[j + mark.length] === mark[0]) {
      // "***": the pair closes on the last two.
      continue;
    }
    return j;
  }
  return -1;
}

/** A line or paragraph's inline formatting. */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const push = (x: Inline) => {
    if (buf) out.push(buf);
    buf = '';
    out.push(x);
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\\' && i + 1 < s.length && /[!-/:-@[-`{-~]/.test(s[i + 1]!)) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        push({ t: 'code', text: s.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    if (s.startsWith('<u>', i)) {
      const j = s.indexOf('</u>', i + 3);
      if (j > i + 3) {
        push({ t: 'u', c: parseInline(s.slice(i + 3, j)) });
        i = j + 4;
        continue;
      }
    }
    let matched = false;
    for (const [mark, t] of [
      ['**', 'b'],
      ['__', 'b'],
      ['~~', 's'],
      ['*', 'i'],
      ['_', 'i'],
    ] as const) {
      if (!s.startsWith(mark, i) || isSpace(s[i + mark.length])) continue;
      if (mark[0] === '_' && isWord(s[i - 1])) continue;
      const j = closing(s, mark, i + mark.length);
      if (j === -1) continue;
      push({ t, c: parseInline(s.slice(i + mark.length, j)) });
      i = j + mark.length;
      matched = true;
      break;
    }
    if (!matched) {
      buf += c;
      i++;
    }
  }
  if (buf) out.push(buf);
  return out;
}
