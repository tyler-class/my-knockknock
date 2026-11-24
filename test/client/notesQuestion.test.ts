// The call notes editor: "Q:" starting a line is one piece, so Backspace takes it whole.
import { describe, expect, it } from 'vitest';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { live, livePreview } from '../../src/client/components/notes/livePreview';
import { backspace } from '../../src/client/components/notes/editorCommands';

function fake(doc: string, at: number) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(at),
    extensions: [markdown({ base: markdownLanguage }), livePreview()],
  });
  ensureSyntaxTree(state, doc.length, 1000);
  const view = {
    get state() {
      return state;
    },
    dispatch(...specs: TransactionSpec[]) {
      state = state.update(...specs).state;
    },
  };
  return view as unknown as EditorView;
}

describe('a question in the call notes', () => {
  it('draws "Q: " as one piece', () => {
    const v = fake('Q: Why now?', 0);
    const atoms: [number, number][] = [];
    v.state.field(live).atoms.between(0, 11, (f, t) => void atoms.push([f, t]));
    expect(atoms).toContainEqual([0, 3]);
  });

  it('loses the whole "Q: " to one Backspace', () => {
    const v = fake('Q: Why now?', 3);
    backspace(v);
    expect(v.state.doc.toString()).toBe('Why now?');
  });

  it('works on a list line too', () => {
    const v = fake('- Q: Team?', 5);
    backspace(v);
    expect(v.state.doc.toString()).toBe('- Team?');
  });
});
