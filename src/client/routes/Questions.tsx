// Questions: the bank of questions to ask in interviews, reused across jobs and meetings (like
// stories). Add one, change its words in place, see how many jobs use it, or take it out.
import { useState } from 'react';
import type { Question } from '@shared/types';
import { useActions, useData } from '../lib/queries';
import { Icon } from '../components/Icon';
import { PageHeader, AutoTextarea } from '../components/ui';
import { PrepareTabs } from '../components/PrepareTabs';
import { NewQuestionCard } from '../components/NewQuestionCard';
import './callmode.css';
import { SearchBox } from './Directory';

export function Questions() {
  const data = useData();
  const act = useActions();
  const [q, setQ] = useState('');
  const [writing, setWriting] = useState(false);
  if (!data) return null;
  const ql = q.trim().toLowerCase();
  const list = data.state.questions
    .filter((x) => !x.archived)
    .filter((x) => !ql || x.text.toLowerCase().includes(ql));
  const uses = (id: string) => data.state.job_questions.filter((j) => j.question_id === id).length;
  return (
    <>
      <PageHeader
        title="Questions"
        icon="question"
        action={
          <button type="button" className="btn primary" onClick={() => setWriting(true)}>
            <Icon name="plus" size={18} /> New question
          </button>
        }
      />
      <PrepareTabs />
      {writing && (
        <NewQuestionCard
          onAdd={(text) => act.post('/questions', { text })}
          onCancel={() => setWriting(false)}
        />
      )}
      {data.state.questions.length > 0 && (
        <SearchBox q={q} setQ={setQ} placeholder="Search questions" />
      )}
      {/* One card, a row per question (like Stories). */}
      <div className="card list story-rows">
        {list.map((x) => (
          <BankRow key={x.id} q={x} uses={uses(x.id)} />
        ))}
        {!list.length && <p className="empty">{ql ? 'Nothing matches.' : 'No questions yet.'}</p>}
      </div>
    </>
  );
}

/** One bank question, as a card like Call Mode's: its words (edited in place), how many jobs
 * use it, and Delete. */
function BankRow({ q, uses }: { q: Question; uses: number }) {
  const act = useActions();
  const [text, setText] = useState(q.text);
  const [arm, setArm] = useState(false);
  const save = () => {
    const t = text.trim();
    if (!t) return setText(q.text);
    if (t !== q.text) void act.patch(`/questions/${q.id}`, { text: t });
  };
  return (
    <div className="story-line q-line">
      <span className="cmq-qmark" aria-hidden>
        Q
      </span>
      {/* Long questions wrap onto more lines; Enter saves (no line breaks in a question). */}
      <AutoTextarea
        className="q-line-text"
        rows={1}
        value={text}
        aria-label="Question"
        onChange={(e) => setText(e.target.value.replace(/\n/g, ' '))}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
      {uses > 0 && (
        <span className="story-row-meta">
          {uses} {uses === 1 ? 'job' : 'jobs'}
        </span>
      )}
      {/* Two taps: the first asks, the second deletes. */}
      {arm ? (
        <button
          type="button"
          className="cmq-tag cmq-tag-btn cmq-del"
          onClick={() => void act.del(`/questions/${q.id}`, 'Deleted from the bank')}
          onBlur={() => setArm(false)}
          autoFocus
        >
          Delete?
        </button>
      ) : (
        <button
          type="button"
          className="cmq-rm"
          aria-label="Delete from the bank"
          onClick={() => setArm(true)}
        >
          <Icon name="trash" size={14} />
        </button>
      )}
    </div>
  );
}
