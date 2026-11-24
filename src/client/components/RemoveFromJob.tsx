// The small ✕ on a job's story or question. One from the bank: off this job (the bank keeps
// it), at once. One only on this job: deleted, after a second tap ("Delete?").
import { useState } from 'react';
import { Icon } from './Icon';

export function RemoveFromJob({
  fromBank,
  what,
  onRemove,
}: {
  /** It came from the bank (Stories or Questions), so it stays there. */
  fromBank: boolean;
  /** "story" or "question", for its label. */
  what: string;
  onRemove: () => unknown;
}) {
  const [arm, setArm] = useState(false);
  if (arm)
    return (
      <button
        type="button"
        className="rm-job armed"
        autoFocus
        onClick={() => void onRemove()}
        onBlur={() => setArm(false)}
      >
        Delete?
      </button>
    );
  return (
    <button
      type="button"
      className="rm-job"
      aria-label={fromBank ? `Remove this ${what} from the job` : `Delete this ${what}`}
      title={fromBank ? 'Remove from this job (the bank keeps it)' : `Delete this ${what}`}
      onClick={() => (fromBank ? void onRemove() : setArm(true))}
    >
      <Icon name="x" size={12} />
    </button>
  );
}
