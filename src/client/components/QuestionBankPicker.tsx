// Pick questions from the bank (for a job, or one meeting): search, tap to add. Those already
// there aren't offered.
import { useState } from 'react';
import type { Question } from '@shared/types';
import { useData } from '../lib/queries';
import { Icon } from './Icon';
import { Sheet } from './ui';

export function QuestionBankPicker({
  taken,
  onPick,
  onClose,
}: {
  /** Bank questions already there (by id). */
  taken: Set<string>;
  onPick: (q: Question) => void | Promise<unknown>;
  onClose: () => void;
}) {
  const data = useData();
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const list = (data?.state.questions ?? [])
    .filter((x) => !x.archived && !taken.has(x.id))
    .filter((x) => !ql || x.text.toLowerCase().includes(ql));
  return (
    <Sheet title="Add From the Bank" icon="question" onClose={onClose}>
      <label className="search-in search-full">
        <Icon name="search" size={16} />
        <input
          autoFocus
          value={q}
          placeholder="Search questions"
          aria-label="Search questions"
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <div className="pick-list" role="listbox" aria-label="Questions">
        {list.map((x) => (
          <button
            key={x.id}
            type="button"
            role="option"
            aria-selected={false}
            className="person"
            onClick={() => void onPick(x)}
          >
            <span className="avatar">
              <Icon name="question" size={15} />
            </span>
            <span className="row-text">
              <strong>{x.text}</strong>
            </span>
          </button>
        ))}
        {!list.length && (
          <p className="sub">{ql ? 'Nothing matches.' : 'Every bank question is already here.'}</p>
        )}
      </div>
    </Sheet>
  );
}
