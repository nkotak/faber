// applications.mjs - parse data/applications.md into an array of records.
//
// Port of dashboard/internal/data/career.go ParseApplications. The format is
// a GFM table with mixed pipe+tab delimiters in the wild. Headers are skipped
// by prefix match. Field order:
//
//   0: # (row id)
//   1: Date
//   2: Company
//   3: Role
//   4: Score (format "X.X/5")
//   5: Status
//   6: PDF marker (check / x)
//   7: Report link as markdown: [NUM](reports/...)
//   8: Notes (optional)
//
// Returns { applications, filePath } - filePath is the absolute path that
// was read, for use by writers that need to round-trip.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const RE_REPORT_LINK = /\[(\d+)\]\(([^)]+)\)/;
const RE_SCORE = /(\d+\.?\d*)\/5/;
const RE_URL = /^\*\*URL:\*\*\s*(https?:\/\/\S+)/m;
const RE_BATCH_ID = /^\*\*Batch ID:\*\*\s*(\d+)/m;
const RE_ARCHETYPE = /\*\*Arquetipo(?:\s+detectado)?\*\*\s*\|\s*(.+)/i;
const RE_TLDR_TABLE = /\*\*TL;DR\*\*\s*\|\s*(.+)/i;
const RE_TLDR_COLON = /\*\*TL;DR:\*\*\s*(.+)/i;
const RE_REMOTE = /\*\*Remote\*\*\s*\|\s*(.+)/i;
const RE_COMP = /\*\*Comp\*\*\s*\|\s*(.+)/i;

/** Find whichever applications.md exists. */
async function resolveApplicationsPath(careerOpsRoot) {
  const candidates = [
    path.join(careerOpsRoot, 'data', 'applications.md'),
    path.join(careerOpsRoot, 'applications.md'),
  ];
  for (const p of candidates) {
    try {
      await readFile(p, 'utf-8');
      return p;
    } catch {
      // next
    }
  }
  throw new Error(
    `Could not find applications.md in ${candidates.join(' or ')}`,
  );
}

function splitRow(line) {
  if (line.includes('\t')) {
    const trimmed = line.replace(/^\|/, '').trim();
    return trimmed.split('\t').map((s) => s.replace(/\|/g, '').trim());
  }
  const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((s) => s.trim());
}

/**
 * Parse the applications.md text into structured records.
 */
export function parseApplicationsText(text) {
  const out = [];
  let rowCounter = 0;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (
      line === '' ||
      line.startsWith('# ') ||
      line.startsWith('|---') ||
      line.startsWith('| #')
    ) {
      continue;
    }
    if (!line.startsWith('|')) continue;

    const fields = splitRow(line);
    if (fields.length < 8) continue;

    rowCounter++;
    const number = parseInt(fields[0], 10) || rowCounter;
    const hasPDF = fields[6].includes('\u2705');

    const scoreMatch = fields[4].match(RE_SCORE);
    const app = {
      number,
      date: fields[1],
      company: fields[2],
      role: fields[3],
      scoreRaw: fields[4],
      score: scoreMatch ? parseFloat(scoreMatch[1]) : 0,
      status: fields[5],
      hasPDF,
      reportPath: '',
      reportNumber: '',
      notes: fields.length > 8 ? fields[8] : '',
      jobURL: '',
      archetype: '',
      tlDr: '',
      remote: '',
      compEstimate: '',
    };

    const linkMatch = fields[7].match(RE_REPORT_LINK);
    if (linkMatch) {
      app.reportNumber = linkMatch[1];
      app.reportPath = linkMatch[2];
    }

    out.push(app);
  }

  return out;
}

/** Derive report number as int (leading zeros dropped). */
export function reportNum(app) {
  return app.reportNumber ? parseInt(app.reportNumber, 10) || 0 : 0;
}

/**
 * Enrich applications with header-extracted fields from their reports.
 */
export async function enrichApplications(careerOpsRoot, apps) {
  for (const app of apps) {
    if (!app.reportPath) continue;
    const fullReport = path.join(careerOpsRoot, app.reportPath);
    try {
      const reportContent = await readFile(fullReport, 'utf-8');
      const header = reportContent.slice(0, 2000);

      const urlMatch = header.match(RE_URL);
      if (urlMatch) app.jobURL = urlMatch[1];

      const batchMatch = header.match(RE_BATCH_ID);
      if (batchMatch && !app.jobURL) app.batchId = batchMatch[1];

      const archetype = header.match(RE_ARCHETYPE);
      if (archetype) app.archetype = archetype[1].replace(/\|/g, '').trim();

      const tldr = header.match(RE_TLDR_TABLE) ?? header.match(RE_TLDR_COLON);
      if (tldr) {
        let v = tldr[1].replace(/\|/g, '').trim();
        if (v.length > 140) v = v.slice(0, 137) + '...';
        app.tlDr = v;
      }

      const remote = header.match(RE_REMOTE);
      if (remote) app.remote = remote[1].replace(/\|/g, '').trim();

      const comp = header.match(RE_COMP);
      if (comp) app.compEstimate = comp[1].replace(/\|/g, '').trim();
    } catch {
      // report unreadable - leave enrichment fields empty
    }
  }
  return apps;
}

/**
 * Full parse entry point. Locates applications.md, reads it, parses rows,
 * enriches with report-header fields.
 */
export async function loadApplications(careerOpsRoot) {
  const filePath = await resolveApplicationsPath(careerOpsRoot);
  const text = await readFile(filePath, 'utf-8');
  const apps = parseApplicationsText(text);
  await enrichApplications(careerOpsRoot, apps);
  return { applications: apps, filePath };
}

// === Status normalization (mirrors Go NormalizeStatus) =====================

const STATUS_ALIASES = [
  { canonical: 'skip', tests: [(s) => /no aplicar|no_aplicar|geo blocker/.test(s), (s) => s === 'skip'] },
  { canonical: 'interview', tests: [(s) => /interview|entrevista/.test(s)] },
  { canonical: 'offer', tests: [(s) => s === 'offer' || /oferta/.test(s)] },
  { canonical: 'responded', tests: [(s) => /responded|respondido/.test(s)] },
  { canonical: 'applied', tests: [(s) => /applied|aplicado/.test(s) || ['enviada', 'aplicada', 'sent'].includes(s)] },
  { canonical: 'rejected', tests: [(s) => /rejected|rechazado/.test(s) || s === 'rechazada'] },
  { canonical: 'discarded', tests: [(s) => /discarded|descartado/.test(s) || ['descartada', 'cerrada', 'cancelada'].includes(s) || s.startsWith('duplicado') || s.startsWith('dup')] },
  { canonical: 'evaluated', tests: [(s) => /evaluated|evaluada/.test(s) || ['condicional', 'hold', 'monitor', 'evaluar', 'verificar'].includes(s)] },
];

/** Normalize raw status text to canonical token. */
export function normalizeStatus(raw) {
  let s = String(raw ?? '').replace(/\*\*/g, '');
  s = s.trim().toLowerCase();
  const dateIdx = s.indexOf(' 202');
  if (dateIdx > 0) s = s.slice(0, dateIdx).trim();

  for (const { canonical, tests } of STATUS_ALIASES) {
    if (tests.some((t) => t(s))) return canonical;
  }
  return s;
}

const STATUS_PRIORITY = {
  interview: 0,
  offer: 1,
  responded: 2,
  applied: 3,
  evaluated: 4,
  skip: 5,
  rejected: 6,
  discarded: 7,
};

export function statusPriority(status) {
  const n = normalizeStatus(status);
  return STATUS_PRIORITY[n] ?? 8;
}
