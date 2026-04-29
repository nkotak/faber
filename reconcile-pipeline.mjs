#!/usr/bin/env node

/**
 * reconcile-pipeline.mjs — one-shot: flip `- [ ]` → `- [x]` for any pending
 * row in `data/pipeline.md` whose URL matches an existing evaluated report.
 *
 * Use case: catches up on URLs that were evaluated before the post-eval
 * `markUrlEvaluated` hook landed (or any other path where the loop wasn't
 * closed). Single-pass: one read, one write, one `.bak` snapshot.
 *
 * Idempotent and additive: a row that's already `[x]` is silently skipped;
 * a URL that doesn't appear in pipeline.md is silently skipped. Only rows
 * that are CURRENTLY `[ ]` and whose URL has an evaluated report get flipped.
 *
 * Usage:
 *   node reconcile-pipeline.mjs              # apply (writes data/pipeline.md.bak first)
 *   node reconcile-pipeline.mjs --dry-run    # preview, write nothing
 *
 * Exit codes:
 *   0 — done (zero or more rows flipped)
 *   1 — fatal error
 */

import { readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, 'reports');
const PIPELINE_PATH = path.join(ROOT, 'data', 'pipeline.md');

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: false,
});

if (args.help) {
  console.log('Usage: node reconcile-pipeline.mjs [--dry-run]');
  process.exit(0);
}

const dryRun = args['dry-run'];

async function urlsFromReports() {
  if (!existsSync(REPORTS_DIR)) return [];
  const files = (await readdir(REPORTS_DIR)).filter((f) => f.endsWith('.md'));
  const out = [];
  for (const f of files) {
    const text = await readFile(path.join(REPORTS_DIR, f), 'utf-8');
    const m = text.match(/^\*\*URL:\*\*\s*(https?:\/\/\S+)/m);
    if (m) out.push({ url: m[1].trim(), report: f });
  }
  return out;
}

async function main() {
  if (!existsSync(PIPELINE_PATH)) {
    console.error('data/pipeline.md not found.');
    process.exit(1);
  }

  const reports = await urlsFromReports();
  if (reports.length === 0) {
    console.error('No reports found in ./reports/. Nothing to reconcile.');
    process.exit(0);
  }

  // Build URL → report-filename map for diagnostic output.
  const reportByUrl = new Map();
  for (const { url, report } of reports) {
    if (!reportByUrl.has(url)) reportByUrl.set(url, report);
  }

  // Single read → mutate in memory → single write.
  const text = await readFile(PIPELINE_PATH, 'utf-8');
  const lines = text.split('\n');
  const PENDING_RE = /^(\s*)-\s*\[\s*\]\s*(\S+)/;

  const flips = []; // {lineIdx, url, report}
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(PENDING_RE);
    if (!m) continue;
    const url = m[2];
    const report = reportByUrl.get(url);
    if (!report) continue;
    flips.push({ lineIdx: i, url, report });
  }

  console.error(
    `${reports.length} reports scanned · ${flips.length} pending row(s) match · ${dryRun ? 'DRY RUN' : 'flipping'}`,
  );

  for (const { lineIdx, url, report } of flips) {
    if (!dryRun) {
      lines[lineIdx] = lines[lineIdx].replace(/^(\s*)-\s*\[\s*\]/, '$1- [x]');
    }
    console.log(`${dryRun ? 'would flip' : '✓'} · ${report.padEnd(48)} → ${url}`);
  }

  if (flips.length === 0) {
    console.error('\nNothing to flip — pipeline.md is already in sync with reports/.');
    process.exit(0);
  }

  if (!dryRun) {
    await copyFile(PIPELINE_PATH, PIPELINE_PATH + '.bak');
    await writeFile(PIPELINE_PATH, lines.join('\n'), 'utf-8');
    console.error(`\n${flips.length} flipped · backup: ${PIPELINE_PATH}.bak`);
  } else {
    console.error(`\n${flips.length} would be flipped · re-run without --dry-run to apply`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
