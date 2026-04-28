// output-pdfs.mjs - scan output/ for cv-{NUM}-{slug}-{YYYY-MM-DD}.pdf.
// Port of Go ScanOutputPDFs + PDFPathForNumber. Keyed by REPORT number
// (not tracker row #) - these can drift when rows lack reports.

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const RE_OUTPUT_PDF = /^cv-(\d+)-.*\.pdf$/;
const RE_REPORT_FILENAME = /^\d+-(.+)-\d{4}-\d{2}-\d{2}\.md$/;

export async function scanOutputPDFs(careerOpsRoot) {
  const dir = path.join(careerOpsRoot, 'output');
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return { byReportNum: new Map(), dir };
  }

  const byReportNum = new Map();
  for (const name of entries) {
    const m = name.match(RE_OUTPUT_PDF);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isNaN(n)) continue;
    if (!byReportNum.has(n)) {
      byReportNum.set(n, path.join(dir, name));
    }
  }
  return { byReportNum, dir };
}

export async function scanInterviewPrep(careerOpsRoot) {
  const dir = path.join(careerOpsRoot, 'interview-prep');
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return { bySlug: new Set(), dir };
  }
  const bySlug = new Set();
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    if (name === 'story-bank.md') continue;
    bySlug.add(name.slice(0, -3));
  }
  return { bySlug, dir };
}

export function interviewPrepSlugForReport(reportPath) {
  const base = path.basename(reportPath);
  const m = base.match(RE_REPORT_FILENAME);
  return m ? m[1] : '';
}

export async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
