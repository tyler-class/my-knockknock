// The call notes editor: markdown underneath, drawn formatted as you type (bold, italic,
// underline, strikethrough, bulleted, numbered and task lists), with ⌘B/I/U and a small format
// pill over selected text. Adapted from Nitrogen's editor; heavy, so load it with React.lazy.
import { useEffect, useRef } from 'react';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Annotation, EditorState, Prec, Transaction } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderText } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { editorCommands } from './editorCommands';
import { formatPill } from './formatBar';
import { livePreview } from './livePreview';
import './notes.css';

const highlight = HighlightStyle.define([
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
]);

/** The event that puts the cursor at the end of the notes (sent on window). */
export const FOCUS_NOTES_END = 'kk:notes-focus-end';

/** Marks the text being replaced from outside, so it isn't echoed back through onChange. */
const fromOutside = Annotation.define<boolean>();

export interface NotesEditorProps {
  /** The notes, as markdown. A new value from outside (loading the saved note) replaces the text. */
  value: string;
  onChange(value: string): void;
  /** Leaving the field. */
  onBlur?(): void;
  placeholder?: string;
  label: string;
  autoFocus?: boolean;
}

export default function NotesEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  label,
  autoFocus,
}: NotesEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onChange, onBlur });
  /** The last text sent out through onChange: it coming back as `value` is not news. */
  const sent = useRef(value);
  useEffect(() => {
    latest.current = { onChange, onBlur };
  });

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        selection: { anchor: value.length },
        extensions: [
          history(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': label,
            'aria-multiline': 'true',
            autocorrect: 'on',
            autocapitalize: 'sentences',
            spellcheck: 'true',
          }),
          Prec.high(editorCommands()),
          markdown({ base: markdownLanguage, addKeymap: false }),
          syntaxHighlighting(highlight),
          livePreview(),
          formatPill(),
          // Not ⌘/ (Ctrl+/): CodeMirror's "comment out" wraps the line in <!-- -->, which notes
          // have no use for.
          keymap.of([...defaultKeymap.filter((k) => k.key !== 'Mod-/'), ...historyKeymap]),
          ...(placeholder ? [placeholderText(placeholder)] : []),
          EditorView.domEventHandlers({
            blur: () => {
              latest.current.onBlur?.();
              return false;
            },
          }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || u.transactions.some((t) => t.annotation(fromOutside))) return;
            sent.current = u.state.doc.toString();
            latest.current.onChange(sent.current);
          }),
        ],
      }),
    });
    view.current = v;
    if (autoFocus) v.focus();
    return () => {
      v.destroy();
      view.current = null;
    };
    // Made once; the text flows out through onChange and back in only when it differs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Asked to take the cursor (Call Mode's Option+/ or Option+N): at the end of the notes, scrolled
  // into view.
  useEffect(() => {
    const go = () => {
      const v = view.current;
      if (!v) return;
      const end = v.state.doc.length;
      v.focus();
      v.dispatch({
        selection: { anchor: end },
        effects: EditorView.scrollIntoView(end, { y: 'nearest', yMargin: 40 }),
      });
    };
    window.addEventListener(FOCUS_NOTES_END, go);
    return () => window.removeEventListener(FOCUS_NOTES_END, go);
  }, []);

  // Text set from outside (the saved note arriving): replace what's there.
  useEffect(() => {
    const v = view.current;
    if (!v || value === sent.current || v.state.doc.toString() === value) return;
    sent.current = value;
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: value },
      selection: { anchor: Math.min(v.state.selection.main.head, value.length) },
      annotations: [fromOutside.of(true), Transaction.addToHistory.of(false)],
    });
  }, [value]);

  return <div ref={host} className="notes-editor" />;
}
