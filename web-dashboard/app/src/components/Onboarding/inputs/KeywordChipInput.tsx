// KeywordChipInput.tsx -- type-and-Enter chip input.
//
// Used by StepProfile (target_roles primary) and StepPortals (positive /
// negative title filters). Backspace on an empty input removes the last
// chip; Enter or Tab adds the current value. Comma is also accepted as a
// terminator since users routinely paste comma-separated lists.

import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

interface Props {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** styling hint applied to chips (e.g. negative keywords) */
  variant?: 'default' | 'negative';
  ariaLabel?: string;
}

export function KeywordChipInput({
  values,
  onChange,
  placeholder = 'type and press enter',
  variant = 'default',
  ariaLabel,
}: Props) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (values.some((v) => v.toLowerCase() === trimmed.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...values, trimmed]);
    setDraft('');
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      e.preventDefault();
      onChange(values.slice(0, -1));
    } else if (e.key === 'Tab' && draft) {
      // Tab advances focus AFTER committing; without preventDefault the chip
      // gets committed but focus also moves, which is the desired behavior.
      commit(draft);
    }
  };

  return (
    <div
      className="onb-chiplist"
      role="list"
      aria-label={ariaLabel}
      onClick={() => inputRef.current?.focus()}
    >
      {values.map((v, i) => (
        <span
          key={`${v}-${i}`}
          className={
            variant === 'negative' ? 'onb-chip onb-chip--negative' : 'onb-chip'
          }
          role="listitem"
        >
          {v}
          <button
            type="button"
            className="onb-chip__close"
            aria-label={`remove ${v}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange(values.filter((_, j) => j !== i));
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        className="onb-chip-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => draft && commit(draft)}
        placeholder={values.length === 0 ? placeholder : ''}
      />
    </div>
  );
}
