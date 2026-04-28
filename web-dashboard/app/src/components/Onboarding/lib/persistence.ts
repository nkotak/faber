// Onboarding/lib/persistence.ts -- localStorage save/restore per step.
//
// Each step's editable draft is persisted under a stable key so a refresh
// mid-flow doesn't lose work. Hydration is conditional: we only restore a
// saved draft when the server's `nextStep` matches the saved step. This
// prevents a stale step-3 archetype draft from coming back after the user
// nuked cv.md (which would put `nextStep` back at step 1).

import type {
  OnboardingStatus,
  OnboardingStepId,
  PortalsConfig,
  ProfileMdDraft,
} from '../../../lib/types';
import type {
  StepProfileDraft,
  StepProfileMdDraft,
  StepPortalsDraft,
} from './types';

const KEYS: Record<OnboardingStepId, string | null> = {
  cv: 'faber.onboarding.cv.draft',
  profile: 'faber.onboarding.profile.draft',
  profileMd: 'faber.onboarding.profileMd.draft',
  portals: 'faber.onboarding.portals.draft',
  ready: null,
};

function safeRead<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupted JSON or quota issue — silently drop the draft. Never crash
    // the modal because of bad localStorage data.
    return null;
  }
}

function safeWrite(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full / private browsing — drafts are nice-to-have, not load-bearing.
  }
}

function safeClear(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function loadProfileDraft(): StepProfileDraft | null {
  return safeRead<StepProfileDraft>(KEYS.profile!);
}

export function saveProfileDraft(draft: StepProfileDraft): void {
  // strip transient committed flag from disk so a half-restored draft
  // doesn't claim a successful commit.
  const { committed: _committed, ...persisted } = draft;
  void _committed;
  safeWrite(KEYS.profile!, persisted);
}

export function clearProfileDraft(): void {
  safeClear(KEYS.profile!);
}

export function loadProfileMdDraft(): StepProfileMdDraft | null {
  return safeRead<StepProfileMdDraft>(KEYS.profileMd!);
}

export function saveProfileMdDraft(draft: ProfileMdDraft): void {
  safeWrite(KEYS.profileMd!, draft);
}

export function clearProfileMdDraft(): void {
  safeClear(KEYS.profileMd!);
}

export function loadPortalsDraft(): StepPortalsDraft | null {
  return safeRead<StepPortalsDraft>(KEYS.portals!);
}

export function savePortalsDraft(draft: PortalsConfig): void {
  safeWrite(KEYS.portals!, draft);
}

export function clearPortalsDraft(): void {
  safeClear(KEYS.portals!);
}

/** CV draft persistence is intentionally limited to the pasted-text fallback;
 * the parse job lives on the server, so we don't need to persist the staged
 * markdown. */
export interface PersistedCvDraft {
  pastedText: string;
}

export function loadCvDraft(): PersistedCvDraft | null {
  return safeRead<PersistedCvDraft>(KEYS.cv!);
}

export function saveCvDraft(draft: PersistedCvDraft): void {
  safeWrite(KEYS.cv!, draft);
}

export function clearCvDraft(): void {
  safeClear(KEYS.cv!);
}

/**
 * Should we hydrate a saved draft for `step`? Only when the server says
 * we're actually on that step (or earlier — saved data from a future step
 * may be valid even if we're at an earlier one).
 */
export function shouldHydrate(
  step: OnboardingStepId,
  status: OnboardingStatus | null,
): boolean {
  if (!status) return false;
  if (status.setupComplete) return false;
  if (!status.nextStep) return false;
  // hydrate when the server's next step is at-or-after the draft's step
  // so we never restore step-3 work after the user reset earlier files.
  const order: OnboardingStepId[] = ['cv', 'profile', 'profileMd', 'portals', 'ready'];
  const draftIdx = order.indexOf(step);
  const nextIdx = order.indexOf(status.nextStep);
  return draftIdx >= 0 && nextIdx >= 0 && draftIdx <= nextIdx;
}

/** Wipe every persisted onboarding draft — called on full setup completion. */
export function clearAllDrafts(): void {
  clearCvDraft();
  clearProfileDraft();
  clearProfileMdDraft();
  clearPortalsDraft();
}
