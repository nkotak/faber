// OnboardingNav.tsx -- bottom-of-modal nav row with Back / Next / hint.
//
// The nav is dumb: parent owns disabled state and labels. It only renders
// what the OnboardingModal tells it. The primary "Next" button takes the
// rare phosphor accent — the only place phosphor lives in the modal apart
// from the active progress dot and the focus ring.

interface Props {
  /** rendered as the first hint string on the left ("⌘← back · ⌘→ next" etc.) */
  hint?: string;
  onBack?: () => void;
  onNext?: () => void;
  backLabel?: string;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  /** if provided, shows a third ghost button (e.g. "skip optional"). */
  optional?: { label: string; onClick: () => void } | null;
  /** if true, the next button is hidden (used on StepReady which has its own primary). */
  hideNext?: boolean;
}

export function OnboardingNav({
  hint,
  onBack,
  onNext,
  backLabel = 'back',
  nextLabel = 'next',
  nextDisabled,
  nextLoading,
  optional,
  hideNext,
}: Props) {
  return (
    <nav className="onb-nav" aria-label="Onboarding step navigation">
      <span className="onb-nav__hint">{hint ?? ' '}</span>
      <div className="onb-nav__actions">
        {optional ? (
          <button
            type="button"
            className="onb-btn onb-btn--ghost"
            onClick={optional.onClick}
          >
            {optional.label}
          </button>
        ) : null}
        {onBack ? (
          <button type="button" className="onb-btn" onClick={onBack}>
            {backLabel}
          </button>
        ) : null}
        {!hideNext && onNext ? (
          <button
            type="button"
            className="onb-btn onb-btn--primary"
            onClick={onNext}
            disabled={nextDisabled || nextLoading}
            aria-busy={nextLoading || undefined}
          >
            {nextLoading ? 'working…' : nextLabel}
          </button>
        ) : null}
      </div>
    </nav>
  );
}
