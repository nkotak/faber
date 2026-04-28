// DealBreakersList.tsx -- repeatable bullet rows for "things you won't accept".
//
// Each row is its own input so the user can edit a deal-breaker without
// losing the surrounding rows. Enter on the last empty row commits it and
// moves focus to a fresh empty row.

import { useRef, useState } from 'react';

interface Props {
  values: string[];
  onChange: (next: string[]) => void;
}

export function DealBreakersList({ values, onChange }: Props) {
  const [draft, setDraft] = useState('');
  const newRowRef = useRef<HTMLInputElement | null>(null);

  const addRow = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...values, trimmed]);
    setDraft('');
    queueMicrotask(() => newRowRef.current?.focus());
  };

  return (
    <div className="onb-deal-breakers">
      <ul className="onb-deal-breakers__list">
        {values.map((v, i) => (
          <li className="onb-deal-breakers__row" key={i}>
            <span className="onb-deal-breakers__bullet" aria-hidden>
              ·
            </span>
            <input
              type="text"
              className="onb-input onb-deal-breakers__input"
              value={v}
              onChange={(e) =>
                onChange(values.map((x, j) => (j === i ? e.target.value : x)))
              }
              onBlur={(e) => {
                const trimmed = e.target.value.trim();
                if (!trimmed) {
                  onChange(values.filter((_, j) => j !== i));
                }
              }}
            />
            <button
              type="button"
              className="onb-chip__close"
              aria-label={`remove ${v}`}
              onClick={() => onChange(values.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </li>
        ))}
        <li className="onb-deal-breakers__row">
          <span className="onb-deal-breakers__bullet" aria-hidden>
            +
          </span>
          <input
            type="text"
            ref={newRowRef}
            className="onb-input onb-deal-breakers__input"
            placeholder="add another"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addRow();
              }
            }}
            onBlur={addRow}
          />
        </li>
      </ul>
    </div>
  );
}
