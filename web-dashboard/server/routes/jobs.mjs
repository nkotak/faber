// routes/jobs.mjs - spawn and manage background jobs (PDF, eval, interview-prep).
//
// Commands invoked match the Go TUI's internal/jobs package exactly:
//   - PDF:  claude -p "/faber pdf <reportPath>"
//           --output-format stream-json --verbose
//           --permission-mode=bypassPermissions
//
// The --permission-mode flag is LOAD-BEARING. Without it, `claude -p` runs
// in restricted mode and silently denies Write and Bash tool invocations -
// the /faber pdf skill cannot write /tmp/cv-candidate-*.html or invoke
// generate-pdf.mjs, so no PDF is ever produced. The process exits 0 with
// a text response, which looks like success but is silent failure.
//
// The --output-format + --verbose pair is how stream-json events flow back
// to the job manager for live progress chips.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { loadApplications, reportNum } from '../parsers/applications.mjs';
import { markUrlEvaluated } from '../writers/pipeline-flipper.mjs';

const execFileAsync = promisify(execFile);

const CLAUDE_BASE_FLAGS = [
  '--output-format', 'stream-json',
  '--verbose',
  '--permission-mode=bypassPermissions',
];

export function registerJobsRoutes(app, { careerOpsRoot, jobs }) {
  // GET /api/jobs - active job snapshot for page hydration.
  app.get('/api/jobs', async () => ({ jobs: jobs.list() }));

  // POST /api/jobs/pdf  { reportNumber }
  app.post('/api/jobs/pdf', async (req, reply) => {
    const { reportNumber } = req.body ?? {};
    if (!reportNumber) return reply.code(400).send({ error: 'reportNumber required' });

    const { applications } = await loadApplications(careerOpsRoot);
    const target = applications.find((a) => a.reportNumber === String(reportNumber));
    if (!target) return reply.code(404).send({ error: 'application not found' });
    if (!target.reportPath) return reply.code(400).send({ error: 'application has no report' });

    const refKey = String(reportNum(target));
    if (jobs.hasActiveFor('pdf', refKey)) {
      return reply.code(409).send({ error: 'pdf job already running for this application' });
    }

    const label = `${target.company} \u00b7 PDF`;
    const snapshot = jobs.spawnJob({
      kind: 'pdf',
      refKey,
      label,
      command: 'claude',
      args: ['-p', `/faber pdf ${target.reportPath}`, ...CLAUDE_BASE_FLAGS],
      cwd: careerOpsRoot,
      expectedPdfReportNum: reportNum(target),
    });
    return snapshot;
  });

  // POST /api/jobs/eval  { url }
  app.post('/api/jobs/eval', async (req, reply) => {
    const { url } = req.body ?? {};
    if (!url || typeof url !== 'string') return reply.code(400).send({ error: 'url required' });
    if (!/^(https?:|local:)/.test(url)) return reply.code(400).send({ error: 'url must be http/https/local' });

    if (jobs.hasActiveFor('eval', url)) {
      return reply.code(409).send({ error: 'eval job already running for this URL' });
    }

    const label = `Eval \u00b7 ${url.replace(/^https?:\/\//, '').slice(0, 40)}`;
    const snapshot = jobs.spawnJob({
      kind: 'eval',
      refKey: url,
      label,
      command: 'claude',
      // /faber offer = report + score + tracker, NO PDF. PDF stays a
      // separate, explicit action via the per-row PDF button. The full
      // /faber {url} (auto-pipeline) flow is reserved for the slash command
      // outside the dashboard.
      args: ['-p', `/faber offer ${url}`, ...CLAUDE_BASE_FLAGS],
      cwd: careerOpsRoot,
      // Post-success: (1) flip the matching - [ ] row in data/pipeline.md
      // to - [x] so the URL leaves the queue, then (2) merge any pending
      // tracker TSVs the eval wrote into applications.md. Without (2) the
      // user sees a successful eval but no entry in the apps list — claude
      // writes the TSV to batch/tracker-additions/, which is meaningless
      // until merge-tracker.mjs picks it up. Failure of either step is
      // logged but doesn't change the job's reported success.
      onSuccess: async () => {
        await markUrlEvaluated(careerOpsRoot, url);
        await runMergeTracker(careerOpsRoot);
      },
    });
    return snapshot;
  });

  // POST /api/jobs/interview-prep  { reportNumber }
  app.post('/api/jobs/interview-prep', async (req, reply) => {
    const { reportNumber } = req.body ?? {};
    if (!reportNumber) return reply.code(400).send({ error: 'reportNumber required' });

    const { applications } = await loadApplications(careerOpsRoot);
    const target = applications.find((a) => a.reportNumber === String(reportNumber));
    if (!target) return reply.code(404).send({ error: 'application not found' });
    if (!target.reportPath) return reply.code(400).send({ error: 'application has no report' });

    const refKey = String(reportNum(target));
    if (jobs.hasActiveFor('interview-prep', refKey)) {
      return reply.code(409).send({ error: 'prep job already running for this application' });
    }

    const label = `${target.company} \u00b7 Prep`;
    const snapshot = jobs.spawnJob({
      kind: 'interview-prep',
      refKey,
      label,
      command: 'claude',
      args: ['-p', `/faber prep ${target.reportPath}`, ...CLAUDE_BASE_FLAGS],
      cwd: careerOpsRoot,
    });
    return snapshot;
  });

  // POST /api/jobs/:id/cancel
  app.post('/api/jobs/:id/cancel', async (req, reply) => {
    const { id } = req.params;
    const ok = jobs.cancel(id);
    if (!ok) return reply.code(404).send({ error: 'no running job with that id' });
    return { ok: true };
  });
}

/**
 * Run `node merge-tracker.mjs` from the project root. Idempotent — when the
 * additions directory is empty, the script is a clean no-op. Errors are
 * caught at the call site (the JobManager onSuccess hook wraps in try/catch).
 */
async function runMergeTracker(careerOpsRoot) {
  const script = path.join(careerOpsRoot, 'merge-tracker.mjs');
  await execFileAsync(process.execPath, [script], {
    cwd: careerOpsRoot,
    timeout: 30_000, // merge is fast; 30s is generous
  });
}
