// A card's fields in one column: the ones with something in them, then Show more for the empty
// ones (to fill in). A field filled in moves up among the others. (The Job; Company details.)
import { Fragment, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface FilledField {
  key: string;
  filled: boolean;
  el: ReactNode;
}

export function FilledFirst({ fields }: { fields: FilledField[] }) {
  const [more, setMore] = useState(false);
  const empty = fields.filter((f) => !f.filled);
  return (
    <>
      <div className="kvs one-col">
        {fields
          .filter((f) => f.filled)
          .map((f) => (
            <Fragment key={f.key}>{f.el}</Fragment>
          ))}
        {more && empty.map((f) => <Fragment key={f.key}>{f.el}</Fragment>)}
      </div>
      {empty.length > 0 && (
        <button
          type="button"
          className="linkish more job-more"
          aria-expanded={more}
          onClick={() => setMore((m) => !m)}
        >
          <Icon name="chevDown" size={14} />
          {more ? 'Show less' : `Show more (${empty.length})`}
        </button>
      )}
    </>
  );
}
