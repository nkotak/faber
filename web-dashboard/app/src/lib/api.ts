// lib/api.ts - thin fetch wrappers.
//
// Dev mode: Vite proxies /api to http://127.0.0.1:7433.
// Prod mode: server serves the built app and /api on the same origin.

import type {
  CommitCvResponse,
  ConfigParsedResponse,
  Job,
  OnboardingParseJobResponse,
  OnboardingStatus,
  OnboardingWriteResponse,
  PipelineResponse,
  PortalsConfig,
  ProfileMdDraft,
  ProfileYaml,
  ProfileYamlFull,
} from './types';

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

async function jpost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`${path}: ${r.status} ${text || r.statusText}`);
  }
  return r.json() as Promise<T>;
}

async function jpatch<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`${path}: ${r.status} ${text || r.statusText}`);
  }
  return r.json() as Promise<T>;
}

/**
 * Multipart helper: posts a FormData body. Used for resume PDF/DOCX uploads
 * to /api/onboarding/parse-resume. The browser sets the Content-Type with
 * the correct boundary automatically when we omit the header.
 */
async function jpostForm<T>(path: string, form: FormData): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { accept: 'application/json' },
    body: form,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`${path}: ${r.status} ${text || r.statusText}`);
  }
  return r.json() as Promise<T>;
}

/**
 * Frontend ProfileMdDraft uses TS-idiomatic camelCase + axes-as-string.
 * Backend modes/_profile.md schema uses snake_case + axes-as-array (matching
 * the YAML conventions in modes/_profile.template.md). Translate at the
 * request boundary so the rest of the app keeps the ergonomic shape.
 */
function toProfileMdServerPayload(d: ProfileMdDraft) {
  return {
    archetypes: d.archetypes.map((a) => ({
      name: a.name.trim(),
      // Frontend collects axes as a comma-list in one field; backend wants
      // a bounded array. Split, trim, drop empties, cap at 10 entries.
      axes: a.axes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10),
      whatTheyBuy: a.whatTheyBuy.trim(),
      fit: a.fit,
    })),
    exit_narrative: d.exitStory,
    cross_cutting_advantage: d.crossCuttingAdvantage,
    deal_breakers: d.dealBreakers,
    location_scoring: d.locationScores,
  };
}

/**
 * Frontend PortalsConfig is camelCase + a Record for company toggles.
 * Backend portalsSchema is snake_case + an array of {name, enabled}.
 *
 * customCompanies is the parallel list of user-added entries with full
 * metadata; it round-trips to the `custom_companies` YAML block.
 */
function toPortalsServerPayload(p: PortalsConfig) {
  return {
    use_defaults: p.useDefaults,
    title_filter: {
      positive: p.positiveKeywords,
      negative: p.negativeKeywords,
    },
    companies: Object.entries(p.companyOverrides).map(([name, enabled]) => ({
      name,
      enabled,
    })),
    custom_companies: p.customCompanies.map((c) => ({
      name: c.name,
      platform: c.platform,
      slug: c.slug ?? '',
      careers_url: c.careers_url,
      notes: c.notes ?? '',
      enabled: c.enabled,
    })),
  };
}

export const api = {
  pipeline: () => jget<PipelineResponse>('/api/applications'),

  report: (path: string) =>
    jget<{ content: string; path: string }>(
      `/api/reports?path=${encodeURIComponent(path)}`,
    ),

  interviewPrep: (slug: string) =>
    jget<{ content: string; slug: string }>(
      `/api/interview-prep?slug=${encodeURIComponent(slug)}`,
    ),

  jobs: () => jget<{ jobs: Job[] }>('/api/jobs'),

  setStatus: (reportNumber: string, status: string) =>
    jpatch<{ reportNumber: string; newStatus: string }>(
      `/api/applications/${encodeURIComponent(reportNumber)}/status`,
      { status },
    ),

  startPdfJob: (reportNumber: string) =>
    jpost<Job>('/api/jobs/pdf', { reportNumber }),

  startEvalJob: (url: string) =>
    jpost<Job>('/api/jobs/eval', { url }),

  startInterviewPrepJob: (reportNumber: string) =>
    jpost<Job>('/api/jobs/interview-prep', { reportNumber }),

  cancelJob: (id: string) =>
    jpost<{ ok: boolean }>(`/api/jobs/${encodeURIComponent(id)}/cancel`, {}),

  // ------------------------------------------------------------------
  // Cleanup endpoints. Backed by cleanup-dead-jobs.mjs and
  // cleanup-region-mismatch.mjs respectively. Both default to dry-run; pass
  // `dryRun: false` to actually mutate applications.md / pipeline.md.
  // Progress streams via the same SSE channel as other jobs (kind:
  // 'cleanup-dead' or 'cleanup-region').
  // ------------------------------------------------------------------

  /** POST /api/cleanup/dead — two-strikes liveness sweep. */
  startCleanupDead: (opts: { dryRun?: boolean; limit?: number } = {}) =>
    jpost<Job>('/api/cleanup/dead', {
      dryRun: opts.dryRun ?? true,
      ...(opts.limit ? { limit: opts.limit } : {}),
    }),

  /** POST /api/cleanup/region — drop pipeline + apps that don't match
   * the current location_filter in config/profile.yml. */
  startCleanupRegion: (opts: { dryRun?: boolean } = {}) =>
    jpost<Job>('/api/cleanup/region', {
      dryRun: opts.dryRun ?? true,
    }),

  /** GET /api/cleanup/status — running booleans + active job snapshots so
   *  the UI can re-attach to an in-flight dry-run after the modal is closed
   *  and reopened. Job is null when nothing is running for that kind. */
  cleanupStatus: () =>
    jget<{
      deadRunning: boolean;
      regionRunning: boolean;
      deadJob: Job | null;
      regionJob: Job | null;
    }>('/api/cleanup/status'),

  /** POST /api/inbox/add — append a single URL to data/pipeline.md as Pending. */
  addInboxUrl: (url: string) =>
    jpost<{ ok: true; row: string }>('/api/inbox/add', { url }),

  /** POST /api/inbox/remove — hard-delete a URL's row from data/pipeline.md.
   *  Matches both `- [ ]` and `- [x]` rows. .bak snapshot written server-side. */
  removePipelineUrl: (url: string) =>
    jpost<{ ok: true }>('/api/inbox/remove', { url }),

  // ------------------------------------------------------------------
  // Onboarding endpoints. These exist (or will exist) on the Fastify
  // server under /api/onboarding/*. Schema contract is in the plan at
  // craft-i-need-you-dreamy-jellyfish.md.
  // ------------------------------------------------------------------

  /** GET /api/onboarding/status — drives the OnboardingGate. */
  onboardingStatus: () => jget<OnboardingStatus>('/api/onboarding/status'),

  /**
   * POST /api/onboarding/parse-resume (multipart) — uploads the PDF/DOCX
   * file and spawns the onboard-cv job. Returns the Job so we can subscribe
   * to SSE updates filtered by id.
   */
  parseResumeUpload: (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return jpostForm<OnboardingParseJobResponse>('/api/onboarding/parse-resume', form);
  },

  /**
   * POST /api/onboarding/parse-resume (JSON) — pasted-text path. Bypasses
   * the spawn entirely on the server side; staged content lands at
   * cv-imported.md without invoking claude.
   */
  parseResumeText: (text: string) =>
    jpost<OnboardingParseJobResponse>('/api/onboarding/parse-resume', { text }),

  /**
   * POST /api/onboarding/commit-cv — atomic rename cv-imported.md → cv.md
   * (with backup of any existing cv.md). Optional `editedContent` lets the
   * user tune the LLM output before commit; the server writes that string
   * verbatim instead of the staged file.
   */
  commitCv: (editedContent?: string) =>
    jpost<CommitCvResponse>(
      '/api/onboarding/commit-cv',
      // Backend's commitCvSchema is .strict(); a null editedContent is rejected.
      // Omit the key entirely when no override was provided.
      editedContent ? { editedContent } : {},
    ),

  /** POST /api/onboarding/profile — zod-validated config/profile.yml write. */
  writeProfile: (payload: ProfileYaml) =>
    jpost<OnboardingWriteResponse>('/api/onboarding/profile', payload),

  /** POST /api/onboarding/customize-profile-md — render template + write. */
  writeProfileMd: (payload: ProfileMdDraft) =>
    jpost<OnboardingWriteResponse>(
      '/api/onboarding/customize-profile-md',
      toProfileMdServerPayload(payload),
    ),

  /** POST /api/onboarding/portals — copy template, inject overrides. */
  writePortals: (payload: PortalsConfig) =>
    jpost<OnboardingWriteResponse>(
      '/api/onboarding/portals',
      toPortalsServerPayload(payload),
    ),

  /** POST /api/onboarding/init-tracker — empty data/applications.md scaffold. */
  initTracker: () =>
    jpost<OnboardingWriteResponse>('/api/onboarding/init-tracker', {}),

  /** POST /api/onboarding/skip — bypass the modal entirely; stubs every
   *  required user-layer file so the dashboard boots and the user can edit
   *  via Settings (Cmd+,) at their own pace. Idempotent. */
  skipOnboarding: () =>
    jpost<{
      created: Record<string, boolean>;
      skipped: string[];
      path: string;
    }>('/api/onboarding/skip', {}),

  // ------------------------------------------------------------------
  // Settings reads. These power the post-onboarding edit surface.
  // Writes still flow through the /api/onboarding/* endpoints above
  // (commitCv, writeProfile, writeProfileMd, writePortals); we only
  // add reads here.
  // ------------------------------------------------------------------

  /** Generic whitelisted parsed-YAML reader. */
  getConfigParsed: <T>(file: string) =>
    jget<ConfigParsedResponse<T>>(
      `/api/config/parsed?file=${encodeURIComponent(file)}`,
    ),

  /** GET /api/reports?path=cv.md — raw markdown for the Settings CV pane. */
  loadCv: () =>
    jget<{ content: string; path: string }>(
      `/api/reports?path=${encodeURIComponent('cv.md')}`,
    ),

  /** GET /api/reports?path=modes/_profile.md — raw markdown preview for PaneProfileMd. */
  loadProfileMd: () =>
    jget<{ content: string; path: string }>(
      `/api/reports?path=${encodeURIComponent('modes/_profile.md')}`,
    ),

  /** GET /api/config/parsed?file=profile.yml — parsed JSON view of profile.yml. */
  loadProfile: () =>
    jget<ConfigParsedResponse<ProfileYamlFull>>(
      `/api/config/parsed?file=${encodeURIComponent('profile.yml')}`,
    ),

  /** GET /api/config/parsed?file=portals.yml — parsed JSON + raw text. */
  loadPortals: () =>
    jget<ConfigParsedResponse<Record<string, unknown>>>(
      `/api/config/parsed?file=${encodeURIComponent('portals.yml')}`,
    ),
};
