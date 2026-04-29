// routes/cleanup.mjs - spawn cleanup-dead-jobs.mjs and cleanup-region-mismatch.mjs
// as background jobs, exposed at /api/cleanup/*. Reuses the JobManager so progress
// streams via the same SSE event flow that powers the rest of the dashboard.
//
// Both endpoints accept { dryRun: boolean = true } in the body. Default is dryRun
// because clobbering applications.md / pipeline.md is destructive — the UI runs
// dry-run first, shows the user the diff, then re-issues with dryRun: false.
//
// Refkey is 'current' for both cleanup kinds — only one cleanup of each kind
// can run at a time.

import path from 'node:path';

const NODE_BIN = process.execPath; // current node binary, avoids PATH issues

export function registerCleanupRoutes(app, { careerOpsRoot, jobs }) {
  // GET /api/cleanup/status - returns whether either cleanup is currently running.
  app.get('/api/cleanup/status', async () => ({
    deadRunning: jobs.hasActiveFor('cleanup-dead', 'current'),
    regionRunning: jobs.hasActiveFor('cleanup-region', 'current'),
  }));

  // POST /api/cleanup/dead  { dryRun?: boolean, limit?: number }
  app.post('/api/cleanup/dead', async (req, reply) => {
    const body = req.body ?? {};
    const dryRun = body.dryRun !== false; // default true
    const limit = Number.isFinite(body.limit) ? Math.max(1, Math.min(500, body.limit)) : 0;

    if (jobs.hasActiveFor('cleanup-dead', 'current')) {
      return reply.code(409).send({ error: 'cleanup-dead already running' });
    }

    const args = [
      path.join(careerOpsRoot, 'cleanup-dead-jobs.mjs'),
      '--verbose',
    ];
    if (dryRun) args.push('--dry-run');
    if (limit > 0) args.push(`--limit=${limit}`);

    const label = dryRun ? 'Cleanup dead · dry-run' : 'Cleanup dead · APPLY';
    const snapshot = jobs.spawnJob({
      kind: 'cleanup-dead',
      refKey: 'current',
      label,
      command: NODE_BIN,
      args,
      cwd: careerOpsRoot,
      // cleanup-dead-jobs.mjs intentionally exits 2 from --dry-run when
      // proposed changes exist (CI-style signal). Treat both 0 and 2 as
      // success so the modal advances to the "reviewing" stage.
      successExitCodes: [0, 2],
    });
    return snapshot;
  });

  // POST /api/cleanup/region  { dryRun?: boolean }
  app.post('/api/cleanup/region', async (req, reply) => {
    const body = req.body ?? {};
    const dryRun = body.dryRun !== false; // default true

    if (jobs.hasActiveFor('cleanup-region', 'current')) {
      return reply.code(409).send({ error: 'cleanup-region already running' });
    }

    const args = [
      path.join(careerOpsRoot, 'cleanup-region-mismatch.mjs'),
      '--verbose',
    ];
    if (dryRun) args.push('--dry-run');

    const label = dryRun ? 'Cleanup region · dry-run' : 'Cleanup region · APPLY';
    const snapshot = jobs.spawnJob({
      kind: 'cleanup-region',
      refKey: 'current',
      label,
      command: NODE_BIN,
      args,
      cwd: careerOpsRoot,
      // Same exit-2-as-success contract as cleanup-dead.
      successExitCodes: [0, 2],
    });
    return snapshot;
  });
}
