// ArchetypeBuilder.tsx -- repeatable rows of {name, axes, whatTheyBuy, fit}.
//
// Two modes:
//
//   - 'rich' (default): four-column form (name, axes, whatTheyBuy, fit).
//     Used by onboarding StepProfileMd and Settings PaneProfileMd which
//     persist to modes/_profile.md.
//
//   - 'slim': three-column form (name, level, fit). Used by Settings
//     PaneProfile which persists to config/profile.yml. The Archetype
//     interface has an optional `level` field for this purpose; axes /
//     whatTheyBuy stay empty in this mode and are ignored by the save
//     transformer.
//
// Each row is a small form. Suggestions from the CV parse render as
// ghost rows the user can adopt with a single keystroke (Enter while
// focused, or click the "adopt" button). Mod+Shift+A adds a fresh blank
// row from anywhere in the modal — the modal binds that hotkey.

import { useId } from 'react';
import type { Archetype } from '../../../lib/types';
import { EMPTY_ARCHETYPE } from '../lib/reducer';

interface Props {
  values: Archetype[];
  onChange: (next: Archetype[]) => void;
  /** ghost rows from the CV parse — adoptable, not editable in place */
  suggestions?: Archetype[];
  /** rendering mode; 'rich' (default) or 'slim' for profile.yml */
  mode?: 'rich' | 'slim';
}

const FITS: Array<Archetype['fit']> = ['primary', 'secondary', 'adjacent'];

export function ArchetypeBuilder({ values, onChange, suggestions, mode = 'rich' }: Props) {
  const update = (i: number, patch: Partial<Archetype>) => {
    onChange(values.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  };
  const remove = (i: number) => onChange(values.filter((_, j) => j !== i));
  const add = () => onChange([...values, { ...EMPTY_ARCHETYPE }]);

  // Filter suggestions: hide any whose name already exists in `values`.
  const remainingSuggestions = (suggestions ?? []).filter(
    (s) =>
      s.name.trim() &&
      !values.some((v) => v.name.toLowerCase().trim() === s.name.toLowerCase().trim()),
  );

  const isSlim = mode === 'slim';

  return (
    <div className={`onb-arch${isSlim ? ' onb-arch--slim' : ''}`}>
      <div className="onb-arch__header">
        <span className="onb-arch__col-label" aria-hidden>
          archetype
        </span>
        {isSlim ? (
          <span className="onb-arch__col-label" aria-hidden>
            level
          </span>
        ) : (
          <>
            <span className="onb-arch__col-label" aria-hidden>
              axes
            </span>
            <span className="onb-arch__col-label" aria-hidden>
              what they buy
            </span>
          </>
        )}
        <span className="onb-arch__col-label" aria-hidden>
          fit
        </span>
        <span aria-hidden />
      </div>
      <ul className="onb-arch__list">
        {values.map((row, i) => (
          <ArchetypeRow
            key={i}
            row={row}
            onPatch={(p) => update(i, p)}
            onRemove={() => remove(i)}
            mode={mode}
          />
        ))}
        {remainingSuggestions.map((s, i) => (
          <li
            className={`onb-arch__row onb-arch__row--ghost${
              isSlim ? ' onb-arch__row--slim' : ''
            }`}
            key={`s-${i}`}
          >
            <span className="onb-arch__ghost-name">{s.name}</span>
            {isSlim ? (
              <span className="onb-arch__ghost-axes">{s.level ?? ''}</span>
            ) : (
              <>
                <span className="onb-arch__ghost-axes">{s.axes}</span>
                <span className="onb-arch__ghost-buy">{s.whatTheyBuy}</span>
              </>
            )}
            <span className="onb-arch__ghost-fit mono">{s.fit}</span>
            <button
              type="button"
              className="onb-btn onb-btn--ghost onb-arch__adopt"
              onClick={() => onChange([...values, { ...s }])}
              aria-label={`adopt suggested archetype ${s.name}`}
            >
              adopt ↵
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="onb-btn onb-arch__add" onClick={add}>
        + add archetype
      </button>
    </div>
  );
}

function ArchetypeRow({
  row,
  onPatch,
  onRemove,
  mode,
}: {
  row: Archetype;
  onPatch: (patch: Partial<Archetype>) => void;
  onRemove: () => void;
  mode: 'rich' | 'slim';
}) {
  const id = useId();
  const isSlim = mode === 'slim';
  return (
    <li className={`onb-arch__row${isSlim ? ' onb-arch__row--slim' : ''}`}>
      <input
        id={`${id}-name`}
        className="onb-input"
        placeholder="AI Platform Engineer"
        value={row.name}
        onChange={(e) => onPatch({ name: e.target.value })}
        aria-label="archetype name"
      />
      {isSlim ? (
        <input
          className="onb-input"
          placeholder="Senior, Staff, Principal"
          value={row.level ?? ''}
          onChange={(e) => onPatch({ level: e.target.value })}
          aria-label="archetype level"
        />
      ) : (
        <>
          <input
            className="onb-input"
            placeholder="Evaluation, observability"
            value={row.axes}
            onChange={(e) => onPatch({ axes: e.target.value })}
            aria-label="archetype axes"
          />
          <input
            className="onb-input"
            placeholder="Someone who puts AI in production"
            value={row.whatTheyBuy}
            onChange={(e) => onPatch({ whatTheyBuy: e.target.value })}
            aria-label="what they buy"
          />
        </>
      )}
      <select
        className="onb-select"
        value={row.fit}
        onChange={(e) => onPatch({ fit: e.target.value as Archetype['fit'] })}
        aria-label="fit category"
      >
        {FITS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="onb-chip__close"
        aria-label="remove archetype"
        onClick={onRemove}
      >
        ×
      </button>
    </li>
  );
}
