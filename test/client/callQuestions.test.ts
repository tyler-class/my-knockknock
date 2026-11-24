// Questions marked in call notes ("Q: …") and the meeting's list.
import { describe, expect, it } from 'vitest';
import { questionsInNotes, withNoteQuestions } from '../../src/client/lib/callQuestions';

describe('call questions', () => {
  it('reads Q: lines with words after them, and nothing else', () => {
    expect(questionsInNotes('Intro\nQ: Why now?\n- q: team size\nQ:   \nQ:')).toEqual([
      'Why now?',
      'team size',
    ]);
  });

  it('adds new questions and skips ones already there', () => {
    const list = withNoteQuestions(
      [{ id: 'a', text: 'Why now?', answer: null, asked: false }],
      'Q: why now?\nQ: Team size?',
    );
    expect(list.map((q) => q.text)).toEqual(['Why now?', 'Team size?']);
  });

  it('finishes a half-typed question instead of adding a second', () => {
    const list = withNoteQuestions(
      [{ id: 'a', text: 'What does succ', answer: null, asked: false }],
      'Q: What does success look like?',
    );
    expect(list).toEqual([
      { id: 'a', text: 'What does success look like?', answer: null, asked: false },
    ]);
  });

  it('keeps an answered question as it is', () => {
    const list = withNoteQuestions(
      [{ id: 'a', text: 'Team', answer: 'Six people', asked: true }],
      'Q: Team size?',
    );
    expect(list.map((q) => q.text)).toEqual(['Team', 'Team size?']);
  });
});

describe('deleting a question from the notes', () => {
  it('takes it off the list when nothing was written for it', () => {
    const list = withNoteQuestions(
      [
        { id: 'a', text: 'Team size?', answer: null, asked: false, from_notes: true },
        { id: 'b', text: 'Why now?', answer: 'Funding', asked: true, from_notes: true },
        { id: 'c', text: 'Added by hand', answer: null, asked: false },
      ],
      'no questions left here',
    );
    expect(list.map((q) => q.id)).toEqual(['b', 'c']);
  });
});
