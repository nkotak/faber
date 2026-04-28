// LocationScoringEditor.tsx -- fixed 5-row table mapping location type → 1..5.
//
// Click a number to set, or focus the row and press 1..5 from the keyboard.
// Defaults are loaded by the parent reducer; this component is fully
// controlled.

import type { LocationScores, LocationType } from '../../../lib/types';

interface Props {
  values: LocationScores;
  onChange: (key: LocationType, score: number) => void;
}

const ROWS: Array<{ key: LocationType; label: string; hint: string }> = [
  {
    key: 'remote_within_country',
    label: 'remote · within country',
    hint: 'fully remote and inside your jurisdiction',
  },
  {
    key: 'remote_outside_country',
    label: 'remote · outside country',
    hint: 'fully remote but cross-border (visa, comp, tax)',
  },
  {
    key: 'hybrid_within_metro',
    label: 'hybrid · same metro',
    hint: 'commuting distance, 2–3 days/week in office',
  },
  {
    key: 'onsite_within_metro',
    label: 'onsite · same metro',
    hint: '5 days/week in your current city',
  },
  {
    key: 'onsite_relocation',
    label: 'onsite · relocation',
    hint: 'requires moving to a new city',
  },
];

export function LocationScoringEditor({ values, onChange }: Props) {
  return (
    <div className="onb-loc-scoring" role="grid" aria-label="Location scoring">
      <div className="onb-loc-scoring__head" role="row">
        <span className="onb-loc-scoring__head-label">type</span>
        <span className="onb-loc-scoring__head-scores">score · 1..5</span>
      </div>
      {ROWS.map((row) => {
        const score = values[row.key];
        return (
          <div
            className="onb-loc-scoring__row"
            role="row"
            key={row.key}
            tabIndex={0}
            onKeyDown={(e) => {
              const n = Number(e.key);
              if (n >= 1 && n <= 5) {
                e.preventDefault();
                onChange(row.key, n);
              }
            }}
          >
            <div className="onb-loc-scoring__row-label">
              <div className="onb-loc-scoring__row-label-main">{row.label}</div>
              <div className="onb-loc-scoring__row-label-hint">{row.hint}</div>
            </div>
            <div className="onb-loc-scoring__row-scores">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  className={`onb-loc-scoring__btn${
                    n === score ? ' onb-loc-scoring__btn--active' : ''
                  }`}
                  onClick={() => onChange(row.key, n)}
                  aria-label={`${row.label} score ${n}`}
                  aria-pressed={n === score}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
