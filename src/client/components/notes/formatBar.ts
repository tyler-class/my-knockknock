// The small dark pill over selected text in the call notes: bold, italic, underline,
// strikethrough, then bulleted, numbered and task lists (adapted from Nitrogen's format bar).
import type { EditorState, Extension } from '@codemirror/state';
import { showTooltip, type Tooltip } from '@codemirror/view';
import {
  currentListKind,
  formatActive,
  pending,
  setListKind,
  toggleFormat,
  type Format,
  type ListKind,
} from './editorCommands';
import { live } from './livePreview';

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = mac ? '⌘' : 'Ctrl+';

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const FORMATS: { f: Format; label: string; title: string }[] = [
  { f: 'bold', label: '<b>B</b>', title: `Bold (${mod}B)` },
  { f: 'italic', label: '<i>I</i>', title: `Italic (${mod}I)` },
  { f: 'underline', label: '<u>U</u>', title: `Underline (${mod}U)` },
  { f: 'strike', label: '<s>S</s>', title: `Strikethrough (${mod}⇧X)` },
];

const LISTS: { k: ListKind; label: string; title: string }[] = [
  {
    k: 'bullet',
    label: svg(
      '<path d="M10 6h10M10 12h10M10 18h10"/><circle cx="5" cy="6" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="5" cy="18" r="1.2" fill="currentColor"/>',
    ),
    title: 'Bulleted list',
  },
  {
    k: 'number',
    label: svg(
      '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5h1.5v4M4 8.5h3M4 14h3l-3 4h3" stroke-width="1.5"/>',
    ),
    title: 'Numbered list',
  },
  {
    k: 'task',
    label: svg(
      '<rect x="3.5" y="4.5" width="7" height="7" rx="2"/><path d="M5.3 8l1.4 1.4L9 6.8M14 8h7M3.5 17h7M14 17h7"/>',
    ),
    title: 'Task list',
  },
];

function button(label: string, title: string, run: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = label;
  // Keep the editor's focus and selection.
  b.addEventListener('mousedown', (e) => {
    e.preventDefault();
    run();
  });
  return b;
}

function formatBar(state: EditorState): Tooltip | null {
  const sel = state.selection.main;
  if (!state.field(live).focused || sel.empty) return null;
  return {
    pos: sel.from,
    end: sel.to,
    above: true,
    arrow: false,
    create(view) {
      const dom = document.createElement('div');
      dom.className = 'note-pill';
      dom.setAttribute('role', 'toolbar');
      dom.setAttribute('aria-label', 'Format');
      const formats = FORMATS.map(({ f, label, title }) => {
        const b = button(label, title, () => toggleFormat(view, f));
        dom.appendChild(b);
        return { f, b };
      });
      const sep = document.createElement('span');
      sep.className = 'note-pill-sep';
      dom.appendChild(sep);
      const lists = LISTS.map(({ k, label, title }) => {
        const b = button(label, title, () => setListKind(view, k));
        dom.appendChild(b);
        return { k, b };
      });
      const sync = (s: EditorState) => {
        formats.forEach(({ f, b }) => b.classList.toggle('on', formatActive(s, f)));
        const kind = currentListKind(s);
        lists.forEach(({ k, b }) => b.classList.toggle('on', kind === k));
      };
      sync(view.state);
      return { dom, update: (u) => sync(u.state) };
    },
  };
}

export function formatPill(): Extension {
  return showTooltip.compute(['selection', live, pending], formatBar);
}
