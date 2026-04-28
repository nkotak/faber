// onboarding/index.mjs - mount all /api/onboarding/* routes.
//
// The onboarding flow is owned by the dashboard server because every step
// writes a user-layer file. The flow is:
//
//   1. GET  /api/onboarding/status                 always 200, even pre-setup
//   2. POST /api/onboarding/parse-resume           multipart upload OR JSON {text}
//   3. POST /api/onboarding/commit-cv              promote staging to canonical
//   4. POST /api/onboarding/profile                write config/profile.yml
//   5. POST /api/onboarding/customize-profile-md   write modes/_profile.md
//   6. POST /api/onboarding/portals                write portals.yml
//   7. POST /api/onboarding/init-tracker           write data/applications.md
//
// The route handlers reuse CLAUDE_BASE_FLAGS for the parse-resume job spawn
// so the --permission-mode=bypassPermissions flag is preserved.

import { unlink } from 'node:fs/promises';
import { ZodError } from 'zod';

import { getOnboardingStatus } from './status.mjs';
import { receiveUpload, stageText, UploadError } from './multipart.mjs';
import { validateAndNormalize, TextOutOfRangeError } from './parsers/text.mjs';
import { commitCv, CommitCvShapeError, CommitCvNotStagedError } from './writers/cv.mjs';
import { writeProfileYaml } from './writers/profile.mjs';
import { renderAndWriteProfileMd } from './writers/profile-md.mjs';
import { writePortalsYaml, PortalsTemplateMissingError } from './writers/portals.mjs';
import { initTracker } from './writers/tracker.mjs';
import { skipOnboarding } from './writers/skip.mjs';
import { readParsedConfig, ConfigReadError } from './config-read.mjs';
import {
  parseResumeJsonSchema,
  commitCvSchema,
  profileYamlSchema,
  profileMdSchema,
  portalsSchema,
  initTrackerSchema,
} from './validation.mjs';

const CLAUDE_BASE_FLAGS = [
  '--output-format', 'stream-json',
  '--verbose',
  '--permission-mode=bypassPermissions',
];

const MAX_JSON_TEXT_BYTES = 1_500_000; // generous; zod schema enforces a stricter cap

/**
 * Convert a ZodError into a 422 field-level payload.
 * @param {ZodError} err
 */
function zodToFieldErrors(err) {
  return {
    error: 'validation failed',
    fields: err.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    })),
  };
}

/**
 * Register all onboarding routes.
 * @param {import('fastify').FastifyInstance} app
 * @param {{ careerOpsRoot: string, jobs: import('../jobs/manager.mjs').JobManager }} ctx
 */
export function registerOnboardingRoutes(app, { careerOpsRoot, jobs }) {
  // -- 0. Parsed config read (Settings view) -------------------------------
  // Whitelisted YAML reader. Backs the Settings view so the frontend doesn't
  // need to parse YAML in the browser. Markdown files (cv.md, _profile.md)
  // are NOT served here — they go through /api/reports?path=, which already
  // exists and is path-traversal-guarded.
  app.get('/api/config/parsed', async (req, reply) => {
    const file = String(req.query?.file ?? '');
    if (!file) {
      return reply.code(400).send({ error: 'file query param required', code: 'FILE_PARAM_REQUIRED' });
    }
    try {
      return await readParsedConfig(careerOpsRoot, file);
    } catch (err) {
      if (err instanceof ConfigReadError) {
        return reply.code(err.status).send({ error: err.message, code: err.code });
      }
      app.log.error({ err }, 'config-read failed');
      return reply.code(500).send({ error: 'read failed', detail: err.message });
    }
  });

  // -- 1. Status -----------------------------------------------------------
  app.get('/api/onboarding/status', async (req, reply) => {
    try {
      const snapshot = await getOnboardingStatus(careerOpsRoot);
      return snapshot;
    } catch (err) {
      app.log.error({ err }, 'onboarding status failed');
      return reply.code(500).send({ error: 'status check failed', detail: err.message });
    }
  });

  // -- 2. Parse-resume -----------------------------------------------------
  // Accepts BOTH multipart and JSON {text}. Spawns onboarding-cv job.
  app.post('/api/onboarding/parse-resume', { bodyLimit: MAX_JSON_TEXT_BYTES }, async (req, reply) => {
    if (jobs.hasActiveFor('onboarding-cv', 'current')) {
      return reply.code(409).send({ error: 'onboarding-cv job already running' });
    }

    let tmpPath;
    let originalName = 'pasted text';
    let kind = 'text';

    try {
      if (req.isMultipart()) {
        const result = await receiveUpload(req);
        tmpPath = result.tmpPath;
        originalName = result.originalName;
        kind = result.kind;
      } else {
        const parsed = parseResumeJsonSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply.code(422).send(zodToFieldErrors(parsed.error));
        }
        const text = validateAndNormalize(parsed.data.text);
        tmpPath = await stageText(text);
      }
    } catch (err) {
      if (err instanceof UploadError) {
        return reply.code(err.status).send({ error: err.message, code: err.code });
      }
      if (err instanceof TextOutOfRangeError) {
        return reply.code(422).send({ error: err.message, code: err.code });
      }
      app.log.error({ err }, 'parse-resume staging failed');
      return reply.code(500).send({ error: 'staging failed', detail: err.message });
    }

    // Spawn the onboarding-cv claude -p job.
    const label = `Onboarding · CV (${kind})`;
    const snapshot = jobs.spawnJob({
      kind: 'onboarding-cv',
      refKey: 'current',
      label,
      command: 'claude',
      args: ['-p', `/onboard-cv ${tmpPath}`, ...CLAUDE_BASE_FLAGS],
      cwd: careerOpsRoot,
      expectedCvImportedPath: `${careerOpsRoot}/cv-imported.md`,
      tmpPathToCleanup: tmpPath,
    });

    // Nest the snapshot under `job` to match the frontend type contract
    // (OnboardingParseJobResponse). Spreading would shadow `snapshot.kind`
    // ('onboarding-cv', the JobKind) with the file kind ('pdf' | 'docx' |
    // 'text'), which silently broke event filtering downstream.
    return reply.code(202).send({
      job: snapshot,
      stagedPath: 'cv-imported.md',
      sourceFile: originalName,
      fileKind: kind,
    });
  });

  // -- 3. Commit-cv --------------------------------------------------------
  app.post('/api/onboarding/commit-cv', async (req, reply) => {
    const parsed = commitCvSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send(zodToFieldErrors(parsed.error));
    }
    try {
      const result = await commitCv(careerOpsRoot, parsed.data.editedContent);
      return result;
    } catch (err) {
      if (err instanceof CommitCvShapeError) {
        return reply.code(422).send({ error: err.message, code: err.code, missing: err.missing });
      }
      if (err instanceof CommitCvNotStagedError) {
        return reply.code(400).send({ error: err.message, code: err.code });
      }
      app.log.error({ err }, 'commit-cv failed');
      return reply.code(500).send({ error: 'commit failed', detail: err.message });
    }
  });

  // -- 4. Profile ----------------------------------------------------------
  app.post('/api/onboarding/profile', async (req, reply) => {
    const parsed = profileYamlSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send(zodToFieldErrors(parsed.error));
    }
    try {
      return await writeProfileYaml(careerOpsRoot, parsed.data);
    } catch (err) {
      app.log.error({ err }, 'write profile failed');
      return reply.code(500).send({ error: 'write profile failed', detail: err.message });
    }
  });

  // -- 5. Customize profile.md --------------------------------------------
  app.post('/api/onboarding/customize-profile-md', async (req, reply) => {
    const parsed = profileMdSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send(zodToFieldErrors(parsed.error));
    }
    try {
      return await renderAndWriteProfileMd(careerOpsRoot, parsed.data);
    } catch (err) {
      app.log.error({ err }, 'write profile.md failed');
      return reply.code(500).send({ error: 'write profile.md failed', detail: err.message });
    }
  });

  // -- 6. Portals ---------------------------------------------------------
  app.post('/api/onboarding/portals', async (req, reply) => {
    const parsed = portalsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send(zodToFieldErrors(parsed.error));
    }
    try {
      return await writePortalsYaml(careerOpsRoot, parsed.data);
    } catch (err) {
      if (err instanceof PortalsTemplateMissingError) {
        return reply.code(500).send({ error: err.message, code: err.code });
      }
      app.log.error({ err }, 'write portals failed');
      return reply.code(500).send({ error: 'write portals failed', detail: err.message });
    }
  });

  // -- 7. Init tracker -----------------------------------------------------
  app.post('/api/onboarding/init-tracker', async (req, reply) => {
    const parsed = initTrackerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send(zodToFieldErrors(parsed.error));
    }
    try {
      return await initTracker(careerOpsRoot, parsed.data ?? {});
    } catch (err) {
      app.log.error({ err }, 'init tracker failed');
      return reply.code(500).send({ error: 'init tracker failed', detail: err.message });
    }
  });

  // -- 8. Skip onboarding --------------------------------------------------
  // One-shot bypass: stubs every required user-layer file from templates so
  // the user can edit them later via the Settings view. Idempotent — any
  // file that already exists is left alone (returned in `skipped`).
  app.post('/api/onboarding/skip', async (req, reply) => {
    try {
      return await skipOnboarding(careerOpsRoot);
    } catch (err) {
      app.log.error({ err }, 'skip onboarding failed');
      return reply.code(500).send({ error: 'skip failed', detail: err.message });
    }
  });

  // ---------------------------------------------------------------------
  // Cleanup hook: when an onboarding-cv job finalizes, unlink the staged
  // tmp file. We listen to the job manager's 'remove' event because that's
  // when the chip disappears - by then the disk artifact (cv-imported.md
  // or its absence) is canonical.
  // ---------------------------------------------------------------------
  // The JobManager doesn't expose tmpPathToCleanup back, so we keep our
  // own tracking here. (Alternatively we'd extend the manager - but the
  // manager type is shared; we instead leverage the spawnJob option we
  // pass through. See manager.mjs for the corresponding handling.)
  jobs.on('remove', async ({ id }) => {
    // The manager retains the tmpPath on the job until prune; if it's
    // there we unlink. We wrap in try/catch because the cleanup is
    // best-effort - the startup sweep will catch anything missed.
    try {
      const snapshots = jobs.list();
      void snapshots;
      // The job is no longer in the list at this point (remove fires
      // after deletion). The manager exposes `tmpPathByJobId` - see
      // the small extension in jobs/manager.mjs. If that's not present,
      // we just no-op.
      const cleanup = jobs.takeTmpPathToCleanup?.(id);
      if (cleanup) await unlink(cleanup);
    } catch {
      // ignore; cleanup.mjs sweep on next boot is the safety net.
    }
  });
}
