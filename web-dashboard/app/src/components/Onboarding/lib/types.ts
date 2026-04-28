// Onboarding/lib/types.ts -- internal reducer state and form draft shapes.
//
// These shapes live next to the reducer because they're implementation
// details of the modal. Cross-component types (server payloads, status
// shape) live in the global lib/types.ts.

import type {
  Archetype,
  LocationScores,
  OnboardingStatus,
  OnboardingStepId,
  PortalsConfig,
  ProfileMdDraft,
  ProfileSeed,
  ProfileYaml,
} from '../../../lib/types';

/** State machine for the StepCV import lifecycle. */
export type StepCvPhase =
  | 'idle'
  | 'uploading'
  | 'parsing'
  | 'preview'
  | 'committed'
  | 'error';

/** Preview mode toggle [ rendered | raw | split ]. */
export type StepCvPreviewMode = 'rendered' | 'raw' | 'split';

export interface StepCvDraft {
  phase: StepCvPhase;
  /** id of the parse-resume Job we're listening to via SSE */
  parseJobId: string | null;
  /** progress text streamed from the job (last line) */
  progressLine: string;
  /** bytes the server reports for the staged file */
  stagedBytes: number;
  /** raw markdown the server staged (fetched after job succeeds) */
  stagedContent: string;
  /** user-edited content (preview "edit text" textarea); null = use stagedContent verbatim */
  editedContent: string | null;
  previewMode: StepCvPreviewMode;
  /** when phase=error: human-readable reason and optional remediation hint */
  errorMessage: string;
  errorHint: string;
  /** plain-text fallback the user pasted instead of dropping a file */
  pastedText: string;
}

export interface StepProfileDraft extends Partial<ProfileYaml> {
  /** dirty flag from a successful commit; locks the form against further edits */
  committed?: boolean;
}

export interface StepProfileMdDraft extends ProfileMdDraft {
  committed?: boolean;
}

export interface StepPortalsDraft extends PortalsConfig {
  committed?: boolean;
}

export interface OnboardingState {
  /** the step the modal is currently showing */
  step: OnboardingStepId;
  /** snapshot of the last server status (drives the gate AND step seeds) */
  status: OnboardingStatus | null;
  /** profile seed forwarded from the parse job. Wins over status.profileSeed. */
  profileSeed: ProfileSeed | null;
  cv: StepCvDraft;
  profile: StepProfileDraft;
  profileMd: StepProfileMdDraft;
  portals: StepPortalsDraft;
  /** transient toast for non-dismissable Esc presses */
  escNoticeUntil: number;
}

export type Action =
  | { type: 'SET_STATUS'; status: OnboardingStatus }
  | { type: 'GO_TO_STEP'; step: OnboardingStepId }
  | { type: 'SET_PROFILE_SEED'; seed: ProfileSeed }
  // CV step actions
  | { type: 'CV_UPLOADING' }
  | { type: 'CV_PARSING'; jobId: string }
  | { type: 'CV_PROGRESS'; line: string }
  | {
      type: 'CV_PREVIEW';
      content: string;
      bytes: number;
      seed?: ProfileSeed | null;
    }
  | { type: 'CV_PREVIEW_MODE'; mode: StepCvPreviewMode }
  | { type: 'CV_EDITED'; edited: string }
  | { type: 'CV_PASTED'; text: string }
  | { type: 'CV_RESET' }
  | { type: 'CV_ERROR'; message: string; hint?: string }
  | { type: 'CV_COMMITTED' }
  // Profile step actions
  | { type: 'PROFILE_PATCH'; patch: Partial<ProfileYaml> }
  | { type: 'PROFILE_HYDRATE'; draft: StepProfileDraft }
  | { type: 'PROFILE_COMMITTED' }
  // ProfileMd step actions
  | { type: 'PROFILE_MD_PATCH'; patch: Partial<ProfileMdDraft> }
  | { type: 'PROFILE_MD_HYDRATE'; draft: StepProfileMdDraft }
  | { type: 'PROFILE_MD_COMMITTED' }
  | { type: 'PROFILE_MD_ARCHETYPES'; archetypes: Archetype[] }
  | { type: 'PROFILE_MD_LOCATION_SCORE'; key: keyof LocationScores; score: number }
  | { type: 'PROFILE_MD_DEAL_BREAKERS'; values: string[] }
  // Portals step actions
  | { type: 'PORTALS_PATCH'; patch: Partial<PortalsConfig> }
  | { type: 'PORTALS_HYDRATE'; draft: StepPortalsDraft }
  | { type: 'PORTALS_COMMITTED' }
  // Esc notice
  | { type: 'ESC_NOTICE' };
