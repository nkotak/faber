// Onboarding/lib/reducer.ts -- finite-state machine driving the modal.
//
// useReducer over useState because the step state has many partially-
// independent slices (cv, profile, profileMd, portals) that move through
// their own lifecycles. A single reducer keeps state transitions auditable
// and makes the localStorage hydration deterministic.

import type {
  Archetype,
  LocationScores,
  OnboardingStepId,
} from '../../../lib/types';
import type { Action, OnboardingState } from './types';

/** Canonical defaults for the location scoring table. */
export const DEFAULT_LOCATION_SCORES: LocationScores = {
  remote_within_country: 5,
  remote_outside_country: 4,
  hybrid_within_metro: 2,
  onsite_within_metro: 1,
  onsite_relocation: 1,
};

/** Empty archetype row used by the builder when the user adds a fresh entry. */
export const EMPTY_ARCHETYPE: Archetype = {
  name: '',
  axes: '',
  whatTheyBuy: '',
  fit: 'primary',
};

export const INITIAL_STATE: OnboardingState = {
  step: 'cv',
  status: null,
  profileSeed: null,
  cv: {
    phase: 'idle',
    parseJobId: null,
    progressLine: '',
    stagedBytes: 0,
    stagedContent: '',
    editedContent: null,
    previewMode: 'rendered',
    errorMessage: '',
    errorHint: '',
    pastedText: '',
  },
  profile: {},
  profileMd: {
    archetypes: [],
    locationScores: DEFAULT_LOCATION_SCORES,
    dealBreakers: [],
    exitStory: '',
    crossCuttingAdvantage: '',
  },
  portals: {
    useDefaults: true,
    positiveKeywords: [],
    negativeKeywords: [],
    companyOverrides: {},
    customCompanies: [],
  },
  escNoticeUntil: 0,
};

/** Map nextStep from server to the step the modal should land on. */
export function nextStepOrFirst(
  next: OnboardingStepId | null | undefined,
): OnboardingStepId {
  return next ?? 'cv';
}

export function reducer(state: OnboardingState, action: Action): OnboardingState {
  switch (action.type) {
    case 'SET_STATUS': {
      // First time we see status: pick the step the server tells us to.
      // Subsequent updates DON'T jump the step — we let the user finish what
      // they're working on, even if the server reports more files exist now.
      if (!state.status) {
        return {
          ...state,
          status: action.status,
          step: nextStepOrFirst(action.status.nextStep),
          profileSeed: action.status.profileSeed ?? state.profileSeed,
        };
      }
      return {
        ...state,
        status: action.status,
        profileSeed: action.status.profileSeed ?? state.profileSeed,
      };
    }
    case 'GO_TO_STEP':
      return { ...state, step: action.step };
    case 'SET_PROFILE_SEED':
      return { ...state, profileSeed: action.seed };

    // ------- CV -------
    case 'CV_UPLOADING':
      return {
        ...state,
        cv: { ...state.cv, phase: 'uploading', errorMessage: '', errorHint: '' },
      };
    case 'CV_PARSING':
      return {
        ...state,
        cv: {
          ...state.cv,
          phase: 'parsing',
          parseJobId: action.jobId,
          progressLine: 'queued',
        },
      };
    case 'CV_PROGRESS':
      return { ...state, cv: { ...state.cv, progressLine: action.line } };
    case 'CV_PREVIEW':
      return {
        ...state,
        cv: {
          ...state.cv,
          phase: 'preview',
          stagedContent: action.content,
          stagedBytes: action.bytes,
          editedContent: null,
        },
        profileSeed: action.seed ?? state.profileSeed,
      };
    case 'CV_PREVIEW_MODE':
      return { ...state, cv: { ...state.cv, previewMode: action.mode } };
    case 'CV_EDITED':
      return { ...state, cv: { ...state.cv, editedContent: action.edited } };
    case 'CV_PASTED':
      return { ...state, cv: { ...state.cv, pastedText: action.text } };
    case 'CV_RESET':
      return {
        ...state,
        cv: { ...INITIAL_STATE.cv, pastedText: state.cv.pastedText },
      };
    case 'CV_ERROR':
      return {
        ...state,
        cv: {
          ...state.cv,
          phase: 'error',
          errorMessage: action.message,
          errorHint: action.hint ?? '',
          parseJobId: null,
        },
      };
    case 'CV_COMMITTED':
      return { ...state, cv: { ...state.cv, phase: 'committed' } };

    // ------- Profile -------
    case 'PROFILE_PATCH':
      return {
        ...state,
        profile: deepMerge(
          state.profile as unknown as Record<string, unknown>,
          action.patch as unknown as Partial<Record<string, unknown>>,
        ) as typeof state.profile,
      };
    case 'PROFILE_HYDRATE':
      return { ...state, profile: action.draft };
    case 'PROFILE_COMMITTED':
      return { ...state, profile: { ...state.profile, committed: true } };

    // ------- ProfileMd -------
    case 'PROFILE_MD_PATCH':
      return { ...state, profileMd: { ...state.profileMd, ...action.patch } };
    case 'PROFILE_MD_HYDRATE':
      return { ...state, profileMd: action.draft };
    case 'PROFILE_MD_COMMITTED':
      return { ...state, profileMd: { ...state.profileMd, committed: true } };
    case 'PROFILE_MD_ARCHETYPES':
      return {
        ...state,
        profileMd: { ...state.profileMd, archetypes: action.archetypes },
      };
    case 'PROFILE_MD_LOCATION_SCORE':
      return {
        ...state,
        profileMd: {
          ...state.profileMd,
          locationScores: {
            ...state.profileMd.locationScores,
            [action.key]: action.score,
          },
        },
      };
    case 'PROFILE_MD_DEAL_BREAKERS':
      return {
        ...state,
        profileMd: { ...state.profileMd, dealBreakers: action.values },
      };

    // ------- Portals -------
    case 'PORTALS_PATCH':
      return { ...state, portals: { ...state.portals, ...action.patch } };
    case 'PORTALS_HYDRATE':
      return { ...state, portals: action.draft };
    case 'PORTALS_COMMITTED':
      return { ...state, portals: { ...state.portals, committed: true } };

    // ------- Esc notice -------
    case 'ESC_NOTICE':
      return { ...state, escNoticeUntil: Date.now() + 2000 };
  }
}

/** Shallow-deep merge for the Profile patch action. Keeps nested objects
 * intact when only a single field changes (e.g. patching candidate.email
 * without dropping candidate.full_name). */
function deepMerge<T extends Record<string, unknown>>(
  base: T,
  patch: Partial<T>,
): T {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) {
      out[k] = v;
    } else if (
      typeof v === 'object' &&
      !Array.isArray(v) &&
      typeof base[k as keyof T] === 'object' &&
      base[k as keyof T] !== null &&
      !Array.isArray(base[k as keyof T])
    ) {
      out[k] = deepMerge(
        base[k as keyof T] as Record<string, unknown>,
        v as Record<string, unknown>,
      );
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
