// routes/applications.mjs - GET applications + pending + PDF-on-disk + PATCH status.

import { loadApplications, reportNum, normalizeStatus, statusPriority } from '../parsers/applications.mjs';
import { loadPipelinePending } from '../parsers/pipeline.mjs';
import { loadLivenessCache } from '../parsers/liveness-cache.mjs';
import { scanOutputPDFs, scanInterviewPrep, interviewPrepSlugForReport } from '../parsers/output-pdfs.mjs';
import { updateApplicationStatus } from '../writers/applications.mjs';

// Canonical status set (mirrors templates/states.yml).
const CANONICAL_STATUSES = [
  'Evaluated',
  'Applied',
  'Responded',
  'Interview',
  'Offer',
  'Rejected',
  'Discarded',
  'SKIP',
];

/**
 * Register the applications routes on a Fastify instance.
 * The careerOpsRoot is captured in the closures so every route works
 * against the same project on disk.
 */
export function registerApplicationsRoutes(app, { careerOpsRoot, state }) {
  // GET /api/applications - the whole dashboard state for the pipeline view.
  app.get('/api/applications', async () => {
    const [appsResult, pendingResult, pdfs, prep, liveness] = await Promise.all([
      loadApplications(careerOpsRoot),
      loadPipelinePending(careerOpsRoot),
      scanOutputPDFs(careerOpsRoot),
      scanInterviewPrep(careerOpsRoot),
      loadLivenessCache(careerOpsRoot),
    ]);

    // Attach a `liveness` field to each pending row when the URL has a cache
    // entry. Rows without a cache entry simply omit the field (no UI badge).
    const pendingWithLiveness = pendingResult.pending.map((p) => {
      const entry = liveness.get(p.url);
      if (!entry) return p;
      return {
        ...p,
        liveness: {
          lastChecked: entry.lastChecked,
          lastResult: entry.lastResult,
          consecutiveFailures: entry.consecutiveFailures,
        },
      };
    });

    // Stamp each application with derived fields the UI needs:
    //   - canonicalStatus (lowercase normalized)
    //   - statusRank (for default sort by status priority)
    //   - pdfOnDisk (keyed by report number, not row number)
    //   - hasInterviewPrep (based on report slug)
    const applications = appsResult.applications.map((a) => {
      const rn = reportNum(a);
      const slug = interviewPrepSlugForReport(a.reportPath);
      return {
        ...a,
        reportNumInt: rn,
        canonicalStatus: normalizeStatus(a.status),
        statusRank: statusPriority(a.status),
        pdfOnDisk: rn > 0 && pdfs.byReportNum.has(rn),
        pdfPath: rn > 0 ? pdfs.byReportNum.get(rn) ?? '' : '',
        interviewPrepSlug: slug,
        hasInterviewPrep: slug ? prep.bySlug.has(slug) : false,
      };
    });

    // Cache the applications path so the writer can round-trip.
    state.applicationsFilePath = appsResult.filePath;

    return {
      applications,
      pending: pendingWithLiveness,
      canonicalStatuses: CANONICAL_STATUSES,
      meta: {
        total: applications.length,
        withPDF: applications.filter((a) => a.hasPDF).length,
        pendingCount: pendingWithLiveness.length,
        topScore: applications.reduce((m, a) => Math.max(m, a.score), 0),
        avgScore: (() => {
          const scored = applications.filter((a) => a.score > 0);
          if (!scored.length) return 0;
          return scored.reduce((s, a) => s + a.score, 0) / scored.length;
        })(),
        byStatus: applications.reduce((acc, a) => {
          acc[a.canonicalStatus] = (acc[a.canonicalStatus] ?? 0) + 1;
          return acc;
        }, {}),
      },
    };
  });

  // PATCH /api/applications/:reportNumber/status - atomic mutation.
  app.patch('/api/applications/:reportNumber/status', async (req, reply) => {
    const { reportNumber } = req.params;
    const { status } = req.body ?? {};
    if (!status || typeof status !== 'string') {
      return reply.code(400).send({ error: 'status required' });
    }
    if (!CANONICAL_STATUSES.includes(status)) {
      return reply.code(400).send({ error: `status must be one of ${CANONICAL_STATUSES.join(', ')}` });
    }
    if (!state.applicationsFilePath) {
      // Prime the cache by loading once.
      const { filePath } = await loadApplications(careerOpsRoot);
      state.applicationsFilePath = filePath;
    }

    try {
      const result = await updateApplicationStatus(
        state.applicationsFilePath,
        reportNumber,
        status,
      );
      return result;
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });
}
