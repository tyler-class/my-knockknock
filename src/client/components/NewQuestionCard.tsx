// A new question, written in a small card: its words, Add and Cancel. For a job it can also be
// kept in the bank (to reuse on other jobs); for the bank it simply goes there.
import { useState } from 'react';
import { Icon } from './Icon';
import { cx } from './ui';

export function NewQuestionCard({
  bankChoice,
  onAdd,
  onCancel,
}: {
  /** Offer "Save to the bank too" (a job's own question). */
  bankChoice?: boolean;
  onAdd: (text: string, toBank: boolean) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [toBank, setToBank] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const ok = await onAdd(text.trim(), toBank);
    setBusy(false);
    if (ok) {
      setText('');
      setToBank(false);
    }
  };
  return (
    <div className="card q-new">
      <input
        className="in"
        autoFocus
        value={text}
        placeholder="The question"
        aria-label="The question"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void add();
          } else if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="q-new-acts">
        {bankChoice && (
          <button
            type="button"
            role="checkbox"
            aria-checked={toBank}
            className={cx('check-opt', toBank && 'on')}
            onClick={() => setToBank((v) => !v)}
          >
            <span className="check-box" aria-hidden="true">
              {toBank && <Icon name="check" size={13} />}
            </span>
            Save to the bank too
          </button>
        )}
        <span className="q-new-btns">
          <button type="button" className="btn sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn sm primary"
            disabled={!text.trim() || busy}
            onClick={() => void add()}
          >
            Add
          </button>
        </span>
      </div>
    </div>
  );
}
