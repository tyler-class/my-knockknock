// How typing behaves in the call notes editor (adapted from Nitrogen): Enter, Backspace and Tab in
// lists; formatting shortcuts that wrap the selection, or hold the format for what you type next;
// "[ ] " starting a task; and turning lines into bulleted, numbered or task lists.
import { syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type ChangeSpec,
  type Extension,
} from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';
import {
  live,
  parseListLine,
  prefixEnd,
  QUESTION_RE,
  UNDERLINE_RE,
  type ListLine,
  type MarkRole,
} from './livePreview';

// ------------------------------------------------------------------ helpers

function inCode(state: EditorState, pos: number): boolean {
  for (
    let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(
      state,
    ).resolveInner(pos, -1);
    n;
    n = n.parent
  )
    if (n.name === 'FencedCode' || n.name === 'CodeBlock' || n.name === 'InlineCode') return true;
  return false;
}

/** The prefix a new line in this list gets (the same kind, unticked, numbered on). */
function nextPrefix(L: ListLine): string {
  const indent = ' '.repeat(L.indent);
  const mark = L.bullet ? `${L.bullet} ` : `${(L.num ?? 0) + 1}${L.delim} `;
  return `${indent}${mark}${L.box !== null ? '[ ] ' : ''}`;
}

// --------------------------------------------------------------- indenting

/** Indents (or outdents) a list item with everything under it. */
function shiftItem(view: EditorView, out: boolean): boolean {
  const { state } = view;
  const sel = state.selection.main;
  const doc = state.doc;
  const line = doc.lineAt(sel.head);
  const L = parseListLine(line.text);
  if (!L) return false;
  const indentOf = (t: string) => /^[ \t]*/.exec(t)![0].length;
  const old = L.indent;
  let target: number;
  let renumber: number | null = null;
  if (!out) {
    // Under the item above at the same level: its text's column.
    let sib: ListLine | null = null;
    for (let n = line.number - 1; n >= 1; n--) {
      const t = doc.line(n).text;
      if (!t.trim()) break;
      const l = parseListLine(t);
      const ind = indentOf(t);
      if (l && ind === old) {
        sib = l;
        break;
      }
      if (ind < old || (!l && ind <= old)) break;
    }
    if (!sib) return true;
    target = sib.markEnd;
    // A new sublist of numbers starts at 1.
    if (L.num !== null) {
      let first = true;
      for (let n = line.number - 1; n >= 1; n--) {
        const t = doc.line(n).text;
        const ind = indentOf(t);
        if (ind <= old) break;
        if (ind === target && parseListLine(t)?.num != null) first = false;
      }
      if (first) renumber = 1;
    }
  } else {
    if (old === 0) return true;
    // Back to the parent item's column.
    let parent: ListLine | null = null;
    for (let n = line.number - 1; n >= 1; n--) {
      const t = doc.line(n).text;
      const l = parseListLine(t);
      if (l && indentOf(t) < old) {
        parent = l;
        break;
      }
    }
    target = parent ? parent.indent : 0;
    if (L.num !== null && parent?.num != null) renumber = parent.num + 1;
  }
  const delta = target - old;
  const changes: ChangeSpec[] = [];
  const shift = (n: number) => {
    const l = doc.line(n);
    const ind = indentOf(l.text);
    if (delta > 0) changes.push({ from: l.from, insert: ' '.repeat(delta) });
    else changes.push({ from: l.from, to: l.from + Math.min(ind, -delta) });
  };
  shift(line.number);
  // Its own lines and sub-items come along.
  for (let n = line.number + 1; n <= doc.lines; n++) {
    const t = doc.line(n).text;
    if (!t.trim() || indentOf(t) <= old) break;
    shift(n);
  }
  if (renumber !== null && L.num !== null) {
    const at = line.from + L.indent;
    changes.push({ from: at, to: at + String(L.num).length, insert: String(renumber) });
  }
  view.dispatch({ changes, userEvent: out ? 'delete.dedent' : 'input.indent' });
  return true;
}

// ------------------------------------------------------------------- Enter

/**
 * Past a run of hidden opening or closing marks (role "open" or "close") from `pos`, forwards
 * (dir 1) or backwards (dir -1). Returns `pos` when there are none.
 */
function pastMarks(state: EditorState, pos: number, dir: 1 | -1, role: MarkRole): number {
  const { atoms } = state.field(live);
  let p = pos;
  for (let moved = true; moved;) {
    moved = false;
    atoms.between(Math.max(0, p - 1), Math.min(state.doc.length, p + 1), (f, t, d) => {
      if ((d.spec as { role?: MarkRole }).role !== role) return;
      if (dir === 1 && f === p && t > p) {
        p = t;
        moved = true;
        return false;
      }
      if (dir === -1 && t === p && f < p) {
        p = f;
        moved = true;
        return false;
      }
    });
  }
  return p;
}

/**
 * Where a line break goes for the cursor at `pos`: never between formatted text and its hidden
 * marks. At the end of bold (before its closing "**"), after the marks; at its start, before.
 */
function breakPoint(state: EditorState, pos: number): number {
  const after = pastMarks(state, pos, 1, 'close');
  if (after !== pos) return after;
  return pastMarks(state, pos, -1, 'open');
}

function enter(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const pos = breakPoint(state, sel.head);
  const line = state.doc.lineAt(pos);
  const L = parseListLine(line.text);
  if (L) {
    const start = line.from + L.content;
    const content = line.text.slice(L.content);
    if (!content.trim()) {
      // An empty item: out a level, or out of the list, onto a clean line.
      if (L.indent > 0) return shiftItem(view, true);
      view.dispatch({
        changes: { from: line.from, to: line.to },
        selection: { anchor: line.from },
        userEvent: 'delete',
      });
      return true;
    }
    const at = Math.max(pos, start);
    const prefix = nextPrefix(L);
    const rest = state.sliceDoc(at, line.to);
    view.dispatch({
      changes: { from: at, to: line.to, insert: `\n${prefix}${rest.replace(/^[ \t]+/, '')}` },
      selection: { anchor: at + 1 + prefix.length },
      scrollIntoView: true,
      userEvent: 'input',
    });
    return true;
  }
  view.dispatch({
    changes: { from: pos, insert: '\n' },
    selection: { anchor: pos + 1 },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

/** Shift-Enter: a new line inside the same item, with no new bullet. */
function softBreak(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  const L = parseListLine(state.doc.lineAt(sel.head).text);
  const insert = `\n${L ? ' '.repeat(L.content) : ''}`;
  const at = sel.empty ? breakPoint(state, sel.head) : sel.from;
  view.dispatch({
    changes: { from: at, to: sel.empty ? at : sel.to, insert },
    selection: { anchor: at + insert.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

// --------------------------------------------------------------- Backspace

export function backspace(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const pos = sel.head;
  if (inCode(state, pos)) return false;
  const line = state.doc.lineAt(pos);
  const L = parseListLine(line.text);
  // Right after a question's Q badge: the whole "Q: " goes (the line stays, as plain text).
  {
    const start = line.from + (L ? L.content : /^[ \t]*/.exec(line.text)![0].length);
    const q = QUESTION_RE.exec(line.text.slice(start - line.from));
    if (q && pos === start + q[0].length) {
      view.dispatch({
        changes: { from: start, to: pos },
        selection: { anchor: start },
        userEvent: 'delete.backward',
      });
      return true;
    }
  }
  if (L && pos === line.from + L.content) {
    // At the start of an item's text: out a level first, then back to plain text.
    if (L.indent > 0) return shiftItem(view, true);
    view.dispatch({
      changes: { from: line.from, to: pos },
      selection: { anchor: line.from },
      userEvent: 'delete',
    });
    return true;
  }
  // Right after formatted text (its closing marks hidden): the last letter goes, not the marks.
  // If that was its only letter, the marks go with it.
  const closeFrom = pastMarks(state, pos, -1, 'close');
  if (closeFrom !== pos && closeFrom > line.from) {
    const openFrom = pastMarks(state, closeFrom - 1, -1, 'open');
    const range =
      openFrom !== closeFrom - 1
        ? { from: openFrom, to: pos }
        : { from: closeFrom - 1, to: closeFrom };
    view.dispatch({ changes: range, userEvent: 'delete.backward' });
    return true;
  }
  // At the start of formatted text: the letter before it goes, not its opening marks.
  const openFrom = pastMarks(state, pos, -1, 'open');
  if (openFrom !== pos) {
    if (openFrom <= line.from) return false;
    view.dispatch({
      changes: { from: openFrom - 1, to: openFrom },
      selection: { anchor: pos - 1 },
      userEvent: 'delete.backward',
    });
    return true;
  }
  return false;
}

/** Delete (forwards): the same, the other way round. */
function deleteForward(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty || inCode(state, sel.head)) return false;
  const pos = sel.head;
  // At the end of a line, before a list item: joining the lines takes the next one's text, not
  // its hidden bullet.
  const here = state.doc.lineAt(pos);
  if (pos === here.to && here.number < state.doc.lines) {
    const next = state.doc.line(here.number + 1);
    const end = prefixEnd(state, next.from);
    if (end !== null) {
      view.dispatch({ changes: { from: pos, to: end }, userEvent: 'delete.forward' });
      return true;
    }
  }
  // Just before formatted text: its first letter goes (and its marks, if that was the only one).
  const openTo = pastMarks(state, pos, 1, 'open');
  if (openTo !== pos) {
    const closeTo = pastMarks(state, openTo + 1, 1, 'close');
    view.dispatch({
      changes:
        closeTo !== openTo + 1 ? { from: pos, to: closeTo } : { from: openTo, to: openTo + 1 },
      userEvent: 'delete.forward',
    });
    return true;
  }
  // At the end of formatted text: what comes after its closing marks goes.
  const closeTo = pastMarks(state, pos, 1, 'close');
  if (closeTo !== pos) {
    if (closeTo < state.doc.length)
      view.dispatch({
        changes: { from: closeTo, to: closeTo + 1 },
        selection: { anchor: pos },
        userEvent: 'delete.forward',
      });
    return true;
  }
  return false;
}

// -------------------------------------------------------------- formatting

export type Format = 'bold' | 'italic' | 'underline' | 'strike';
const OPEN: Record<Format, string> = { bold: '**', italic: '*', underline: '<u>', strike: '~~' };
const CLOSE: Record<Format, string> = { bold: '**', italic: '*', underline: '</u>', strike: '~~' };
const NODE: Record<Format, string> = {
  bold: 'StrongEmphasis',
  italic: 'Emphasis',
  underline: '',
  strike: 'Strikethrough',
};

/** Formats waiting for the next thing typed (⌘B with nothing selected). */
export const setPending = StateEffect.define<Format[]>();
export const pending = StateField.define<Format[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPending)) return e.value;
    if (tr.docChanged || tr.selection) return value.length ? [] : value;
    return value;
  },
});

/** The formatted span around a position, if any. */
function enclosing(
  state: EditorState,
  from: number,
  to: number,
  f: Format,
): { from: number; to: number } | null {
  if (f === 'underline') {
    const line = state.doc.lineAt(from);
    if (to > line.to) return null;
    for (const m of line.text.matchAll(UNDERLINE_RE)) {
      const a = line.from + m.index;
      const b = a + m[0].length;
      if (a <= from && b >= to) return { from: a, to: b };
    }
    return null;
  }
  for (const side of [1, -1] as const)
    for (
      let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(
        state,
      ).resolveInner(from, side);
      n;
      n = n.parent
    )
      if (n.name === NODE[f] && n.from <= from && n.to >= to) return n;
  return null;
}

/** Is this format on at the cursor (or across the selection)? */
export function formatActive(state: EditorState, f: Format): boolean {
  const { from, to } = state.selection.main;
  if (state.field(pending).includes(f)) return true;
  const n = enclosing(state, from, to, f);
  return !!n && from >= n.from + OPEN[f].length && to <= n.to - CLOSE[f].length;
}

export function toggleFormat(view: EditorView, f: Format): boolean {
  const { state } = view;
  const sel = state.selection.main;
  const open = OPEN[f];
  const close = CLOSE[f];
  const n = enclosing(state, sel.from, sel.to, f);
  if (sel.empty) {
    // At the end of formatted text: step out of it, so what comes next is plain.
    if (n && sel.head >= n.to - close.length && sel.head <= n.to) {
      view.dispatch({ selection: { anchor: n.to } });
      return true;
    }
    const cur = state.field(pending);
    view.dispatch({
      effects: setPending.of(cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]),
    });
    return true;
  }
  if (n) {
    // Already formatted: take the marks off.
    view.dispatch({
      changes: [
        { from: n.from, to: n.from + open.length },
        { from: n.to - close.length, to: n.to },
      ],
      selection: {
        anchor: Math.max(n.from, sel.from - open.length),
        head: Math.min(n.to - open.length - close.length, sel.to - open.length),
      },
      userEvent: 'format',
    });
    return true;
  }
  // Keep the spaces at the edges outside the marks ("**word** " not "**word **").
  const text = state.sliceDoc(sel.from, sel.to);
  const lead = /^\s*/.exec(text)![0].length;
  const trail = /\s*$/.exec(text)![0].length;
  const from = sel.from + lead;
  const to = sel.to - trail;
  if (to <= from) return true;
  // Across lines, each line's text is wrapped on its own (marks don't run over line breaks).
  const changes: ChangeSpec[] = [];
  for (let l = state.doc.lineAt(from); ; l = state.doc.line(l.number + 1)) {
    const lp = parseListLine(l.text);
    const a = Math.max(
      from,
      l.from + (lp?.content ?? 0) + /^\s*/.exec(l.text.slice(lp?.content ?? 0))![0].length,
    );
    const b = Math.min(to, l.from + l.text.replace(/\s+$/, '').length);
    if (b > a) changes.push({ from: a, insert: open }, { from: b, insert: close });
    if (l.to >= to || l.number >= state.doc.lines) break;
  }
  if (!changes.length) return true;
  const set = state.changes(changes);
  view.dispatch({
    changes: set,
    selection: EditorSelection.range(set.mapPos(from, 1), set.mapPos(to, -1)),
    userEvent: 'format',
  });
  return true;
}

/** The next character typed takes the waiting formats. */
const typeWithPending = EditorView.inputHandler.of((view, from, to, text) => {
  const waiting = view.state.field(pending);
  if (!waiting.length || text.includes('\n')) return false;
  // A space goes in plain and the formats keep waiting ("** bold**" wouldn't be bold).
  if (!text.trim()) {
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      effects: setPending.of(waiting),
      userEvent: 'input.type',
    });
    return true;
  }
  const open = waiting.map((f) => OPEN[f]).join('');
  const close = [...waiting]
    .reverse()
    .map((f) => CLOSE[f])
    .join('');
  view.dispatch({
    changes: { from, to, insert: `${open}${text}${close}` },
    selection: { anchor: from + open.length + text.length },
    effects: setPending.of([]),
    userEvent: 'input.type',
  });
  return true;
});

// ------------------------------------------------------------- line kinds

export type ListKind = 'bullet' | 'number' | 'task';

function kindOf(L: ListLine | null): ListKind | null {
  if (!L) return null;
  return L.box !== null ? 'task' : L.num !== null ? 'number' : 'bullet';
}

/** The kind of list the cursor's line is in, for the format pill's buttons. */
export function currentListKind(state: EditorState): ListKind | null {
  return kindOf(parseListLine(state.doc.lineAt(state.selection.main.head).text));
}

/**
 * Makes the selected lines a bulleted, numbered or task list; the same kind again turns them back
 * into plain text. The text stays put.
 */
export function setListKind(view: EditorView, kind: ListKind): boolean {
  const { state } = view;
  const sel = state.selection.main;
  const first = state.doc.lineAt(sel.from).number;
  const last = state.doc.lineAt(sel.to).number;
  const lines = [];
  for (let n = first; n <= last; n++) lines.push(state.doc.line(n));
  const used = lines.filter((l) => l.text.trim() || lines.length === 1);
  const off = used.every((l) => kindOf(parseListLine(l.text)) === kind);
  const changes: ChangeSpec[] = [];
  let num = 1;
  for (const l of used) {
    const L = parseListLine(l.text);
    const indent = L ? l.text.slice(0, L.indent) : '';
    const prefix = off
      ? ''
      : indent + (kind === 'bullet' ? '- ' : kind === 'number' ? `${num++}. ` : '- [ ] ');
    changes.push({ from: l.from, to: l.from + (L ? L.content : 0), insert: prefix });
  }
  const set = state.changes(changes);
  view.dispatch({
    changes: set,
    selection: sel.empty
      ? { anchor: set.mapPos(sel.head, 1) }
      : EditorSelection.range(set.mapPos(sel.from, 1), set.mapPos(sel.to, 1)),
    userEvent: 'input.format',
  });
  return true;
}

// -------------------------------------------------------------- shortcuts

/** "[] " or "[ ] " at the start of a line makes a task. */
const checklistRule = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== ' ') return false;
  const line = view.state.doc.lineAt(from);
  const before = view.state.sliceDoc(line.from, from);
  if (!/^\s*\[ ?\]$/.test(before) || inCode(view.state, from)) return false;
  const indent = /^\s*/.exec(before)![0];
  view.dispatch({
    changes: { from: line.from, to, insert: `${indent}- [ ] ` },
    selection: { anchor: line.from + indent.length + 6 },
    userEvent: 'input.type',
  });
  return true;
});

const bindings: KeyBinding[] = [
  { key: 'Enter', run: enter },
  { key: 'Shift-Enter', run: softBreak },
  { key: 'Backspace', run: backspace },
  { key: 'Delete', run: deleteForward },
  // Tab indents a list item; elsewhere it moves focus on, as usual.
  { key: 'Tab', run: (v) => shiftItem(v, false), shift: (v) => shiftItem(v, true) },
  {
    // ← at the start of a list item's text: on to the end of the line above.
    key: 'ArrowLeft',
    run: (v) => {
      const sel = v.state.selection.main;
      if (!sel.empty) return false;
      const line = v.state.doc.lineAt(sel.head);
      if (line.number === 1 || prefixEnd(v.state, line.from) !== sel.head) return false;
      v.dispatch({
        selection: { anchor: line.from - 1 },
        scrollIntoView: true,
        userEvent: 'select',
      });
      return true;
    },
  },
  { key: 'Mod-b', run: (v) => toggleFormat(v, 'bold') },
  { key: 'Mod-i', run: (v) => toggleFormat(v, 'italic') },
  { key: 'Mod-u', run: (v) => toggleFormat(v, 'underline') },
  { key: 'Mod-Shift-x', run: (v) => toggleFormat(v, 'strike') },
  { key: 'Mod-Shift-8', run: (v) => setListKind(v, 'bullet') },
  { key: 'Mod-Shift-7', run: (v) => setListKind(v, 'number') },
  { key: 'Mod-Shift-9', run: (v) => setListKind(v, 'task') },
];

export function editorCommands(): Extension {
  return [pending, keymap.of(bindings), typeWithPending, checklistRule];
}
