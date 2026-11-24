// A job's Questions tab: the questions to ask on every call for this job. From the bank, or
// written just for this job (kept in the bank too only if you choose). They come up in Call Mode
// for all of the job's calls.
import { useState } from 'react';
import type { Application, JobQuestion } from '@shared/types';
import { useActions, type Data } from '../lib/queries';
import { Icon } from '../components/Icon';
import { QuestionBankPicker } from '../components/QuestionBankPicker';
import { NewQuestionCard } from '../components/NewQuestionCard';
import { RemoveFromJob } from '../components/RemoveFromJob';
import { api } from '../lib/api';
import { SortableRows, type RowGrip } from '../components/SortableRows';
import './callmode.css';

export function JobQuestions({ a, data }: { a: Application; data: Data }) {
  const act = useActions();
  const [writing, setWriting] = useState(false);
  const [picking, setPicking] = useState(false);
  const saved = data.state.job_questions.filter((j) => j.application_id === a.id);
  // Drag a question by its grip to reorder (the order Call Mode starts with).
  const [order, setOrder] = useState<string[] | null>(null);
  const list = order
    ? order.map((id) => saved.find((j) => j.id === id)).filter((j): j is JobQuestion => !!j)
    : saved;
  const reorder = (next: JobQuestion[]) => {
    setOrder(next.map((j) => j.id));
    void act
      .run(async () => {
        for (const [i, j] of next.entries())
          if (j.position !== i) await api.patch(`/job-questions/${j.id}`, { position: i });
      })
      .finally(() => setOrder(null));
  };
  return (
    <section className="sec" aria-label="Questions">
      <div className="sec-h">
        <h2>Questions {list.length ? `· ${list.length}` : ''}</h2>
        <div className="acts">
          <button type="button" className="btn sm" onClick={() => setPicking(true)}>
            <Icon name="link" size={14} /> Link from Questions
          </button>
          <button type="button" className="btn sm" onClick={() => setWriting(true)}>
            <Icon name="plus" size={14} /> New question for this job
          </button>
        </div>
      </div>
      {writing && (
        <NewQuestionCard
          bankChoice
          onAdd={(text, toBank) =>
            act.post(`/applications/${a.id}/questions`, { text, to_bank: toBank })
          }
          onCancel={() => setWriting(false)}
        />
      )}
      {/* One card, a row per question (like the job's Stories); drag a row's grip to move it. */}
      <div className="card list">
        <SortableRows items={list} onReorder={reorder}>
          {(q, grip) => <JobQuestionRow q={q} grip={grip} />}
        </SortableRows>
        {!list.length && <p className="empty">No questions for this job yet.</p>}
      </div>
      {picking && (
        <QuestionBankPicker
          taken={new Set(list.map((j) => j.question_id).filter((x): x is string => !!x))}
          onPick={(q) => act.post(`/applications/${a.id}/questions`, { question_id: q.id })}
          onClose={() => setPicking(false)}
        />
      )}
    </section>
  );
}

/** One of the job's questions, as a row: its words (edited in place), Save to bank for one of
 * its own, and remove. */
function JobQuestionRow({ q, grip }: { q: JobQuestion; grip: RowGrip }) {
  const act = useActions();
  const [text, setText] = useState(q.text);
  const save = () => {
    const t = text.trim();
    if (!t) return setText(q.text);
    if (t !== q.text) void act.patch(`/job-questions/${q.id}`, { text: t });
  };
  return (
    <div className="story-line q-line">
      {grip}
      <span className="cmq-qmark" aria-hidden>
        Q
      </span>
      <input
        className="q-line-text"
        value={text}
        aria-label="Question"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {/* Only a job's own question offers Save to bank (one from the bank needs nothing). */}
      {!q.question_id && (
        <button
          type="button"
          className="cmq-tag cmq-tag-btn cmq-tag-grey"
          onClick={() => void act.post(`/job-questions/${q.id}/to-bank`, {}, 'Saved to the bank')}
        >
          Save to bank
        </button>
      )}
      <RemoveFromJob
        fromBank={!!q.question_id}
        what="question"
        onRemove={() =>
          act.del(`/job-questions/${q.id}`, q.question_id ? 'Removed from this job' : 'Deleted')
        }
      />
    </div>
  );
}
