// OnboardingProgress.tsx -- the 5-marker terminal-rule for the modal foot.
//
// NOT a progress bar. A terse five-cell grid: each cell shows a dot + label
// + numeric "n/5". Only completed and the current step are clickable; we
// never let the user jump ahead to a step they haven't satisfied yet.

import type { OnboardingStepId } from '../../lib/types';
import './OnboardingProgress.css';

export interface OnboardingStepDefinition {
  id: OnboardingStepId;
  label: string;
  /** index 1..N */
  index: number;
}

export const STEP_DEFINITIONS: OnboardingStepDefinition[] = [
  { id: 'cv', label: 'CV', index: 1 },
  { id: 'profile', label: 'Profile', index: 2 },
  { id: 'profileMd', label: 'Targeting', index: 3 },
  { id: 'portals', label: 'Portals', index: 4 },
  { id: 'ready', label: 'Ready', index: 5 },
];

interface Props {
  current: OnboardingStepId;
  completed: ReadonlySet<OnboardingStepId>;
  onNavigate: (step: OnboardingStepId) => void;
}

export function OnboardingProgress({ current, completed, onNavigate }: Props) {
  const total = STEP_DEFINITIONS.length;
  return (
    <ol className="onb-progress" aria-label="Onboarding progress">
      {STEP_DEFINITIONS.map((step) => {
        const isActive = step.id === current;
        const isDone = completed.has(step.id) && !isActive;
        const isReachable = isDone || isActive;
        const dotClass = isActive
          ? 'onb-progress__dot--active'
          : isDone
            ? 'onb-progress__dot--done'
            : 'onb-progress__dot--pending';
        const stepClass = [
          'onb-progress__step',
          isActive && 'onb-progress__step--active',
          isDone && 'onb-progress__step--done',
          isReachable && !isActive && 'onb-progress__step--clickable',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <li key={step.id}>
            <button
              type="button"
              className={stepClass}
              aria-current={isActive ? 'step' : undefined}
              disabled={!isReachable}
              onClick={() => isReachable && !isActive && onNavigate(step.id)}
              tabIndex={isReachable ? 0 : -1}
            >
              <span className="onb-progress__head">
                <span
                  className={`onb-progress__dot ${dotClass}`}
                  aria-hidden="true"
                />
                <span className="onb-progress__index">
                  {step.index}/{total}
                </span>
              </span>
              <span className="onb-progress__label">{step.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
