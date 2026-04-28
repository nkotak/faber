// routes/reports.mjs - read a single markdown report (or interview-prep file).

import { loadReport, loadInterviewPrep } from '../parsers/report.mjs';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

export function registerReportsRoutes(app, { careerOpsRoot }) {
  // GET /api/reports?path=reports/013-cohere-agent-harness-modelling-2026-04-21.md
  app.get('/api/reports', async (req, reply) => {
    const reportPath = String(req.query.path ?? '');
    if (!reportPath) return reply.code(400).send({ error: 'path query param required' });
    try {
      const { content } = await loadReport(careerOpsRoot, reportPath);
      return { content, path: reportPath };
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });

  // GET /api/interview-prep?slug=cohere-agent-harness-modelling
  app.get('/api/interview-prep', async (req, reply) => {
    const slug = String(req.query.slug ?? '');
    if (!slug) return reply.code(400).send({ error: 'slug query param required' });
    try {
      const { content } = await loadInterviewPrep(careerOpsRoot, slug);
      return { content, slug };
    } catch (err) {
      return reply.code(404).send({ error: err.message });
    }
  });

  // GET /api/pdf?num=13 - stream the PDF file directly.
  app.get('/api/pdf', async (req, reply) => {
    const num = parseInt(String(req.query.num ?? ''), 10);
    if (!Number.isFinite(num)) return reply.code(400).send({ error: 'num query param required' });

    // Re-scan every call; the set rarely grows mid-session but we want fresh truth.
    const { scanOutputPDFs } = await import('../parsers/output-pdfs.mjs');
    const { byReportNum } = await scanOutputPDFs(careerOpsRoot);
    const pdfPath = byReportNum.get(num);
    if (!pdfPath) return reply.code(404).send({ error: 'no PDF on disk for that report number' });

    const s = await stat(pdfPath);
    reply.header('content-type', 'application/pdf');
    reply.header('content-length', s.size);
    reply.header('content-disposition', `inline; filename="${path.basename(pdfPath)}"`);
    return reply.send(createReadStream(pdfPath));
  });
}
