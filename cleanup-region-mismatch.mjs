#!/usr/bin/env node

/**
 * cleanup-region-mismatch.mjs — Remove pipeline / mark applications whose location
 * doesn't match the current location_filter in config/profile.yml.
 *
 * The complement to cleanup-dead-jobs.mjs: where dead-jobs verifies URLs are
 * still live, region-mismatch verifies entries match the user's location policy
 * (which may have been added or tightened after the entries were scanned).
 *
 * For pipeline.md `[ ]` rows: rewrites without the mismatched lines (preserved
 * in a `## Discarded — region` section at the bottom for audit trail).
 *
 * For applications.md `Evaluated` rows: status flips to `Discarded` with a
 * note like "Region mismatch (Paris) — filter excluded {date}".
 *
 * Usage:
 *   node cleanup-region-mismatch.mjs                 # full run
 *   node cleanup-region-mismatch.mjs --dry-run       # preview only
 *   node cleanup-region-mismatch.mjs --scope=apps    # apps only
 *   node cleanup-region-mismatch.mjs --scope=pipeline
 *
 * Exit codes:
 *   0 — clean run
 *   1 — fatal error (e.g., filter not configured)
 *   2 — dry-run with proposed changes
 */

import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseYaml } from './lib/yaml-mini.mjs';
import { loadAliases, matchesFilter } from './lib/location-filter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    scope: { type: 'string', default: 'all' },
    verbose: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: false,
});

if (args.help) {
  console.log(`Usage: node cleanup-region-mismatch.mjs [options]

Reads location_filter from config/profile.yml and removes/marks rows that don't
match. Pipeline rows are removed (preserved in a Discarded section); evaluated
applications get status flipped to Discarded.

Options:
  --dry-run            Preview changes; write nothing
  --scope=apps|pipeline|all   (default: all)
  --verbose            Per-row output
  --help`);
  process.exit(0);
}

const dryRun = args['dry-run'];
const scope = args.scope;
const verbose = args.verbose;

const APPS_PATH = join(ROOT, 'data', 'applications.md');
const PIPELINE_PATH = join(ROOT, 'data', 'pipeline.md');
const PROFILE_PATH = join(ROOT, 'config', 'profile.yml');
const ALIASES_PATH = join(ROOT, 'config', 'location-aliases.json');

const TODAY = new Date().toISOString().slice(0, 10);

const TERMINAL_STATUSES = new Set([
  'rejected',
  'offer',
  'interview',
  'responded',
  'discarded',
  'skip',
]);

// ---------------------------------------------------------------------------
// Load filter context
// ---------------------------------------------------------------------------

function loadFilterContext() {
  if (!existsSync(PROFILE_PATH)) {
    console.error('config/profile.yml not found. Set up your profile first (see config/profile.example.yml).');
    process.exit(1);
  }
  const profile = parseYaml(readFileSync(PROFILE_PATH, 'utf-8'));
  const filterConfig = profile?.location_filter;
  if (!filterConfig || !filterConfig.enabled) {
    console.error('location_filter is not configured or not enabled in config/profile.yml.');
    console.error('Nothing to do — exiting cleanly.');
    process.exit(0);
  }

  let builtinAliases = {};
  if (existsSync(ALIASES_PATH)) {
    try {
      builtinAliases = JSON.parse(readFileSync(ALIASES_PATH, 'utf-8'));
    } catch (err) {
      console.error(`Failed to parse location-aliases.json: ${err.message}`);
    }
  }
  const aliasMap = loadAliases(builtinAliases, filterConfig.custom_aliases ?? {});
  return { filterConfig, aliasMap };
}

// ---------------------------------------------------------------------------
// Pipeline cleanup
// ---------------------------------------------------------------------------

async function cleanupPipeline(filterCtx) {
  if (!existsSync(PIPELINE_PATH)) return { mismatches: [], rewritten: false };

  const text = await readFile(PIPELINE_PATH, 'utf-8');
  const lines = text.split('\n');
  const mismatches = [];
  const newLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^- \[ \]\s+(\S+)\s*\|\s*(.+)$/);
    if (!m) {
      newLines.push(line);
      continue;
    }

    const url = m[1];
    const fields = m[2].split('|').map((s) => s.trim());
    const company = fields[0] || '';
    const title = fields[1] || '';
    const location = fields[2] || '';

    if (!location) {
      // No location field on this row (older entry pre-dating the schema extension).
      // Can't classify — keep it.
      newLines.push(line);
      continue;
    }

    const r = matchesFilter(location, filterCtx.filterConfig, filterCtx.aliasMap);
    if (r.pass) {
      newLines.push(line);
    } else {
      mismatches.push({ url, company, title, location, reason: r.reason, originalLine: line });
      if (verbose) console.error(`  pipeline.md L${i + 1}: ${company} | ${location} → ${r.reason}`);
    }
  }

  if (mismatches.length === 0 || dryRun) {
    return { mismatches, rewritten: false };
  }

  // Append a "Discarded — region" section preserving the audit trail
  let output = newLines.join('\n').replace(/\n+$/, '');
  output += `\n\n## Discarded — region mismatch (${TODAY})\n`;
  output += `_Filter excluded these entries because their location didn't match \`config/profile.yml\` location_filter._\n\n`;
  for (const m of mismatches) {
    output += `- ${m.originalLine.replace(/^- \[ \] /, '')} — ${m.reason}\n`;
  }
  output += '\n';

  await copyFile(PIPELINE_PATH, PIPELINE_PATH + '.bak');
  await writeFile(PIPELINE_PATH, output, 'utf-8');
  return { mismatches, rewritten: true };
}

// ---------------------------------------------------------------------------
// Applications cleanup
// ---------------------------------------------------------------------------

async function cleanupApplications(filterCtx) {
  if (!existsSync(APPS_PATH)) return { mismatches: [], rewritten: false };

  const text = await readFile(APPS_PATH, 'utf-8');
  const lines = text.split('\n');
  const mismatches = [];
  let mutated = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 10) continue;
    const [, num, , company, role, , status, , reportCell, ] = cells;
    if (!num || !/^\d+$/.test(num)) continue;
    const statusLower = (status || '').trim().toLowerCase();
    if (TERMINAL_STATUSES.has(statusLower)) continue;

    // Pull location from the linked report file
    const reportMatch = reportCell.match(/\[\d+\]\(([^)]+\.md)\)/);
    if (!reportMatch) continue;
    const reportPath = join(ROOT, reportMatch[1]);
    if (!existsSync(reportPath)) continue;
    const reportText = await readFile(reportPath, 'utf-8');

    // Try to extract a location from the report header (Block A "Location" or similar)
    // Reports vary; look for a "Location" or "Locations" line, fall back to scanning the JD section.
    const locMatch =
      reportText.match(/^\*\*Location:\*\*\s*([^\n]+)/m) ??
      reportText.match(/^\|\s*Location\s*\|\s*([^|]+)\|/m);
    const location = locMatch ? locMatch[1].trim() : '';
    if (!location) continue; // can't classify — leave alone

    const r = matchesFilter(location, filterCtx.filterConfig, filterCtx.aliasMap);
    if (r.pass) continue;

    mismatches.push({ appNum: parseInt(num, 10), company, role, location, reason: r.reason, lineIdx: i });
    if (verbose) console.error(`  applications.md #${num}: ${company} | ${location} → ${r.reason}`);

    if (!dryRun) {
      // Flip status to Discarded with a note
      const cellsCopy = lines[i].split('|');
      cellsCopy[6] = ' Discarded ';
      const noteFragment = `Region mismatch (${location}) — filter excluded ${TODAY}`;
      const existingNote = cellsCopy[9].trim();
      cellsCopy[9] = ' ' + (existingNote ? `${existingNote}. ${noteFragment}` : noteFragment) + ' ';
      lines[i] = cellsCopy.join('|');
      mutated = true;
    }
  }

  if (mutated && !dryRun) {
    await copyFile(APPS_PATH, APPS_PATH + '.bak');
    await writeFile(APPS_PATH, lines.join('\n'), 'utf-8');
  }
  return { mismatches, rewritten: mutated };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.error(`📊 Cleanup Region Mismatch ${dryRun ? '— DRY RUN' : ''}`);
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const filterCtx = loadFilterContext();
  console.error(`Filter: hybrid=${JSON.stringify(filterCtx.filterConfig.hybrid?.locations ?? [])}, remote_regions=${JSON.stringify(filterCtx.filterConfig.remote?.accept_regions ?? [])}`);

  let pipelineResult = { mismatches: [], rewritten: false };
  let appsResult = { mismatches: [], rewritten: false };

  if (scope === 'pipeline' || scope === 'all') {
    pipelineResult = await cleanupPipeline(filterCtx);
  }
  if (scope === 'apps' || scope === 'all') {
    appsResult = await cleanupApplications(filterCtx);
  }

  console.error('\nResults:');
  console.error(`  pipeline.md: ${pipelineResult.mismatches.length} mismatches ${dryRun ? '(would remove)' : (pipelineResult.rewritten ? 'removed → "Discarded — region" section' : '')}`);
  console.error(`  applications.md: ${appsResult.mismatches.length} mismatches ${dryRun ? '(would mark Discarded)' : (appsResult.rewritten ? 'marked Discarded' : '')}`);

  if (!dryRun) {
    if (pipelineResult.rewritten) console.error(`\n  Backup: ${PIPELINE_PATH}.bak`);
    if (appsResult.rewritten) console.error(`  Backup: ${APPS_PATH}.bak`);
  }

  if (dryRun && (pipelineResult.mismatches.length + appsResult.mismatches.length > 0)) {
    process.exit(2);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  if (verbose) console.error(err.stack);
  process.exit(1);
});
