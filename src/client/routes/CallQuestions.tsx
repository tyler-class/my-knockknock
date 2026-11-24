// A meeting's questions, in call mode: every question (prepared ahead, or marked in the notes
// with "Q:"), each with a place to jot what was said and Asked. Typing an answer marks it asked;
// Asked can be set or cleared by hand too. Changes save on their own.
import { useEffect, useRef, useState } from 'react';
import type { CallQuestion } from '@shared/types';
import { newQuestionId } from '../lib/callQuestions';
import { SortableRows } from '../components/SortableRows';
import './callmode.css';
import { Icon } from '../components/Icon';
import { AutoTextarea, cx } from '../components/ui';

export function CallQuestions({
  questions,
  onChange,
  onAddFromBank,
}: {
  questions: CallQuestion[];
  onChange: (list: CallQuestion[]) => void;
  /** Add from the bank (opens the picker). */
  onAddFromBank?: () => void;
}) {
  // Edited here, saved a moment after typing stops (and when a box is left).
  const [list, setList] = useState(questions);
  const [draft, setDraft] = useState('');
  const dirty = useRef(false);
  const latest = useRef(list);
  useEffect(() => {
    latest.current = list;
  });
  // A newer list from outside (a question marked in the notes) while nothing is being typed.
  useEffect(() => {
    if (!dirty.current) setList(questions);
  }, [questions]);
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      dirty.current = false;
      onChange(latest.current);
    }, 800);
    return () => clearTimeout(t);
  }, [list, onChange]);
  const change = (next: CallQuestion[]) => {
    dirty.current = true;
    setList(next);
  };
  const flush = () => {
    if (!dirty.current) return;
    dirty.current = false;
    onChange(latest.current);
  };
  const set = (id: string, p: Partial<CallQuestion>) =>
    change(list.map((q) => (q.id === id ? { ...q, ...p } : q)));
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    dirty.current = false;
    const next = [...list, { id: newQuestionId(), text, answer: null, asked: false }];
    setList(next);
    onChange(next);
  };
  const open = list.filter((q) => !q.asked).length;
  // Drag a question by its grip to put it elsewhere in the list.
  const reorder = (next: CallQuestion[]) => {
    dirty.current = false;
    setList(next);
    onChange(next);
  };
  return (
    <div className="cmq">
      <div className="cmq-bar">
        <label className="cmq-add">
          <Icon name="plus" size={16} />
          <input
            value={draft}
            placeholder="Add a question"
            aria-label="Add a question"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        </label>
        {onAddFromBank && (
          <button type="button" className="btn sm cmq-bank" onClick={onAddFromBank}>
            <Icon name="link" size={14} /> Link from Questions
          </button>
        )}
      </div>
      {list.length > 0 && (
        <p className="cmq-count">
          {open} to ask · {list.length - open} asked
        </p>
      )}
      <div className="cmq-list">
        <SortableRows items={list} onReorder={reorder}>
          {(q, grip) => (
            <div className={cx('cmq-item', q.asked && 'asked')}>
              <div className="cmq-top">
                {grip}
                <button
                  type="button"
                  className="cmq-check"
                  role="checkbox"
                  aria-checked={q.asked}
                  aria-label={q.asked ? 'Asked' : 'Not asked yet'}
                  onClick={() => set(q.id, { asked: !q.asked })}
                >
                  {q.asked && <Icon name="check" size={14} />}
                </button>
                {/* A job's question: its words are the job's (changed on its Questions tab). */}
                <input
                  className="cmq-text"
                  value={q.text}
                  aria-label="Question"
                  readOnly={!!q.job_question_id}
                  onChange={(e) => set(q.id, { text: e.target.value })}
                  onBlur={flush}
                />

                {!q.job_question_id && (
                  <button
                    type="button"
                    className="cmq-rm"
                    aria-label="Remove question"
                    onClick={() => {
                      dirty.current = false;
                      const next = list.filter((x) => x.id !== q.id);
                      setList(next);
                      onChange(next);
                    }}
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
              <AutoTextarea
                className="cmq-answer"
                rows={1}
                value={q.answer ?? ''}
                placeholder="What was said…"
                aria-label={`Answer: ${q.text}`}
                onChange={(e) => {
                  const answer = e.target.value;
                  // Something written down: it was asked.
                  set(q.id, { answer, asked: q.asked || !!answer.trim() });
                }}
                onBlur={flush}
              />
            </div>
          )}
        </SortableRows>
      </div>
    </div>
  );
}
