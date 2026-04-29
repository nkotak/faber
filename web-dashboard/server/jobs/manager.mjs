// jobs/manager.mjs - in-memory registry of running subprocess jobs.
//
// Mirrors the Go internal/jobs package: each spawned process becomes a Job
// with a lifecycle (running -> succeeded / failed / cancelled). State
// transitions fan out to SSE subscribers so the UI chip bar can react in
// real time. Toast durations match the Go defaults (5s success / 60s
// failure / 10s cancelled) and are scheduled server-side; the UI just
// renders whatever the server reports.

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { scanOutputPDFs } from '../parsers/output-pdfs.mjs';

const TOAST_MS = {
  succeeded: 5_000,
  failed: 60_000,
  cancelled: 10_000,
};

/**
 * Some job kinds need a longer "after-life" in the registry so the UI can
 * re-attach to a finished-but-not-yet-acted-on result. Specifically: cleanup
 * dry-runs whose user-visible flow is "preview, then click apply" — if the
 * user closes the modal during the long Playwright phase, the chip auto-
 * pruning after 5s would erase the proposed changes before they had a chance
 * to review and apply.
 *
 * Keyed by `${kind}:${status}`; the value is the toast TTL in ms. Falls back
 * to TOAST_MS[status] for unmatched kinds.
 */
const TOAST_MS_BY_KIND = {
  'cleanup-dead:succeeded': 600_000, // 10 minutes
  'cleanup-region:succeeded': 600_000,
};

/** Delay after exit before we scan for the expected artifact. Chokidar's
 * awaitWriteFinish can still be debouncing when the subprocess exits,
 * and macOS FS has a small lag under load. 1.2s is conservative and
 * still feels instantaneous to the user. */
const PDF_INTEGRITY_DELAY_MS = 1200;

/** Same delay applied to cv-imported.md verification for onboarding-cv jobs. */
const CV_IMPORTED_INTEGRITY_DELAY_MS = 1200;

export class JobManager extends EventEmitter {
  constructor({ careerOpsRoot } = {}) {
    super();
    this.careerOpsRoot = careerOpsRoot;
    /** @type {Map<string, Job>} */
    this.jobs = new Map();
    /** Tmp paths that the onboarding routes asked us to track for cleanup
     *  when the job finalizes. Keyed by job id. */
    this.tmpPathsByJobId = new Map();
  }

  list() {
    return Array.from(this.jobs.values()).map((j) => ({
      id: j.id,
      kind: j.kind,
      refKey: j.refKey,
      label: j.label,
      status: j.status,
      progressLine: j.progressLine,
      startedAt: j.startedAt,
      endedAt: j.endedAt,
      exitCode: j.exitCode,
      errorText: j.errorText,
      metadata: j.metadata ?? null,
      profileSeedAvailable: Boolean(j.metadata && j.metadata.profileSeed),
    }));
  }

  /**
   * Hand the route the tmp path we promised to clean up, then forget it.
   * Returns null if no path was registered for that id.
   */
  takeTmpPathToCleanup(id) {
    const p = this.tmpPathsByJobId.get(id);
    if (p) this.tmpPathsByJobId.delete(id);
    return p ?? null;
  }

  /**
   * Spawn a subprocess and register it as a tracked job.
   *
   * Caller contract: `command` and `args` are trusted (never interpolated
   * from user input). The job manager does NOT use a shell; execFile-style
   * arg array only. Any file path passed in must already be validated by
   * the route that called into here.
   */
  spawnJob({
    kind,
    refKey,
    label,
    command,
    args,
    cwd,
    expectedPdfReportNum,
    expectedCvImportedPath,
    tmpPathToCleanup,
    successExitCodes,
    onSuccess,
  }) {
    const id = randomUUID();
    const now = Date.now();
    // Caller may declare additional exit codes that should count as success
    // (e.g., cleanup scripts intentionally exit 2 from --dry-run when there
    // are proposed changes — a CI-style signal, not a failure). Default is
    // exit 0 only, which matches the historical behavior for every existing
    // call site.
    const okExitCodes = Array.isArray(successExitCodes) && successExitCodes.length > 0
      ? successExitCodes
      : [0];
    const proc = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    /** @type {Job} */
    const job = {
      id,
      kind,
      refKey,
      label,
      status: 'running',
      progressLine: '',
      startedAt: now,
      endedAt: null,
      exitCode: null,
      errorText: '',
      proc,
      pruneTimer: null,
      expectedPdfReportNum: expectedPdfReportNum ?? null,
      expectedCvImportedPath: expectedCvImportedPath ?? null,
      metadata: null,
    };
    this.jobs.set(id, job);
    if (tmpPathToCleanup) this.tmpPathsByJobId.set(id, tmpPathToCleanup);
    this.emit('update', this.#snapshot(job));

    const handleLine = (line) => {
      const clean = line.replace(/\u001b\[[0-9;]*m/g, '').trim();
      if (!clean) return;
      // Onboarding-cv emits a final JSON line with shape
      //   {"event":"complete","roles":N,"skills_categories":M,...,"profileSeed":{...}}
      // We parse it and stash on the job's metadata so the SSE snapshot
      // exposes profileSeed to the modal.
      if (job.kind === 'onboarding-cv' && clean.startsWith('{') && clean.endsWith('}')) {
        try {
          const parsed = JSON.parse(clean);
          if (parsed && parsed.event === 'complete') {
            job.metadata = parsed;
          }
        } catch {
          // not a JSON line - leave progressLine as-is
        }
      }
      job.progressLine = clean.slice(0, 120);
      this.emit('update', this.#snapshot(job));
    };

    let stdoutBuf = '';
    proc.stdout.setEncoding('utf-8');
    proc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      lines.forEach(handleLine);
    });

    let stderrBuf = '';
    proc.stderr.setEncoding('utf-8');
    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk;
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() ?? '';
      lines.forEach(handleLine);
    });

    proc.on('exit', (code, signal) => {
      if (stdoutBuf.trim()) handleLine(stdoutBuf);
      if (stderrBuf.trim()) handleLine(stderrBuf);
      job.endedAt = Date.now();
      job.exitCode = code;
      if (job.status === 'cancelling') {
        job.status = 'cancelled';
        this.#finalize(job);
      } else if (okExitCodes.includes(code)) {
        // For PDF jobs, verify the artifact actually exists before we
        // trust exit-0. Claude subprocesses can exit clean without having
        // run their tools (the original bug this guards against).
        if (job.kind === 'pdf' && job.expectedPdfReportNum != null && this.careerOpsRoot) {
          setTimeout(() => this.#verifyPdfOnDisk(job), PDF_INTEGRITY_DELAY_MS);
        } else if (job.kind === 'onboarding-cv' && job.expectedCvImportedPath) {
          setTimeout(() => this.#verifyCvImportedOnDisk(job), CV_IMPORTED_INTEGRITY_DELAY_MS);
        } else {
          job.status = 'succeeded';
          // Fire optional onSuccess hook before finalizing. A hook failure
          // is logged but does not change the job's perceived status — the
          // user already saw "succeeded" via the SSE update.
          this.#runOnSuccessHook(job, onSuccess).finally(() => this.#finalize(job));
        }
      } else {
        job.status = 'failed';
        job.errorText = signal
          ? `terminated by ${signal}`
          : `exit ${code}`;
        this.#finalize(job);
      }
    });

    proc.on('error', (err) => {
      job.status = 'failed';
      job.errorText = err.message;
      job.endedAt = Date.now();
      this.emit('update', this.#snapshot(job));
      const ttl = TOAST_MS.failed;
      job.pruneTimer = setTimeout(() => {
        this.jobs.delete(id);
        this.emit('remove', { id });
      }, ttl);
    });

    return this.#snapshot(job);
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status !== 'running') return false;
    job.status = 'cancelling';
    try {
      job.proc.kill('SIGTERM');
    } catch {
      // already dead
    }
    this.emit('update', this.#snapshot(job));
    return true;
  }

  hasActiveFor(kind, refKey) {
    for (const j of this.jobs.values()) {
      if (j.kind !== kind) continue;
      if (j.refKey !== refKey) continue;
      if (j.status === 'running' || j.status === 'cancelling') return true;
    }
    return false;
  }

  /**
   * Return the active job snapshot for (kind, refKey) if one is running, else
   * null. Used by routes that need to let the UI re-attach to a running job
   * after the user closed and reopened a modal.
   */
  getActiveFor(kind, refKey) {
    for (const j of this.jobs.values()) {
      if (j.kind !== kind) continue;
      if (j.refKey !== refKey) continue;
      if (j.status === 'running' || j.status === 'cancelling') return this.#snapshot(j);
    }
    return null;
  }

  /**
   * Return the most-recent job snapshot for (kind, refKey) regardless of
   * status (running, succeeded, failed, cancelled). Used to let the UI
   * re-enter the right modal state when the user reopens after a job has
   * finished. Most-recent is determined by startedAt.
   */
  getMostRecentFor(kind, refKey) {
    let chosen = null;
    for (const j of this.jobs.values()) {
      if (j.kind !== kind) continue;
      if (j.refKey !== refKey) continue;
      if (!chosen || j.startedAt > chosen.startedAt) chosen = j;
    }
    return chosen ? this.#snapshot(chosen) : null;
  }

  #snapshot(job) {
    return {
      id: job.id,
      kind: job.kind,
      refKey: job.refKey,
      label: job.label,
      status: job.status,
      progressLine: job.progressLine,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      exitCode: job.exitCode,
      errorText: job.errorText,
      metadata: job.metadata ?? null,
      profileSeedAvailable: Boolean(job.metadata && job.metadata.profileSeed),
    };
  }

  /** Emit update + schedule auto-prune after the toast window. */
  #finalize(job) {
    this.emit('update', this.#snapshot(job));
    const kindKey = `${job.kind}:${job.status}`;
    const ttl = TOAST_MS_BY_KIND[kindKey] ?? TOAST_MS[job.status] ?? 5_000;
    job.pruneTimer = setTimeout(() => {
      this.jobs.delete(job.id);
      this.emit('remove', { id: job.id });
    }, ttl);
  }

  /**
   * Run a caller-provided post-success hook. Errors are caught and logged so
   * a misbehaving hook never demotes a job from succeeded to failed — by the
   * time we reach this branch the user has already seen the success update.
   */
  async #runOnSuccessHook(job, onSuccess) {
    if (typeof onSuccess !== 'function') return;
    try {
      await onSuccess(this.#snapshot(job));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[jobs] onSuccess hook failed for ${job.kind} ${job.refKey}: ${msg}`);
    }
  }

  /**
   * For PDF jobs that exited 0: scan output/ for the expected cv-{n}-*.pdf.
   * If missing, demote succeeded -> failed with an honest error so the UI
   * doesn't lie about success. Uses scanOutputPDFs (already ports the same
   * regex the Go TUI uses) so there's one source of truth for filename shape.
   */
  async #verifyPdfOnDisk(job) {
    try {
      const { byReportNum } = await scanOutputPDFs(this.careerOpsRoot);
      if (byReportNum.has(job.expectedPdfReportNum)) {
        job.status = 'succeeded';
      } else {
        job.status = 'failed';
        job.errorText =
          'subprocess exited 0 but no PDF landed in output/ (most often: tool permissions denied or skill did not invoke generate-pdf.mjs)';
      }
    } catch (err) {
      // Can't verify - be conservative, assume success (match previous behavior).
      job.status = 'succeeded';
      job.progressLine = `verify skipped: ${err?.message ?? 'unknown'}`;
    }
    this.#finalize(job);
  }

  /**
   * Mirror of #verifyPdfOnDisk for onboarding-cv jobs. The skill writes
   * cv-imported.md at the project root; if exit-0 hit but the file isn't
   * there, demote to failed with an honest error.
   */
  async #verifyCvImportedOnDisk(job) {
    try {
      const st = await stat(job.expectedCvImportedPath);
      if (st && st.isFile() && st.size > 0) {
        job.status = 'succeeded';
      } else {
        job.status = 'failed';
        job.errorText = 'subprocess exited 0 but cv-imported.md is empty or missing';
      }
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        job.status = 'failed';
        job.errorText =
          'subprocess exited 0 but cv-imported.md was not written (most often: --permission-mode=bypassPermissions missing or skill failed silently)';
      } else {
        job.status = 'succeeded';
        job.progressLine = `verify skipped: ${err?.message ?? 'unknown'}`;
      }
    }
    this.#finalize(job);
  }

  shutdown() {
    for (const job of this.jobs.values()) {
      if (job.pruneTimer) clearTimeout(job.pruneTimer);
      try {
        job.proc.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    this.jobs.clear();
  }
}

/**
 * @typedef {Object} Job
 * @property {string} id
 * @property {'pdf'|'eval'|'interview-prep'|'onboarding-cv'} kind
 * @property {string} refKey      - stable key used to dedupe: reportNumber for pdf/prep; URL for eval; 'current' for onboarding-cv
 * @property {string} label       - human-readable title for the chip
 * @property {'running'|'cancelling'|'succeeded'|'failed'|'cancelled'} status
 * @property {string} progressLine
 * @property {number} startedAt
 * @property {number|null} endedAt
 * @property {number|null} exitCode
 * @property {string} errorText
 * @property {import('node:child_process').ChildProcess} proc
 * @property {NodeJS.Timeout|null} pruneTimer
 * @property {number|null} expectedPdfReportNum
 * @property {string|null} expectedCvImportedPath - absolute path to cv-imported.md when kind === 'onboarding-cv'
 * @property {object|null} metadata               - last parsed JSON event line; carries profileSeed for onboarding-cv
 */
