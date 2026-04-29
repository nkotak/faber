#!/usr/bin/env node

/**
 * cleanup-dead-jobs.mjs — Two-strikes liveness sweep for applications.md + pipeline.md.
 *
 * Walks both data files, extracts URLs (from report headers for evaluated apps,
 * inline for pending pipeline rows), checks liveness, and marks confirmed-
 * expired entries as `Discarded` (apps) or flips to `[!]` (pipeline).
 *
 * Two-tier liveness:
 *   tier-1: ATS public APIs (Greenhouse/Ashby/Lever). One board fetch per
 *           {platform, slug} group; URLs whose id is in the board are 'active',
 *           ids missing from the board are 'expired'. ~200ms per board, no
 *           browser. Resolves the majority of URLs in most pipelines.
 *   tier-2: Playwright (check-liveness.mjs). Used for non-ATS URLs (Workable,
 *           custom careers pages) and any ATS group whose board fetch fails.
 *
 * Two-strikes confidence model: a URL must fail liveness in TWO consecutive
 * runs before its status changes. Failures are tracked in data/liveness-cache.tsv.
 *
 * Usage:
 *   node cleanup-dead-jobs.mjs                          # full run, all scopes
 *   node cleanup-dead-jobs.mjs --dry-run                # preview, write nothing
 *   node cleanup-dead-jobs.mjs --scope=apps             # apps only
 *   node cleanup-dead-jobs.mjs --scope=pipeline         # pipeline only
 *   node cleanup-dead-jobs.mjs --concurrency=4          # parallel browser contexts
 *   node cleanup-dead-jobs.mjs --max-age=7              # skip URLs cached <N days ago
 *   node cleanup-dead-jobs.mjs --limit=50               # check only first N candidates
 *   node cleanup-dead-jobs.mjs --no-cache               # ignore liveness-cache.tsv
 *
 * Exit codes:
 *   0 — clean run, no errors (may include marked-dead entries)
 *   1 — fatal error during run
 *   2 — dry-run with proposed changes (CI signal)
 */

import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { checkUrl } from './check-liveness.mjs';
import { classifyAtsUrl, fetchAtsBoard, indexBoardByJobId } from './lib/ats-clients.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    scope: { type: 'string', default: 'all' },
    concurrency: { type: 'string', default: '8' },
    'max-age': { type: 'string', default: '7' },
    limit: { type: 'string', default: '0' },
    'no-cache': { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: false,
});

if (args.help) {
  console.log(`Usage: node cleanup-dead-jobs.mjs [options]

Options:
  --dry-run            Preview changes; write nothing
  --scope=apps|pipeline|all   (default: all)
  --concurrency=N      Parallel browser contexts (default: 8)
  --max-age=DAYS       Skip URLs checked more recently than this (default: 7)
  --limit=N            Check only first N candidates (oldest first; 0 = no limit)
  --no-cache           Ignore liveness-cache.tsv
  --verbose            Per-URL output
  --help

Exit: 0 on success, 1 on fatal error, 2 on dry-run with proposed changes`);
  process.exit(0);
}

const dryRun = args['dry-run'];
const scope = args.scope; // apps | pipeline | all
const concurrency = Math.max(1, parseInt(args.concurrency, 10) || 4);
const maxAgeDays = Math.max(0, parseInt(args['max-age'], 10) || 7);
const limit = Math.max(0, parseInt(args.limit, 10) || 0);
const useCache = !args['no-cache'];
const verbose = args.verbose;

const APPS_PATH = join(ROOT, 'data', 'applications.md');
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');
const CACHE_PATH = join(ROOT, 'data', 'liveness-cache.tsv');
const REPORTS_DIR = join(ROOT, 'reports');

// Statuses we never re-check (active conversations + already-terminal)
const TERMINAL_STATUSES = new Set([
  'rejected',
  'offer',
  'interview',
  'responded',
  'discarded',
  'skip',
]);

const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Liveness cache
// ---------------------------------------------------------------------------

/**
 * Cache schema (TSV):
 *   url \t last_checked (YYYY-MM-DD) \t last_result \t consecutive_failures \t reason
 */
function loadCache() {
  if (!useCache || !existsSync(CACHE_PATH)) return new Map();
  const text = readFileSync(CACHE_PATH, 'utf-8');
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const fields = line.split('\t');
    if (fields.length < 4) continue;
    const [url, last_checked, last_result, consecutive_failures, reason = ''] = fields;
    map.set(url, {
      last_checked,
      last_result,
      consecutive_failures: parseInt(consecutive_failures, 10) || 0,
      reason,
    });
  }
  return map;
}

async function saveCache(cache) {
  if (dryRun) return;
  const lines = ['# url\tlast_checked\tlast_result\tconsecutive_failures\treason'];
  for (const [url, entry] of cache) {
    lines.push([url, entry.last_checked, entry.last_result, entry.consecutive_failures, entry.reason].join('\t'));
  }
  await writeFile(CACHE_PATH, lines.join('\n') + '\n', 'utf-8');
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Walk applications.md, extract URLs from linked reports.
 * Returns array of { source, lineIdx, url, currentStatus, appNum, reportPath, company, role }.
 */
async function discoverFromApps() {
  if (!existsSync(APPS_PATH)) return [];
  const text = await readFile(APPS_PATH, 'utf-8');
  const lines = text.split('\n');
  const records = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue; // header separator
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 10) continue; // pipe-padded row has 10 fields including leading/trailing empty
    // | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
    const [, num, , company, role, , status, , reportCell, ] = cells;
    if (!num || !/^\d+$/.test(num)) continue; // skip header row
    const statusLower = (status || '').trim().toLowerCase();
    if (TERMINAL_STATUSES.has(statusLower)) continue;

    // Report cell: [NUM](reports/...md)
    const reportMatch = reportCell.match(/\[\d+\]\(([^)]+\.md)\)/);
    if (!reportMatch) continue;
    const reportPath = join(ROOT, reportMatch[1]);
    if (!existsSync(reportPath)) continue;

    const reportText = await readFile(reportPath, 'utf-8');
    const urlMatch = reportText.match(/^\*\*URL:\*\*\s*(https?:\/\/\S+)/m);
    if (!urlMatch) continue;
    const url = urlMatch[1].trim();
    if (url.startsWith('local:')) continue; // local JD files don't 404

    records.push({
      source: 'applications',
      lineIdx: i,
      url,
      currentStatus: status,
      appNum: parseInt(num, 10),
      reportPath,
      company,
      role,
    });
  }
  return records;
}

/**
 * Walk pipeline.md, find pending `[ ]` rows. Skip `[x]` (already evaluated, covered by apps walk)
 * and `[!]` (already error-marked) by default.
 * Returns array of { source, lineIdx, url, company, role, location? }.
 */
async function discoverFromPipeline() {
  if (!existsSync(PIPELINE_PATH)) return [];
  const text = await readFile(PIPELINE_PATH, 'utf-8');
  const lines = text.split('\n');
  const records = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^- \[ \]\s+(\S+)\s*\|\s*(.+)$/);
    if (!m) continue;
    const url = m[1];
    if (url.startsWith('local:')) continue;
    const fields = m[2].split('|').map((s) => s.trim());
    const company = fields[0] || '';
    const role = fields[1] || '';
    const location = fields[2] || '';

    records.push({
      source: 'pipeline-pending',
      lineIdx: i,
      url,
      company,
      role,
      location,
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Tier-1: ATS board-membership check
//
// Groups records by {platform, slug}, fetches each board once, and returns
// per-record verdicts based on whether the URL's id is in the active board.
// Records that aren't on any supported ATS — or whose board fetch failed —
// are returned as `unclassified` for tier-2 (Playwright) to handle.
// ---------------------------------------------------------------------------

async function tier1AtsCheck(records) {
  const verdicts = new Map(); // url → { result, reason }
  const unclassified = [];

  // Group records by {platform, slug}; non-ATS URLs go straight to tier-2.
  const groups = new Map(); // key 'platform:slug' → { platform, slug, records, ids: [] }
  const classifications = new Map(); // url → { platform, slug, id }
  for (const rec of records) {
    const cls = classifyAtsUrl(rec.url);
    if (!cls) {
      unclassified.push(rec);
      continue;
    }
    classifications.set(rec.url, cls);
    const key = `${cls.platform}:${cls.slug}`;
    if (!groups.has(key)) {
      groups.set(key, { platform: cls.platform, slug: cls.slug, records: [] });
    }
    groups.get(key).records.push(rec);
  }

  if (groups.size === 0) {
    return { verdicts, unclassified };
  }

  // Fetch each board in parallel. Memoized: one HTTP call per slug, regardless
  // of how many records reference jobs in that board.
  await Promise.all(
    [...groups.values()].map(async (g) => {
      try {
        const raw = await fetchAtsBoard({ platform: g.platform, slug: g.slug });
        const ids = indexBoardByJobId(raw, g.platform);
        let active = 0;
        let expired = 0;
        for (const rec of g.records) {
          const cls = classifications.get(rec.url);
          const id = cls.id;
          if (ids.has(id)) {
            verdicts.set(rec.url, {
              result: 'active',
              reason: `tier-1 ${g.platform}/${g.slug}: id ${id} present on board`,
            });
            active++;
          } else {
            verdicts.set(rec.url, {
              result: 'expired',
              reason: `tier-1 ${g.platform}/${g.slug}: id ${id} not on board (${ids.size} active jobs)`,
            });
            expired++;
          }
        }
        if (verbose) {
          process.stderr.write(
            `tier-1 ${g.platform}/${g.slug}: ${ids.size} active jobs, ${active} ours match, ${expired} missing\n`,
          );
        }
      } catch (err) {
        // Board fetch failed — fall through to tier-2 for this group.
        if (verbose) {
          process.stderr.write(
            `tier-1 ${g.platform}/${g.slug}: board fetch failed (${err.message}); falling back to Playwright for ${g.records.length} record(s)\n`,
          );
        }
        for (const rec of g.records) unclassified.push(rec);
      }
    }),
  );

  return { verdicts, unclassified };
}

// ---------------------------------------------------------------------------
// Tier-2: Playwright (concurrent with shared browser, separate contexts)
// ---------------------------------------------------------------------------

async function checkAll(records, browser) {
  const results = new Map(); // url → { result, reason }
  let idx = 0;
  let done = 0;
  const total = records.length;

  async function worker() {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    while (idx < records.length) {
      const myIdx = idx++;
      const rec = records[myIdx];
      const r = await checkUrl(page, rec.url);

      // Treat transient navigation errors as 'uncertain' rather than 'expired'
      // (don't punish flaky network with confidence increment)
      if (r.result === 'expired' && /navigation error|timeout/i.test(r.reason)) {
        r.result = 'uncertain';
      }

      results.set(rec.url, r);
      done++;
      if (verbose) {
        const icon = { active: '✅', expired: '❌', uncertain: '⚠️' }[r.result] || '?';
        process.stderr.write(`${icon} [${done}/${total}] ${rec.url}\n`);
        if (r.result !== 'active') process.stderr.write(`     ${r.reason}\n`);
      } else if (done % 10 === 0 || done === total) {
        process.stderr.write(`\rchecked ${done}/${total}`);
      }
    }
    await ctx.close();
  }

  const workers = Array.from({ length: Math.min(concurrency, records.length) }, () => worker());
  await Promise.all(workers);
  if (!verbose) process.stderr.write('\n');
  return results;
}

// ---------------------------------------------------------------------------
// Apply changes
// ---------------------------------------------------------------------------

async function applyAppChanges(records, results, cache) {
  const text = await readFile(APPS_PATH, 'utf-8');
  const lines = text.split('\n');
  let changes = 0;
  const tentative = [];

  for (const rec of records) {
    const r = results.get(rec.url);
    if (!r || r.result === 'active') continue;
    if (r.result === 'uncertain') continue; // never mark uncertain

    // Increment failure counter
    const cached = cache.get(rec.url) ?? { consecutive_failures: 0 };
    const failures = cached.consecutive_failures + 1;
    cache.set(rec.url, {
      last_checked: TODAY,
      last_result: r.result,
      consecutive_failures: failures,
      reason: r.reason,
    });

    if (failures < 2) {
      tentative.push(rec);
      continue;
    }

    // Two-strikes met — flip status to Discarded
    const line = lines[rec.lineIdx];
    const cells = line.split('|');
    if (cells.length < 10) continue;
    cells[6] = ' Discarded ';
    const noteFragment = `URL 404 verified ${TODAY}`;
    const existingNote = cells[9].trim();
    cells[9] = ' ' + (existingNote ? `${existingNote}. ${noteFragment}` : noteFragment) + ' ';
    lines[rec.lineIdx] = cells.join('|');
    changes++;
    if (verbose) console.error(`  applications.md #${rec.appNum} (${rec.company}) → Discarded`);
  }

  if (changes > 0 && !dryRun) {
    await copyFile(APPS_PATH, APPS_PATH + '.bak');
    await writeFile(APPS_PATH, lines.join('\n'), 'utf-8');
  }
  return { changes, tentative: tentative.length };
}

async function applyPipelineChanges(records, results, cache) {
  const text = await readFile(PIPELINE_PATH, 'utf-8');
  const lines = text.split('\n');
  let changes = 0;
  const tentative = [];

  for (const rec of records) {
    const r = results.get(rec.url);
    if (!r || r.result === 'active') continue;
    if (r.result === 'uncertain') continue;

    const cached = cache.get(rec.url) ?? { consecutive_failures: 0 };
    const failures = cached.consecutive_failures + 1;
    cache.set(rec.url, {
      last_checked: TODAY,
      last_result: r.result,
      consecutive_failures: failures,
      reason: r.reason,
    });

    if (failures < 2) {
      tentative.push(rec);
      continue;
    }

    // Flip [ ] → [!]
    const line = lines[rec.lineIdx];
    lines[rec.lineIdx] = line.replace(/^- \[ \]/, '- [!]') + ` — URL 404 verified ${TODAY}`;
    changes++;
    if (verbose) console.error(`  pipeline.md L${rec.lineIdx + 1} (${rec.company}) → [!]`);
  }

  if (changes > 0 && !dryRun) {
    await copyFile(PIPELINE_PATH, PIPELINE_PATH + '.bak');
    await writeFile(PIPELINE_PATH, lines.join('\n'), 'utf-8');
  }
  return { changes, tentative: tentative.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.error(`📊 Cleanup Dead Jobs ${dryRun ? '— DRY RUN' : ''}`);
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const cache = loadCache();
  console.error(`liveness-cache.tsv: ${cache.size} entries${useCache ? '' : ' (ignored, --no-cache)'}`);

  let appRecords = [];
  let pipelineRecords = [];
  if (scope === 'apps' || scope === 'all') {
    appRecords = await discoverFromApps();
  }
  if (scope === 'pipeline' || scope === 'all') {
    pipelineRecords = await discoverFromPipeline();
  }

  const allRecords = [...appRecords, ...pipelineRecords];
  console.error(`Discovered: ${appRecords.length} apps, ${pipelineRecords.length} pending pipeline (total ${allRecords.length})`);

  // Skip URLs cached as 'active' within max-age
  const checkable = [];
  let skippedCached = 0;
  for (const rec of allRecords) {
    const cached = cache.get(rec.url);
    if (cached && cached.last_result === 'active' && daysSince(cached.last_checked) < maxAgeDays) {
      skippedCached++;
      continue;
    }
    checkable.push(rec);
  }
  console.error(`Skipping ${skippedCached} URLs cached as active within ${maxAgeDays} days`);

  // Apply --limit (oldest-first; here just first-N which approximates)
  const toCheck = limit > 0 ? checkable.slice(0, limit) : checkable;
  console.error(`Checking ${toCheck.length} URL(s) with concurrency=${concurrency}\n`);

  if (toCheck.length === 0) {
    console.error('Nothing to check. Done.');
    process.exit(0);
  }

  // Tier-1: cheap ATS board-membership check (one HTTP call per slug).
  const { verdicts: tier1Verdicts, unclassified } = await tier1AtsCheck(toCheck);
  console.error(
    `tier-1 (ATS API): ${tier1Verdicts.size} resolved, ${unclassified.length} fall through to tier-2 (Playwright)`,
  );

  // Tier-2: Playwright fallback for non-ATS URLs and tier-1 failures.
  let tier2Verdicts = new Map();
  if (unclassified.length > 0) {
    const browser = await chromium.launch({ headless: true });
    try {
      tier2Verdicts = await checkAll(unclassified, browser);
    } finally {
      await browser.close();
    }
  }

  // Merge results from both tiers; tier-1 wins on overlap (it shouldn't overlap
  // because unclassified is mutually exclusive with verdicts.keys()).
  const results = new Map([...tier1Verdicts, ...tier2Verdicts]);

  // Tally
  let active = 0, expired = 0, uncertain = 0;
  for (const [, r] of results) {
    if (r.result === 'active') active++;
    else if (r.result === 'expired') expired++;
    else uncertain++;
  }

  // Reset failure counters for URLs that came back active
  for (const rec of toCheck) {
    const r = results.get(rec.url);
    if (r?.result === 'active') {
      cache.set(rec.url, {
        last_checked: TODAY,
        last_result: 'active',
        consecutive_failures: 0,
        reason: r.reason,
      });
    }
  }

  // Apply changes
  const appsResult = await applyAppChanges(
    toCheck.filter((r) => r.source === 'applications'),
    results,
    cache,
  );
  const pipelineResult = await applyPipelineChanges(
    toCheck.filter((r) => r.source === 'pipeline-pending'),
    results,
    cache,
  );

  await saveCache(cache);

  // Summary
  console.error('\nResults:');
  console.error(`  ✅ ${active} active   ❌ ${expired} expired   ⚠️  ${uncertain} uncertain`);
  console.error(`\nChanges${dryRun ? ' (would apply, but --dry-run)' : ' applied'}:`);
  console.error(`  applications.md: ${appsResult.changes} marked Discarded   ${appsResult.tentative} tentative (1st strike)`);
  console.error(`  pipeline.md: ${pipelineResult.changes} flipped to [!]   ${pipelineResult.tentative} tentative (1st strike)`);

  if (!dryRun) {
    if (appsResult.changes > 0) console.error(`\n  Backup: ${APPS_PATH}.bak`);
    if (pipelineResult.changes > 0) console.error(`  Backup: ${PIPELINE_PATH}.bak`);
  }

  if (appsResult.tentative + pipelineResult.tentative > 0) {
    console.error(`\n💡 Re-run cleanup later to confirm tentative entries (2-strikes rule).`);
  }

  if (dryRun && (appsResult.changes + pipelineResult.changes > 0)) {
    process.exit(2);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  if (verbose) console.error(err.stack);
  process.exit(1);
});
