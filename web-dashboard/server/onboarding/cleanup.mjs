// onboarding/cleanup.mjs - sweep stale temp files left behind by previous
// runs. The /api/onboarding/parse-resume route writes the resume's extracted
// text to <os.tmpdir()>/faber-onboarding/<uuid>.txt before invoking
// the claude-p subprocess. Most of the time we delete that file inside the
// route's job-finalize handler; cleanupStaleTemp catches the case where the
// server crashed mid-job and never got to clean up.
//
// Strategy: scan the temp dir on startup, delete any file older than 1h.

import { readdir, stat, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const STALE_AGE_MS = 60 * 60 * 1000; // 1 hour

/** Resolve the canonical tmp dir for onboarding artifacts. */
export function getOnboardingTmpDir() {
  return path.join(os.tmpdir(), 'faber-onboarding');
}

/**
 * Delete files in <tmp>/faber-onboarding/ older than STALE_AGE_MS.
 * Creates the directory if missing. Returns the number of files removed.
 *
 * @param {string} _root - faber project root (unused; tmp lives outside).
 * @returns {Promise<{removed: number, dir: string}>}
 */
export async function cleanupStaleTemp(_root) {
  const dir = getOnboardingTmpDir();
  await mkdir(dir, { recursive: true });
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return { removed: 0, dir };
  }
  const cutoff = Date.now() - STALE_AGE_MS;
  let removed = 0;
  await Promise.all(entries.map(async (name) => {
    const full = path.join(dir, name);
    try {
      const st = await stat(full);
      if (st.isFile() && st.mtimeMs < cutoff) {
        await unlink(full);
        removed += 1;
      }
    } catch {
      // ignore - file vanished between readdir and stat, or perm issue
    }
  }));
  return { removed, dir };
}

// ---------------------------------------------------------------------------
// Validation block
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = [];
  let totalTests = 0;

  // Test 1: cleanup returns the expected dir.
  totalTests += 1;
  const r = await cleanupStaleTemp('/tmp/faber-test');
  if (!r.dir.endsWith('faber-onboarding')) {
    failures.push(`unexpected tmp dir: ${r.dir}`);
  }
  if (typeof r.removed !== 'number') {
    failures.push(`removed should be a number, got ${typeof r.removed}`);
  }

  if (failures.length > 0) {
    console.error(`VALIDATION FAILED - ${failures.length} of ${totalTests} tests failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  } else {
    console.log(`VALIDATION PASSED - All ${totalTests} tests produced expected results`);
    process.exit(0);
  }
}
