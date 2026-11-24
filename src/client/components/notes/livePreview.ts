// Live preview for the call notes editor, adapted from Nitrogen's page editor. The notes are
// stored as markdown and drawn formatted all the time: the marks (**, *, ~~, <u>, list bullets,
// checkboxes) are hidden and the cursor steps over them as one character. Only what a quick
// notepad needs: bold, italic, underline, strikethrough, and bulleted, numbered and task lists.
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

/** The editor gained or lost focus. */
export const setFocus = StateEffect.define<boolean>();

// ------------------------------------------------------------- list lines

/** A list item's first line, split into its parts. Offsets are in the line. */
export interface ListLine {
  indent: number;
  /** "-", "*" or "+" for bullets. */
  bullet: string | null;
  /** The number, for ordered lists. */
  num: number | null;
  delim: string;
  /** Where the bullet or number ends, with its space. */
  markEnd: number;
  /** Offset of the "[ ]" checkbox, if any. */
  box: number | null;
  done: boolean;
  /** Where the text starts (after the bullet and checkbox). */
  content: number;
}

// A bullet or number needs its space ("- ", "1. ") so "-5" or "1.5" at the start of a line
// stays plain text.
const LIST_RE = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(?:(\[([ xX])\])([ \t]+|$))?/;

export function parseListLine(text: string): ListLine | null {
  const m = LIST_RE.exec(text);
  if (!m) return null;
  const indent = m[1]!.length;
  const markEnd = indent + (m[2] ?? `${m[3]}${m[4]}`).length + m[5]!.length;
  const box = m[6] ? markEnd : null;
  const content = m[6] ? markEnd + m[6].length + m[8]!.length : markEnd;
  return {
    indent,
    bullet: m[2] ?? null,
    num: m[3] ? Number(m[3]) : null,
    delim: m[4] ?? '.',
    markEnd,
    box,
    done: /x/i.test(m[7] ?? ''),
    content,
  };
}

const BULLETS = ['•', '◦', '▪'];
function alpha(n: number): string {
  let s = '';
  for (let k = Math.max(1, n); k > 0; k = Math.floor((k - 1) / 26))
    s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
  return s;
}
function roman(n: number): string {
  const r: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let out = '';
  for (const [v, s] of r)
    while (n >= v) {
      out += s;
      n -= v;
    }
  return out || 'i';
}
/** The marker for a list level: • ◦ ▪ for bullets, 1. a. i. for numbers, repeating. */
export function markerFor(level: number, num: number | null): string {
  const k = (level - 1) % 3;
  if (num === null) return BULLETS[k]!;
  return `${k === 0 ? num : k === 1 ? alpha(num) : roman(num)}.`;
}

// ----------------------------------------------------------------- widgets

/** A list line's start: bullet, number or checkbox, hanging in the margin. */
class PrefixWidget extends WidgetType {
  constructor(
    readonly marker: string,
    readonly check: 'open' | 'done' | null,
    /** Offset of "[ ]" from the widget's start. */
    readonly boxAt: number,
  ) {
    super();
  }
  eq(o: PrefixWidget) {
    return o.marker === this.marker && o.check === this.check && o.boxAt === this.boxAt;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span');
    wrap.className = 'cm-prefix';
    const slot = document.createElement('span');
    slot.className = 'cm-lm';
    if (this.check) {
      const b = document.createElement('span');
      b.className = 'note-check cm-check';
      b.setAttribute('role', 'checkbox');
      b.setAttribute('aria-checked', String(this.check === 'done'));
      b.setAttribute('aria-label', this.check === 'done' ? 'Untick' : 'Tick');
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const pos = view.posAtDOM(wrap) + this.boxAt;
        const box = view.state.sliceDoc(pos, pos + 3);
        if (!/^\[[ xX]\]$/.test(box)) return;
        view.dispatch({
          changes: { from: pos + 1, to: pos + 2, insert: box[1] === ' ' ? 'x' : ' ' },
        });
      });
      slot.appendChild(b);
    } else if (BULLETS.includes(this.marker)) {
      // Bullets drawn as shapes (the font's • ◦ ▪ are tiny): dot, ring, square by level.
      const dot = document.createElement('span');
      dot.className = `cm-dot cm-dot-${BULLETS.indexOf(this.marker)}`;
      slot.appendChild(dot);
    } else {
      slot.textContent = this.marker;
      slot.classList.add('cm-num');
    }
    wrap.appendChild(slot);
    return wrap;
  }
  ignoreEvent(e: Event) {
    return e.type === 'mousedown' && !!(e.target as HTMLElement).closest?.('.cm-check');
  }
}

// -------------------------------------------------------------- decorating

/** "<u>underlined</u>" text (HTML to markdown, so found by its tags, on one line). */
export const UNDERLINE_RE = /<u>(?=\S)(.*?\S)<\/u>/g;

export interface Live {
  focused: boolean;
  decos: DecorationSet;
  /** Hidden marks and drawn pieces: the cursor steps over them in one go. */
  atoms: RangeSet<Decoration>;
}

/** "Q:" at the start of a line: a round Q badge, marking a formal question. */
class QuestionBadge extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-qbadge';
    s.textContent = 'Q';
    s.setAttribute('aria-label', 'Question');
    return s;
  }
}

/** "Q:" (and the space after it) starting a line's text. */
export const QUESTION_RE = /^q:[ \t]*/i;

const hidden = Decoration.replace({});
/**
 * Hidden marks that open or close a format (the "**" around bold): Enter, Backspace and Delete
 * step around them rather than split or eat them.
 */
const opener = Decoration.replace({ role: 'open' });
const closer = Decoration.replace({ role: 'close' });
/** The hidden start of a line (a bullet, checkbox): the cursor never rests before it. */
const prefixMark = Decoration.replace({ role: 'prefix' });
export type MarkRole = 'open' | 'close' | 'prefix';

function build(state: EditorState): Omit<Live, 'focused'> {
  const doc = state.doc;
  const tree = ensureSyntaxTree(state, doc.length, 40) ?? syntaxTree(state);
  const out: Range<Decoration>[] = [];
  const atoms: Range<Decoration>[] = [];
  /** Code: no formatting inside. */
  const raw: [number, number][] = [];

  const hide = (from: number, to: number, role?: MarkRole) => {
    if (to <= from) return;
    const d = (
      role === 'open' ? opener : role === 'close' ? closer : role === 'prefix' ? prefixMark : hidden
    ).range(from, to);
    out.push(d);
    atoms.push(d);
  };
  /**
   * A line's hidden start (bullet, checkbox): kept in the line but drawn at no size, with its
   * widget beside it. The cursor still steps over it as one piece, but a line with nothing else
   * in it still has text for the browser to put the cursor after.
   */
  const conceal = (from: number, to: number, widget?: WidgetType) => {
    if (to <= from) return;
    if (widget) out.push(Decoration.widget({ widget, side: -1 }).range(from));
    out.push(Decoration.mark({ class: 'cm-conceal' }).range(from, to));
    atoms.push(prefixMark.range(from, to));
  };
  const mark = (from: number, to: number, cls: string) => {
    if (to > from) out.push(Decoration.mark({ class: cls }).range(from, to));
  };
  const lineDeco = (pos: number, cls: string, style?: string) =>
    out.push(
      Decoration.line({ class: cls, attributes: style ? { style } : undefined }).range(
        doc.lineAt(pos).from,
      ),
    );
  const inside = (list: [number, number][], from: number, to: number) =>
    list.some(([a, b]) => from < b && to > a);
  const levelAt = (pos: number) => {
    let level = 0;
    for (
      let p: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1);
      p;
      p = p.parent
    )
      if (p.name === 'ListItem') level++;
    return level;
  };

  tree.iterate({
    enter: (node) => {
      switch (node.name) {
        case 'Emphasis':
        case 'StrongEmphasis':
        case 'Strikethrough': {
          for (let c = node.node.firstChild; c; c = c.nextSibling)
            if (c.name === 'EmphasisMark' || c.name === 'StrikethroughMark')
              hide(c.from, c.to, c.from === node.from ? 'open' : 'close');
          return;
        }
        case 'Escape':
          hide(node.from, node.from + 1);
          return;
        case 'InlineCode':
        case 'FencedCode':
        case 'CodeBlock':
          raw.push([node.from, node.to]);
          return false;
      }
      return;
    },
  });

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;
    if (!text.trim()) continue;
    if (inside(raw, line.from, Math.max(line.to, line.from + 1)) && !parseListLine(text)) continue;

    const L = parseListLine(text);
    if (L) {
      const base = line.from;
      const level = Math.max(1, levelAt(base + L.indent));
      const check: 'open' | 'done' | null = L.box !== null ? (L.done ? 'done' : 'open') : null;
      conceal(base, base + L.content, new PrefixWidget(markerFor(level, L.num), check, L.box ?? 0));
      lineDeco(
        line.from,
        `cm-li${L.box !== null ? ' cm-task' : ''}${L.done ? ' cm-done' : ''}`,
        `--lvl:${level}`,
      );
    } else {
      // A line carried on inside a list item (indented under it): the item's indent, no marker.
      const ws = /^[ \t]*/.exec(text)![0].length;
      if (ws > 0) {
        const level = levelAt(line.from + ws);
        if (level) {
          conceal(line.from, line.from + ws);
          lineDeco(line.from, 'cm-li cm-li-more', `--lvl:${level}`);
        }
      }
    }

    // A question ("Q: …"): its "Q:" drawn as a round Q badge, one piece (Backspace takes it
    // whole); the line reads as a question.
    {
      const start = L ? L.content : /^[ \t]*/.exec(text)![0].length;
      const q = QUESTION_RE.exec(text.slice(start));
      if (q && !inside(raw, line.from + start, line.from + start + 1)) {
        // Replaced outright by the badge (not hidden at no size), so the cursor right after it
        // is a full-height cursor.
        const d = Decoration.replace({ widget: new QuestionBadge(), role: 'prefix' }).range(
          line.from + start,
          line.from + start + q[0].length,
        );
        out.push(d);
        atoms.push(d);
        lineDeco(line.from, 'cm-qline');
      }
    }

    // <u>Underlined</u> text: its tags hidden, the text underlined.
    if (text.includes('<u>')) {
      for (const h of text.matchAll(UNDERLINE_RE)) {
        const from = line.from + h.index;
        const to = from + h[0].length;
        if (inside(raw, from, to)) continue;
        hide(from, from + 3, 'open');
        mark(from + 3, to - 4, 'cm-u');
        hide(to - 4, to, 'close');
      }
    }
  }

  return {
    decos: Decoration.set(out, true),
    atoms: RangeSet.of(atoms, true),
  };
}

export const live = StateField.define<Live>({
  create: (state) => ({ focused: false, ...build(state) }),
  update(value, tr) {
    let focused = value.focused;
    for (const e of tr.effects) if (e.is(setFocus)) focused = e.value;
    if (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState))
      return { focused, ...build(tr.state) };
    return focused === value.focused ? value : { ...value, focused };
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.decos),
    EditorView.atomicRanges.of((view) => view.state.field(f).atoms),
  ],
});

/** Where the hidden start of `line` ends (its bullet, checkbox), or null if it has none. */
export function prefixEnd(state: EditorState, from: number): number | null {
  const { atoms } = state.field(live);
  let end = from;
  for (let moved = true; moved;) {
    moved = false;
    atoms.between(end, end, (f, t, d) => {
      if (f === end && t > end && (d.spec as { role?: MarkRole }).role === 'prefix') {
        end = t;
        moved = true;
        return false;
      }
    });
  }
  return end > from ? end : null;
}

/**
 * The cursor never rests in front of a line's hidden start (typing there would land before the
 * bullet and break it): it goes to where the text starts.
 */
const offLinePrefix = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection && !tr.docChanged) return tr;
  const sel = tr.newSelection.main;
  if (!sel.empty) return tr;
  const line = tr.state.doc.lineAt(sel.head);
  // Anywhere inside the hidden start (between a bullet and a question's Q badge, say).
  const end = prefixEnd(tr.state, line.from);
  if (end === null || sel.head >= end) return tr;
  return [tr, { selection: { anchor: end }, sequential: true }];
});

export function livePreview(): Extension {
  return [
    live,
    offLinePrefix,
    EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing)),
  ];
}
