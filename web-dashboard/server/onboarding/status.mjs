// onboarding/status.mjs - filesystem snapshot for the onboarding modal.
//
// The modal reads this once on mount, then re-reads after every SSE
// 'onboarding' event. The shape it returns drives the modal's step
// finite-state machine, so it must remain stable.
//
// File semantics:
//   required        - missing any of these = modal must be shown
//   optional        - bonus content (article-digest, examples)
//   staging         - whether cv-imported.md exists (preview gate for step 1)
//   nextStep        - the first step whose required file is missing
//
// Sample output:
// {
//   setupComplete: false,
//   required: { cvMd: true, profileYaml: false, profileMd: false, portalsYaml: false, applicationsMd: true },
//   optional: { articleDigest: false },
//   staging: { cvImported: false },
//   missingFiles: ['config/profile.yml', 'modes/_profile.md', 'portals.yml'],
//   nextStep: 'profile',
//   optionalSteps: []
// }

import { stat } from 'node:fs/promises';
import path from 'node:path';
import { buildPaths } from './paths.mjs';

/** Step ordering matters - step 1 (cv) before step 2 (profile), etc. */
const STEPS = [
  { id: 'cv',         file: 'cv',          relPath: 'cv.md' },
  { id: 'profile',    file: 'profileYaml', relPath: 'config/profile.yml' },
  { id: 'profileMd',  file: 'profileMd',   relPath: 'modes/_profile.md' },
  { id: 'portals',    file: 'portalsYaml', relPath: 'portals.yml' },
  { id: 'tracker',    file: 'applicationsMd', relPath: 'data/applications.md' },
];

/** Resolve true/false for whether a file exists and is a regular file. */
async function exists(absPath) {
  try {
    const st = await stat(absPath);
    return st.isFile();
  } catch {
    return false;
  }
}

/**
 * Compute onboarding status from the filesystem.
 * @param {string} root - faber project root.
 * @returns {Promise<{
 *   setupComplete: boolean,
 *   required: Record<string, boolean>,
 *   optional: Record<string, boolean>,
 *   staging: { cvImported: boolean },
 *   missingFiles: string[],
 *   nextStep: 'cv'|'profile'|'profileMd'|'portals'|'tracker'|null,
 *   optionalSteps: string[],
 * }>}
 */
export async function getOnboardingStatus(root) {
  const paths = buildPaths(root);

  const checks = await Promise.all(STEPS.map(async (s) => ({
    step: s,
    ok: await exists(paths[s.file]),
  })));

  /** @type {Record<string, boolean>} */
  const required = {};
  const missingFiles = [];
  for (const c of checks) {
    required[c.step.file] = c.ok;
    if (!c.ok) missingFiles.push(c.step.relPath);
  }

  const articleDigest = await exists(path.join(paths.root, 'article-digest.md'));
  const cvImported = await exists(paths.cvImported);

  const setupComplete = checks.every((c) => c.ok);
  const nextStep = setupComplete ? null : checks.find((c) => !c.ok)?.step.id ?? null;

  return {
    setupComplete,
    required,
    optional: { articleDigest },
    staging: { cvImported },
    missingFiles,
    nextStep,
    optionalSteps: articleDigest ? [] : ['articleDigest'],
  };
}

// ---------------------------------------------------------------------------
// Validation block (run via: node server/onboarding/status.mjs <root>)
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = [];
  let totalTests = 0;
  const root = process.argv[2] ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

  // Test 1: status against current root returns a well-shaped object.
  totalTests += 1;
  try {
    const s = await getOnboardingStatus(root);
    if (typeof s.setupComplete !== 'boolean') failures.push('setupComplete missing');
    if (!s.required) failures.push('required missing');
    if (!Array.isArray(s.missingFiles)) failures.push('missingFiles missing');
    if (s.nextStep !== null && !['cv', 'profile', 'profileMd', 'portals', 'tracker'].includes(s.nextStep)) {
      failures.push(`unexpected nextStep: ${s.nextStep}`);
    }
    console.log('Status snapshot:', JSON.stringify(s, null, 2));
  } catch (err) {
    failures.push(`status threw: ${err.message}`);
  }

  // Test 2: status against /tmp/empty (nothing exists) returns setupComplete=false.
  totalTests += 1;
  try {
    const s = await getOnboardingStatus('/tmp/onboarding-validation-nothere');
    if (s.setupComplete !== false) failures.push(`expected setupComplete=false on empty dir, got ${s.setupComplete}`);
    if (s.missingFiles.length === 0) failures.push('expected missingFiles to be populated for empty dir');
    if (s.nextStep !== 'cv') failures.push(`expected nextStep=cv on empty dir, got ${s.nextStep}`);
  } catch (err) {
    failures.push(`empty dir status threw: ${err.message}`);
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
