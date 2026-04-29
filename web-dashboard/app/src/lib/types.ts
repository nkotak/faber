// lib/types.ts - shared types between backend responses and UI.

export type CanonicalStatus =
  | 'evaluated'
  | 'applied'
  | 'responded'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'discarded'
  | 'skip'
  | string; // unknown statuses retained verbatim

export interface Application {
  number: number; // tracker row id
  reportNumInt: number; // int from [NUM] link, different identity
  date: string;
  company: string;
  role: string;
  scoreRaw: string;
  score: number;
  status: string;
  canonicalStatus: CanonicalStatus;
  statusRank: number;
  hasPDF: boolean;
  pdfOnDisk: boolean;
  pdfPath: string;
  reportPath: string;
  reportNumber: string;
  interviewPrepSlug: string;
  hasInterviewPrep: boolean;
  notes: string;
  jobURL: string;
  archetype: string;
  tlDr: string;
  remote: string;
  compEstimate: string;
}

/** Liveness cache entry, attached to a pending row when its URL was checked
 * by `cleanup-dead-jobs.mjs`. Absent until first check. */
export interface PendingLiveness {
  /** YYYY-MM-DD when the URL was last checked. */
  lastChecked: string;
  /** 'active' = on board / page loads, 'expired' = 404 / removed,
   * 'uncertain' = transient navigation error. */
  lastResult: 'active' | 'expired' | 'uncertain';
  /** Two-strikes counter: 0 = healthy, 1 = tentative (one fail), 2+ = confirmed. */
  consecutiveFailures: number;
}

export interface PendingJob {
  url: string;
  company: string;
  role: string;
  /** Optional 4th column of the pipeline.md row, added with location_filter
   * rollout (2026-04). Empty string for older entries that pre-date the schema. */
  location: string;
  section: string;
  lineNumber: number;
  rawLine: string;
  /** Set only when the URL has been checked at least once. */
  liveness?: PendingLiveness;
}

export interface PipelineMeta {
  total: number;
  withPDF: number;
  pendingCount: number;
  topScore: number;
  avgScore: number;
  byStatus: Record<string, number>;
}

export interface PipelineResponse {
  applications: Application[];
  pending: PendingJob[];
  canonicalStatuses: string[];
  meta: PipelineMeta;
}

export type JobKind =
  | 'pdf'
  | 'eval'
  | 'interview-prep'
  | 'cleanup-dead'
  | 'cleanup-region';
export type JobStatus = 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  kind: JobKind;
  refKey: string;
  label: string;
  status: JobStatus;
  progressLine: string;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  errorText: string;
}

export type FilterTab =
  | 'all'
  | 'top'
  | 'applied'
  | 'interview'
  | 'evaluated'
  | 'skip'
  | 'queue';

export type SortMode = 'score' | 'date' | 'company' | 'status';
export type ViewMode = 'grouped' | 'flat';
export type ThemePref = 'auto' | 'light' | 'dark';

// ====================================================================
// Onboarding types — first-run setup of cv.md, profile.yml, _profile.md
// portals.yml, and applications.md. The shape mirrors the locked API
// contract documented in `craft-i-need-you-dreamy-jellyfish.md`.
// ====================================================================

/** Identifier for the five (sometimes six, with tracker) onboarding steps. */
export type OnboardingStepId = 'cv' | 'profile' | 'profileMd' | 'portals' | 'ready';

/** GET /api/onboarding/status response. */
export interface OnboardingStatus {
  setupComplete: boolean;
  /** files that MUST exist before the modal can unmount */
  required: Array<OnboardingFileStatus>;
  /** files we'll create on the user's behalf if missing (e.g., applications.md) */
  optional: Array<OnboardingFileStatus>;
  /** flat list of missing required filenames for quick lookup */
  missingFiles: string[];
  /** the next step the modal should land on */
  nextStep: OnboardingStepId | null;
  /** staging file presence; lets the gate detect a half-finished cv import */
  staging: {
    cvImportedExists: boolean;
    cvImportedSize?: number;
  };
  /** whether any individually-optional steps should still be shown */
  optionalSteps: {
    initTracker: boolean;
  };
  /**
   * Optional bridge for narrative fields the parse job extracted (or that
   * step 2 wrote) so step 3 can pre-populate without an extra round-trip.
   * Server may include this; if absent the modal falls back to reducer state.
   */
  profileSeed?: ProfileSeed;
}

export interface OnboardingFileStatus {
  /** path relative to careerOpsRoot, e.g. "cv.md" */
  path: string;
  exists: boolean;
  bytes?: number;
}

/** Suggestions distilled by the onboard-cv skill from the parsed resume. */
export interface ProfileSeed {
  fullName?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  portfolioUrl?: string;
  github?: string;
  /** ghost rows the user adopts in step 3 */
  suggestedArchetypes?: Archetype[];
  /** narrative seeds for step 3 */
  exitStory?: string;
  superpowers?: string[];
  /** primary target role guesses (chips) */
  targetRoles?: string[];
}

/** Sub-shape of `config/profile.yml` we drive from the form. */
export interface ProfileYaml {
  candidate: {
    full_name: string;
    email: string;
    phone?: string;
    location: string;
    linkedin?: string;
    portfolio_url?: string;
    github?: string;
  };
  target_roles: {
    primary: string[];
  };
  narrative: {
    exit_story?: string;
    superpowers?: string[];
  };
  compensation: {
    target_range: string;
    currency: 'USD' | 'GBP' | 'EUR' | 'CAD' | 'AUD';
    minimum: string;
    location_flexibility?: string;
  };
  location: {
    country: string;
    city: string;
    timezone: string;
    visa_status?: string;
  };
  /** Optional pre-scan location filter (added 2026-04). When present and
   * `enabled: true`, scans drop jobs whose location string doesn't match. */
  location_filter?: LocationFilter;
}

/** A single archetype row used by both the YAML profile and step 3.
 *
 * `level` is the slim-mode field used by config/profile.yml. The rich-mode
 * renderer (modes/_profile.md / customize-profile-md endpoint) ignores it.
 * Backend zod accepts both shapes. */
export interface Archetype {
  name: string;
  axes: string;
  whatTheyBuy: string;
  fit: 'primary' | 'secondary' | 'adjacent';
  /** populated in slim mode for profile.yml; ignored by rich/profileMd renderer */
  level?: string;
}

/** Slim shape persisted in config/profile.yml under target_roles.archetypes. */
export interface ArchetypeSlim {
  name: string;
  level: string;
  fit: 'primary' | 'secondary' | 'adjacent';
}

/** Single proof-point entry under narrative.proof_points. */
export interface ProofPoint {
  name: string;
  url: string;
  hero_metric: string;
}

/** Five-row scoring table mapping LocationType → 1..5. */
export type LocationType =
  | 'remote_within_country'
  | 'remote_outside_country'
  | 'hybrid_within_metro'
  | 'onsite_within_metro'
  | 'onsite_relocation';

export type LocationScores = Record<LocationType, number>;

/** Payload the modal POSTs to /api/onboarding/customize-profile-md. */
export interface ProfileMdDraft {
  archetypes: Archetype[];
  locationScores: LocationScores;
  dealBreakers: string[];
  exitStory: string;
  crossCuttingAdvantage: string;
}

/** Payload for /api/onboarding/portals. */
export interface PortalsConfig {
  useDefaults: boolean;
  positiveKeywords: string[];
  negativeKeywords: string[];
  /** company name → enabled flag. only applied when useDefaults is false */
  companyOverrides: Record<string, boolean>;
  /** User-added companies that aren't in the template. Persisted to a
   * separate `custom_companies` block in portals.yml so they round-trip
   * cleanly without colliding with the curated tracked_companies defaults. */
  customCompanies: CustomCompany[];
}

/** A user-added tracked company. Mirrors the entry shape of
 * `tracked_companies` in portals.yml but lives in the parallel
 * `custom_companies` block. The slug is required for ATS-API platforms
 * (ashby/lever/greenhouse) and ignored for `workable`/`custom`. */
export interface CustomCompany {
  name: string;
  platform: 'ashby' | 'lever' | 'greenhouse' | 'workable' | 'custom';
  /** ATS slug — required when platform is ashby/lever/greenhouse */
  slug?: string;
  careers_url: string;
  notes?: string;
  enabled: boolean;
}

/** Job spawned by /api/onboarding/parse-resume. The server returns a Job
 * (the same shape Job uses) plus an optional staged path. */
export interface OnboardingParseJobResponse {
  job: Job;
  stagedPath: string;
}

/** Job kind union grows by one to add 'onboarding-cv'. */
export type OnboardingJobKind = JobKind | 'onboarding-cv';

/** Response from POST /api/onboarding/commit-cv */
export interface CommitCvResponse {
  cvPath: string;
  bytes: number;
  backupPath?: string;
}

/** Generic write response shape for profile/profileMd/portals/init-tracker. */
export interface OnboardingWriteResponse {
  path: string;
  bytes: number;
}

// ====================================================================
// Settings types — post-onboarding edit surface for the four user-layer
// files. The Settings panes reuse onboarding inputs and write through
// existing /api/onboarding/* routes; only the read endpoint is new.
// ====================================================================

/** Generic shape returned by GET /api/config/parsed?file=<name>. */
export interface ConfigParsedResponse<T> {
  file: string;
  path: string;
  parsed: T;
  raw: string;
}

/** Full structural shape of `config/profile.yml` accepted by the backend
 * zod schema (see server/onboarding/validation.mjs profileYamlSchema).
 * Extends ProfileYaml with the fields onboarding step 2 deliberately
 * skipped (twitter, narrative.headline, narrative.proof_points, the slim
 * archetypes list, the dashboard demo block, and onsite_availability). */
export interface ProfileYamlFull {
  candidate: {
    full_name: string;
    email: string;
    phone: string;
    location: string;
    linkedin: string;
    portfolio_url: string;
    github: string;
    twitter: string;
    canva_resume_design_id: string;
  };
  target_roles: {
    primary: string[];
    archetypes: ArchetypeSlim[];
  };
  narrative: {
    headline: string;
    exit_story: string;
    superpowers: string[];
    proof_points: ProofPoint[];
    dashboard: {
      url: string;
      password: string;
    };
  };
  compensation: {
    target_range: string;
    currency: 'USD' | 'GBP' | 'EUR' | 'CAD' | 'AUD';
    minimum: string;
    location_flexibility: string;
  };
  location: {
    country: string;
    city: string;
    timezone: string;
    visa_status: string;
    onsite_availability: string;
  };
  /** Optional pre-scan location filter (added 2026-04). Disabled by default;
   * users opt in via the Settings → Location filter pane. */
  location_filter?: LocationFilter;
}

/** Pre-scan location filter shape mirroring `location_filter` in
 * `config/profile.yml`. Mirrors the zod schema in
 * `server/onboarding/validation.mjs` `locationFilterSchema`. */
export interface LocationFilter {
  /** Master toggle. When false (default), every job passes the filter. */
  enabled: boolean;
  remote?: {
    /** When false, all "Remote" jobs are rejected regardless of region. */
    enabled: boolean;
    /** Regions accepted for "Remote — X" listings. Lowercase canonical names:
     * 'us', 'americas', 'emea', 'apac', 'global'. */
    accept_regions: string[];
    /** Behavior for bare "Remote" strings without a region qualifier. */
    bare_remote_policy: 'allow' | 'deny' | 'unknown';
  };
  hybrid?: {
    /** Canonical location names (e.g. "NYC", "NJ", "Bay Area"). Each is
     * expanded via the alias map to match many variants of the same place. */
    locations: string[];
  };
  onsite?: {
    locations: string[];
  };
  /** User-defined extensions to the built-in alias map. Canonical name
   * → list of variant strings. */
  custom_aliases?: Record<string, string[]>;
  /** What to do for empty / unparseable location strings. */
  unknown_policy: 'allow' | 'deny' | 'ask';
}

/** Identifier for the Settings panes. */
export type SettingsPaneId = 'cv' | 'profile' | 'profileMd' | 'portals' | 'locationFilter';
