// OnboardingModal.tsx -- the modal shell that owns the reducer + step swap.
//
// Why useReducer over useState: each step has multiple slices (parse-job
// id, progress line, edited content, mode toggle, error state) and they
// transition together. A single reducer keeps each transition auditable
// and means the localStorage hydration code (which lives in persistence.ts)
// has one shape to validate against rather than five.
//
// Focus management: two zero-content sentinel divs at the top and bottom
// of the modal trap Tab/Shift+Tab. When focus tries to leave, we route it
// to the opposite end. This mirrors the pattern in StatusPicker.tsx
// (rootRef + autoFocus on the dialog) but extends it for a multi-step
// experience where the user moves between many fields.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import type { OnboardingStatus, OnboardingStepId } from '../../lib/types';
import { api } from '../../lib/api';
import { OnboardingProgress, STEP_DEFINITIONS } from './OnboardingProgress';
import { OnboardingNav } from './OnboardingNav';
import { StepCV } from './steps/StepCV';
import { StepProfile } from './steps/StepProfile';
import { StepProfileMd } from './steps/StepProfileMd';
import { StepPortals } from './steps/StepPortals';
import { StepReady } from './steps/StepReady';
import { reducer, INITIAL_STATE } from './lib/reducer';
import {
  loadProfileDraft,
  loadProfileMdDraft,
  loadPortalsDraft,
  loadCvDraft,
  saveCvDraft,
  shouldHydrate,
  clearAllDrafts,
} from './lib/persistence';
import type { OnboardingState } from './lib/types';
import './OnboardingModal.css';
import './OnboardingForms.css';

interface Props {
  status: OnboardingStatus;
  onComplete: () => void;
}

export function OnboardingModal({ status, onComplete }: Props) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [stepValidity, setStepValidity] = useState<
    Record<OnboardingStepId, boolean>
  >({
    cv: false,
    profile: false,
    profileMd: false,
    portals: true,
    ready: true,
  });
  const modalRef = useRef<HTMLDivElement | null>(null);
  const escNoticeTimerRef = useRef<number | null>(null);
  const [escNoticeVisible, setEscNoticeVisible] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const qc = useQueryClient();

  // Skip onboarding: stub every required user-layer file so the dashboard
  // boots immediately and the user edits via Settings later.
  const onSkip = useCallback(async () => {
    if (isSkipping) return;
    if (
      !window.confirm(
        'Skip onboarding? This will create starter files for cv.md, profile.yml, modes/_profile.md, and portals.yml. You can edit them anytime via Settings (Cmd+,).',
      )
    ) {
      return;
    }
    setIsSkipping(true);
    try {
      await api.skipOnboarding();
      clearAllDrafts();
      qc.invalidateQueries({ queryKey: ['onboarding', 'status'] });
      onComplete();
    } catch (err) {
      // Surface in the UI rather than silently failing.
      window.alert(
        `Skip failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      setIsSkipping(false);
    }
  }, [isSkipping, qc, onComplete]);

  // Seed reducer from server status + restore localStorage drafts when
  // the server confirms we're at the right step. shouldHydrate() prevents
  // restoring a stale step-3 archetype draft after the user nuked cv.md.
  useEffect(() => {
    dispatch({ type: 'SET_STATUS', status });
    const cvDraft = loadCvDraft();
    if (cvDraft && shouldHydrate('cv', status)) {
      dispatch({ type: 'CV_PASTED', text: cvDraft.pastedText });
    }
    const profileDraft = loadProfileDraft();
    if (profileDraft && shouldHydrate('profile', status)) {
      dispatch({ type: 'PROFILE_HYDRATE', draft: profileDraft });
    }
    const profileMdDraft = loadProfileMdDraft();
    if (profileMdDraft && shouldHydrate('profileMd', status)) {
      dispatch({ type: 'PROFILE_MD_HYDRATE', draft: profileMdDraft });
    }
    const portalsDraft = loadPortalsDraft();
    if (portalsDraft && shouldHydrate('portals', status)) {
      dispatch({ type: 'PORTALS_HYDRATE', draft: portalsDraft });
    }
  }, [status]);

  // Persist CV pasted-text draft.
  useEffect(() => {
    saveCvDraft({ pastedText: state.cv.pastedText });
  }, [state.cv.pastedText]);

  // Polling fallback: in case the SSE stream ever drops while the modal
  // is open, tick a 5s interval to re-fetch /status. Most movement comes
  // from the file watcher, but this keeps the gate honest.
  useQuery({
    queryKey: ['onboarding', 'status', 'tick'],
    queryFn: api.onboardingStatus,
    refetchInterval: 5000,
    enabled: !status.setupComplete,
  });

  // ---- View-transition-wrapped step swap ---------------------------------
  const goTo = useCallback((step: OnboardingStepId) => {
    const doc = document as unknown as {
      startViewTransition?: (cb: () => void) => unknown;
    };
    if (
      doc.startViewTransition &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      doc.startViewTransition(() => dispatch({ type: 'GO_TO_STEP', step }));
    } else {
      dispatch({ type: 'GO_TO_STEP', step });
    }
  }, []);

  // ---- Step lifecycle helpers --------------------------------------------
  const stepOrder: OnboardingStepId[] = useMemo(
    () => STEP_DEFINITIONS.map((s) => s.id),
    [],
  );

  const currentIndex = stepOrder.indexOf(state.step);
  const prevStep = currentIndex > 0 ? stepOrder[currentIndex - 1] : null;
  const nextStep =
    currentIndex >= 0 && currentIndex < stepOrder.length - 1
      ? stepOrder[currentIndex + 1]
      : null;

  const completed = useMemo(() => {
    const set = new Set<OnboardingStepId>();
    if (state.cv.phase === 'committed') set.add('cv');
    if (state.profile.committed) set.add('profile');
    if (state.profileMd.committed) set.add('profileMd');
    if (state.portals.committed) set.add('portals');
    return set;
  }, [
    state.cv.phase,
    state.profile.committed,
    state.profileMd.committed,
    state.portals.committed,
  ]);

  // Submit the current step. Each step listens for the custom event and
  // runs its own mutation; we don't centralize the writes here because
  // each step's payload shape and validation are different.
  const submitCurrent = useCallback(() => {
    document.dispatchEvent(new CustomEvent('onboarding:submit-current-step'));
  }, []);

  const advance = useCallback(() => {
    if (state.step === 'cv') {
      // CV step is a special case — its commit happens via the in-step
      // button, not the nav. Once committed we just move on.
      if (state.cv.phase === 'committed' && nextStep) goTo(nextStep);
      return;
    }
    if (state.step === 'ready') {
      onComplete();
      return;
    }
    submitCurrent();
  }, [state.step, state.cv.phase, nextStep, goTo, submitCurrent, onComplete]);

  // After each successful commit (signaled by reducer state changes),
  // refetch status so the gate's authoritative next-step calculation
  // catches up. The advance happens here because the StepX components
  // call onCommitted() which we wire to a step-specific callback below.
  const onStepCommitted = useCallback(
    (afterStep: OnboardingStepId) => {
      qc.invalidateQueries({ queryKey: ['onboarding', 'status'] });
      // pick the step right after the one that just committed
      const idx = stepOrder.indexOf(afterStep);
      const next = idx >= 0 && idx < stepOrder.length - 1 ? stepOrder[idx + 1] : null;
      if (next) goTo(next);
    },
    [qc, stepOrder, goTo],
  );

  const setStepValid = useCallback(
    (step: OnboardingStepId, valid: boolean) => {
      setStepValidity((s) => (s[step] === valid ? s : { ...s, [step]: valid }));
    },
    [],
  );

  // ---- Esc notice (non-dismissable) -------------------------------------
  const showEscNotice = useCallback(() => {
    setEscNoticeVisible(true);
    if (escNoticeTimerRef.current) {
      window.clearTimeout(escNoticeTimerRef.current);
    }
    escNoticeTimerRef.current = window.setTimeout(() => {
      setEscNoticeVisible(false);
    }, 2000);
  }, []);

  // ---- Modal-scoped keyboard --------------------------------------------
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Stop global shortcuts from firing while the modal is mounted (the
      // global handler already returns early via setOnboardingActive, but
      // this is belt-and-braces for any non-registry listeners).
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === 'Escape') {
        showEscNotice();
        stop();
        return;
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        advance();
        stop();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowRight') {
        if (canGoNext()) advance();
        stop();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowLeft') {
        if (prevStep) goTo(prevStep);
        stop();
        return;
      }
      if (
        e.key.toLowerCase() === 'a' &&
        e.shiftKey &&
        (e.metaKey || e.ctrlKey)
      ) {
        if (state.step === 'profileMd') {
          document.dispatchEvent(new CustomEvent('onboarding:add-archetype'));
          stop();
        }
        return;
      }
      // 1..5 jump (only to completed/current steps)
      const n = Number(e.key);
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (n >= 1 && n <= 5 && !inField) {
        const candidate = stepOrder[n - 1];
        if (candidate && (completed.has(candidate) || candidate === state.step)) {
          goTo(candidate);
          stop();
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.step, prevStep, advance, completed, goTo, showEscNotice],
  );

  function canGoNext(): boolean {
    if (state.step === 'cv') return state.cv.phase === 'committed';
    return stepValidity[state.step] === true;
  }

  // ---- Focus trap --------------------------------------------------------
  useEffect(() => {
    queueMicrotask(() => {
      // Move focus inside the modal on first mount so screen readers and
      // keyboard users start where they should.
      modalRef.current?.focus();
    });
  }, []);

  // Whenever the step changes, refocus the body so the title is in the
  // accessibility tree's reading order.
  useEffect(() => {
    queueMicrotask(() => modalRef.current?.focus());
  }, [state.step]);

  const onSentinelTopFocus = () => {
    // shift-tab from the first field hit the top sentinel; jump to last focusable
    const focusables = modalRef.current?.querySelectorAll<HTMLElement>(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"])',
    );
    const last = focusables ? focusables[focusables.length - 1] : null;
    last?.focus();
  };
  const onSentinelBottomFocus = () => {
    const focusables = modalRef.current?.querySelectorAll<HTMLElement>(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables ? focusables[0] : null;
    first?.focus();
  };

  // ---- Render ------------------------------------------------------------
  const stepDef = STEP_DEFINITIONS.find((s) => s.id === state.step)!;
  const titleId = `onb-title-${stepDef.id}`;

  return (
    <div className="onb-backdrop" role="presentation">
      <div tabIndex={0} onFocus={onSentinelTopFocus} aria-hidden="true" />
      <div
        ref={modalRef}
        className="onb-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="onb-modal__head">
          <div className="onb-modal__brand">
            <span className="onb-modal__wordmark">faber</span>
            <span className="onb-modal__rule" aria-hidden />
            <span className="onb-modal__brand-label">first run</span>
          </div>
          <div className="onb-modal__head-right">
            <button
              type="button"
              className="onb-modal__skip"
              onClick={onSkip}
              disabled={isSkipping}
              title="Skip onboarding · stub all files with defaults"
            >
              {isSkipping ? 'skipping…' : 'skip'}
            </button>
            <span className="onb-modal__step-counter">
              step {stepDef.index} · of 5
            </span>
          </div>
        </header>

        <OnboardingProgress
          current={state.step}
          completed={completed}
          onNavigate={(step) => {
            if (completed.has(step) || step === state.step) goTo(step);
          }}
        />

        <div className="onb-modal__body">
          <h2 id={titleId} className="onb-modal__step-title">
            {titleFor(state.step)}
          </h2>
          <p className="onb-modal__step-subtitle">{subtitleFor(state.step)}</p>
          <ActiveStep
            state={state}
            dispatch={dispatch}
            onCommitted={onStepCommitted}
            onValidityChange={setStepValid}
            onComplete={onComplete}
          />
        </div>

        <div className="onb-modal__foot">
          <OnboardingNav
            hint={navHint(state.step, completed)}
            onBack={prevStep ? () => goTo(prevStep) : undefined}
            onNext={advance}
            nextLabel={nextLabel(state, canGoNext())}
            nextDisabled={!canGoNext()}
            hideNext={state.step === 'ready'}
          />
        </div>

        <div
          className={`onb-modal__esc-notice${
            escNoticeVisible ? ' onb-modal__esc-notice--visible' : ''
          }`}
          role="status"
          aria-live="polite"
        >
          # cant exit · setup must complete
        </div>
      </div>
      <div tabIndex={0} onFocus={onSentinelBottomFocus} aria-hidden="true" />
    </div>
  );
}

function ActiveStep({
  state,
  dispatch,
  onCommitted,
  onValidityChange,
  onComplete,
}: {
  state: OnboardingState;
  dispatch: React.Dispatch<Parameters<typeof reducer>[1]>;
  onCommitted: (afterStep: OnboardingStepId) => void;
  onValidityChange: (step: OnboardingStepId, valid: boolean) => void;
  onComplete: () => void;
}) {
  switch (state.step) {
    case 'cv':
      return (
        <StepCV
          state={state}
          dispatch={dispatch}
          onCommitted={() => {
            // CV phase=committed is the trigger to move forward; we don't
            // auto-advance because the user may want to review, so the nav
            // button handles the actual transition. But we DO refetch the
            // status so the next-step calculation re-runs.
            onCommitted('cv');
          }}
        />
      );
    case 'profile':
      return (
        <StepProfile
          state={state}
          dispatch={dispatch}
          onCommitted={() => onCommitted('profile')}
          onValidityChange={(v) => onValidityChange('profile', v)}
        />
      );
    case 'profileMd':
      return (
        <StepProfileMd
          state={state}
          dispatch={dispatch}
          onCommitted={() => onCommitted('profileMd')}
          onValidityChange={(v) => onValidityChange('profileMd', v)}
        />
      );
    case 'portals':
      return (
        <StepPortals
          state={state}
          dispatch={dispatch}
          onCommitted={() => onCommitted('portals')}
          onValidityChange={(v) => onValidityChange('portals', v)}
        />
      );
    case 'ready':
      return (
        <StepReady
          status={state.status}
          initTrackerNeeded={state.status?.optionalSteps.initTracker ?? true}
          onComplete={() => {
            clearAllDrafts();
            onComplete();
          }}
        />
      );
  }
}

function titleFor(step: OnboardingStepId): string {
  switch (step) {
    case 'cv':
      return 'import your résumé';
    case 'profile':
      return 'profile';
    case 'profileMd':
      return 'targeting';
    case 'portals':
      return 'portals';
    case 'ready':
      return 'setup complete';
  }
}

function subtitleFor(step: OnboardingStepId): string {
  switch (step) {
    case 'cv':
      return 'drop a pdf, docx, or paste plain text. the system extracts the canonical shape and lets you review before writing cv.md.';
    case 'profile':
      return 'this becomes config/profile.yml — the source of truth used by every mode for personalization.';
    case 'profileMd':
      return 'archetypes you target, how location ranks, and a narrative the system uses when framing applications.';
    case 'portals':
      return 'choose the defaults or tune the keyword filter and tracked companies for the scanner.';
    case 'ready':
      return 'the dashboard is waiting behind this modal. close it and start working.';
  }
}

function nextLabel(state: OnboardingState, canGo: boolean): string {
  if (state.step === 'cv') {
    return state.cv.phase === 'committed' ? 'next →' : 'commit cv first';
  }
  if (state.step === 'ready') return 'open dashboard →';
  return canGo ? 'next →' : 'fill required';
}

function navHint(
  step: OnboardingStepId,
  completed: ReadonlySet<OnboardingStepId>,
): string {
  if (step === 'ready') return '# done · open the dashboard';
  if (step === 'cv' && !completed.has('cv'))
    return '# upload a file or paste text';
  return '# tab to navigate · ⌘← back · ⌘→ next';
}
