#!/usr/bin/env node
// reflect-on-status-change.mjs
//
// PostToolUse hook trigger. Fires on Edit/Write of any file, but only does work
// if the file is data/applications.md. Diffs current vs snapshot to find new
// terminal-state transitions (Applied/Evaluated → Rejected/Interview/Offer/Discarded),
// dedupes against data/episodes.tsv, and spawns claude -p in background per
// new transition.
//
// Hook contract:
//   - Receives JSON via stdin from Claude Code with shape:
//       { tool_name: "Edit"|"Write"|..., tool_input: { file_path: "..." }, ... }
//   - Falls back to argv[2] if stdin has no parsable JSON.
//   - ALWAYS exits 0 (never blocks the user's edit).
//   - Logs failures to data/.reflection-errors.log.

import { readFileSync, writeFileSync, existsSync, appendFileSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Derive project root from this script's location (scripts/ is one level under root).
// Lets the script run regardless of where it's installed.
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPLICATIONS_PATH = path.join(PROJECT_ROOT, 'data/applications.md');
const SNAPSHOT_PATH = path.join(PROJECT_ROOT, 'data/.applications.snapshot.md');
const EPISODES_PATH = path.join(PROJECT_ROOT, 'data/episodes.tsv');
const ERROR_LOG = path.join(PROJECT_ROOT, 'data/.reflection-errors.log');

const TERMINAL_STATES = new Set(['Rejected', 'Interview', 'Offer', 'Discarded']);

// ---------- helpers ----------

function logError(msg) {
  try {
    appendFileSync(ERROR_LOG, `${new Date().toISOString()}\t${msg}\n`);
  } catch (_) { /* nothing we can do */ }
}

function exitClean(reason) {
  if (process.env.FABER_REFLECT_DEBUG) {
    console.error(`[reflect] exit clean: ${reason}`);
  }
  process.exit(0);
}

async function readStdinJSON() {
  if (process.stdin.isTTY) return null;
  try {
    let data = '';
    const timeout = new Promise((_, reject) => setTimeout(() => reject('stdin timeout'), 200));
    const reader = (async () => {
      for await (const chunk of process.stdin) data += chunk;
      return data;
    })();
    const result = await Promise.race([reader, timeout]).catch(() => null);
    if (!result) return null;
    return JSON.parse(result.trim());
  } catch (_) {
    return null;
  }
}

function getFilePathFromHookPayload(payload) {
  if (!payload) return null;
  // Common shapes Claude Code may use
  return (
    payload?.tool_input?.file_path ||
    payload?.toolInput?.file_path ||
    payload?.input?.file_path ||
    payload?.file_path ||
    null
  );
}

// Parse the applications.md table into rows keyed by application_num.
// Returns Map<num: string, { num, date, company, role, score, status, pdf, report, notes }>
function parseApplications(content) {
  const rows = new Map();
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    if (line.startsWith('| #') || line.startsWith('|---') || line.startsWith('| -')) continue;
    const cells = line.split('|').map(s => s.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length < 8) continue;
    const num = cells[0];
    if (!/^\d+$/.test(num)) continue;
    const [_num, date, company, role, score, status, pdf, report, ...notesParts] = cells;
    rows.set(num, {
      num,
      date: date || '',
      company: company || '',
      role: role || '',
      score: score || '',
      status: (status || '').replace(/^\*+|\*+$/g, '').trim(),
      pdf: pdf || '',
      report: report || '',
      notes: notesParts.join(' | ').trim(),
    });
  }
  return rows;
}

// Find rows whose status changed to a terminal state since the snapshot.
function findNewTerminalTransitions(snapshotRows, currentRows) {
  const transitions = [];
  for (const [num, currentRow] of currentRows) {
    const snapshotRow = snapshotRows.get(num);
    const oldStatus = snapshotRow?.status || '';
    const newStatus = currentRow.status;
    if (oldStatus === newStatus) continue;
    if (!TERMINAL_STATES.has(newStatus)) continue;
    transitions.push({
      num,
      oldStatus: oldStatus || '(new)',
      newStatus,
      row: currentRow,
    });
  }
  return transitions;
}

// Deduplicate against episodes.tsv. Skip transitions already reflected.
function alreadyReflected(num, newStatus) {
  if (!existsSync(EPISODES_PATH)) return false;
  try {
    const content = readFileSync(EPISODES_PATH, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (!line || line.startsWith('timestamp')) continue;
      const cells = line.split('\t');
      const epNum = cells[1];
      const epOutcome = cells[7];
      if (epNum === num && epOutcome === newStatus) return true;
    }
  } catch (_) { /* fall through */ }
  return false;
}

// Extract report path from a markdown link cell like `[001](reports/001-foo-2026-01-01.md)`.
function extractReportPath(reportCell) {
  const m = reportCell.match(/\((reports\/[^)]+)\)/);
  return m ? m[1] : '';
}

// Spawn claude -p with the reflect prompt in background. Detached, no stdio.
function spawnReflection(transition) {
  const reportPath = extractReportPath(transition.row.report);
  const promptParts = [
    'Run the reflect mode from modes/reflect.md.',
    `Application num: ${transition.num}`,
    `Company: ${transition.row.company}`,
    `Role: ${transition.row.role}`,
    `Old status: ${transition.oldStatus}`,
    `New status: ${transition.newStatus}`,
    `Report path: ${reportPath || '(no report)'}`,
    `PDF cell: ${transition.row.pdf}`,
    `Notes: ${transition.row.notes}`,
    '',
    'Read modes/_shared.md and modes/reflect.md, then execute reflect step-by-step.',
    'Do not interact with the user. Write files, exit silently.',
  ];
  const prompt = promptParts.join('\n');

  // Use claude with the prompt. Detach so the subprocess survives this hook exiting.
  const claudeBin = process.env.FABER_CLAUDE_BIN || 'claude';
  const args = ['-p', prompt];

  try {
    const child = spawn(claudeBin, args, {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();
    return { ok: true, pid: child.pid };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------- main ----------

async function main() {
  // Determine the file being edited.
  const payload = await readStdinJSON();
  const filePathFromHook = getFilePathFromHookPayload(payload);
  const filePathFromArg = process.argv[2];
  const filePath = filePathFromHook || filePathFromArg;

  if (!filePath) exitClean('no file path');

  // Normalize and check if it's the applications file.
  const normalized = path.resolve(filePath);
  if (normalized !== APPLICATIONS_PATH) exitClean(`not applications.md: ${normalized}`);

  if (!existsSync(APPLICATIONS_PATH)) exitClean('applications.md missing');

  // Read current and snapshot.
  let currentContent, snapshotContent;
  try {
    currentContent = readFileSync(APPLICATIONS_PATH, 'utf-8');
  } catch (err) {
    logError(`read applications.md: ${err.message}`);
    exitClean('read failed');
  }

  if (!existsSync(SNAPSHOT_PATH)) {
    // First run — create snapshot, no diff possible.
    try { copyFileSync(APPLICATIONS_PATH, SNAPSHOT_PATH); } catch (err) {
      logError(`init snapshot: ${err.message}`);
    }
    exitClean('snapshot initialized');
  }

  try {
    snapshotContent = readFileSync(SNAPSHOT_PATH, 'utf-8');
  } catch (err) {
    logError(`read snapshot: ${err.message}`);
    exitClean('snapshot read failed');
  }

  // Diff.
  const snapshotRows = parseApplications(snapshotContent);
  const currentRows = parseApplications(currentContent);
  const transitions = findNewTerminalTransitions(snapshotRows, currentRows);

  if (transitions.length === 0) {
    // Update snapshot anyway (covers cases where the user adds a new Applied row, etc.)
    try { writeFileSync(SNAPSHOT_PATH, currentContent); } catch (_) { /* ignore */ }
    exitClean('no terminal transitions');
  }

  // For each transition, dedupe and spawn reflection.
  const spawned = [];
  for (const t of transitions) {
    if (alreadyReflected(t.num, t.newStatus)) continue;
    const result = spawnReflection(t);
    if (result.ok) {
      spawned.push({ num: t.num, newStatus: t.newStatus, pid: result.pid });
    } else {
      logError(`spawn failed for #${t.num} → ${t.newStatus}: ${result.error}`);
    }
  }

  // Update snapshot AFTER reads. (If we updated before, idempotency would be broken
  // for hooks that fire repeatedly without status changes — but checking
  // alreadyReflected via episodes.tsv still saves us.)
  try { writeFileSync(SNAPSHOT_PATH, currentContent); } catch (err) {
    logError(`snapshot write: ${err.message}`);
  }

  if (process.env.FABER_REFLECT_DEBUG) {
    console.error(`[reflect] spawned ${spawned.length} reflection(s):`, JSON.stringify(spawned));
  }

  process.exit(0);
}

main().catch(err => {
  logError(`uncaught: ${err.message}`);
  process.exit(0);
});
