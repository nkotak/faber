// onboarding/paths.mjs - central path source of truth for the onboarding feature.
//
// All onboarding modules call buildPaths(careerOpsRoot) to obtain the
// canonical absolute paths they read or write. Keeping path math in ONE
// place means the rest of the modules never do their own path.join()
// inside the project, which keeps the path-traversal contract honest:
// every relative path that touches the filesystem flows through this
// module and through refusePathTraversal().
//
// Sample input:  '<faber-root>'
// Expected output: { root, cv, cvImported, cvBackup, profileYaml, profileMd,
//                    profileMdTemplate, portalsYaml, portalsTemplate,
//                    profileExample, applicationsMd, applicationsDir,
//                    modesDir, configDir, templatesDir, dataDir }

import path from 'node:path';

/**
 * Build the canonical path map for a given faber project root.
 * @param {string} root - absolute path to the project root.
 * @returns {Readonly<{
 *   root: string,
 *   cv: string,
 *   cvImported: string,
 *   cvBackup: (timestamp: number) => string,
 *   profileYaml: string,
 *   profileMd: string,
 *   profileMdTemplate: string,
 *   portalsYaml: string,
 *   portalsTemplate: string,
 *   profileExample: string,
 *   applicationsMd: string,
 *   applicationsDir: string,
 *   modesDir: string,
 *   configDir: string,
 *   templatesDir: string,
 *   dataDir: string,
 * }>}
 */
export function buildPaths(root) {
  if (typeof root !== 'string' || !root) {
    throw new Error('buildPaths: root must be a non-empty absolute path');
  }
  const abs = path.resolve(root);
  return Object.freeze({
    root: abs,
    cv: path.join(abs, 'cv.md'),
    cvImported: path.join(abs, 'cv-imported.md'),
    cvBackup: (ts) => path.join(abs, `cv.md.bak-${ts}`),
    profileYaml: path.join(abs, 'config', 'profile.yml'),
    profileMd: path.join(abs, 'modes', '_profile.md'),
    profileMdTemplate: path.join(abs, 'modes', '_profile.template.md'),
    portalsYaml: path.join(abs, 'portals.yml'),
    portalsTemplate: path.join(abs, 'templates', 'portals.example.yml'),
    profileExample: path.join(abs, 'config', 'profile.example.yml'),
    applicationsMd: path.join(abs, 'data', 'applications.md'),
    applicationsDir: path.join(abs, 'data'),
    modesDir: path.join(abs, 'modes'),
    configDir: path.join(abs, 'config'),
    templatesDir: path.join(abs, 'templates'),
    dataDir: path.join(abs, 'data'),
  });
}

/**
 * Refuse any candidate absolute path that escapes the project root.
 *
 * The pattern mirrors server/parsers/report.mjs: resolve both sides,
 * require the candidate to start with `<root>/`. The trailing path.sep
 * separator matters - without it, a sibling project at <faber-root>-evil
 * would slip past a startsWith check on '<faber-root>'.
 *
 * Throws a descriptive Error on violation. Returns the resolved absolute
 * path on success so callers can use it directly.
 *
 * @param {string} root - absolute project root (already resolved).
 * @param {string} candidate - absolute or relative path to validate.
 * @returns {string} The resolved absolute path inside root.
 */
export function refusePathTraversal(root, candidate) {
  if (typeof candidate !== 'string' || !candidate) {
    throw new Error('refusePathTraversal: candidate path required');
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  // The candidate is allowed to be the root itself OR a path inside it.
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error('path traversal refused');
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Validation block (run via: node server/onboarding/paths.mjs)
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = [];
  let totalTests = 0;

  // Test 1: buildPaths produces stable absolute paths.
  totalTests += 1;
  const p = buildPaths('/tmp/faber-test');
  if (p.root !== '/tmp/faber-test') {
    failures.push(`buildPaths root mismatch: got ${p.root}`);
  }
  if (p.cv !== '/tmp/faber-test/cv.md') {
    failures.push(`buildPaths cv mismatch: got ${p.cv}`);
  }
  if (p.profileYaml !== '/tmp/faber-test/config/profile.yml') {
    failures.push(`buildPaths profileYaml mismatch: got ${p.profileYaml}`);
  }
  if (p.profileMd !== '/tmp/faber-test/modes/_profile.md') {
    failures.push(`buildPaths profileMd mismatch: got ${p.profileMd}`);
  }
  if (p.cvBackup(123) !== '/tmp/faber-test/cv.md.bak-123') {
    failures.push(`buildPaths cvBackup mismatch: got ${p.cvBackup(123)}`);
  }

  // Test 2: refusePathTraversal accepts inside-root paths.
  totalTests += 1;
  try {
    const ok = refusePathTraversal('/tmp/faber-test', 'cv.md');
    if (ok !== '/tmp/faber-test/cv.md') {
      failures.push(`refusePathTraversal happy path returned ${ok}`);
    }
  } catch (err) {
    failures.push(`refusePathTraversal happy path threw: ${err.message}`);
  }

  // Test 3: refusePathTraversal rejects ../escape attempts.
  totalTests += 1;
  try {
    refusePathTraversal('/tmp/faber-test', '../etc/passwd');
    failures.push('refusePathTraversal: expected throw on ../escape');
  } catch (err) {
    if (!err.message.includes('path traversal refused')) {
      failures.push(`refusePathTraversal: wrong message: ${err.message}`);
    }
  }

  // Test 4: refusePathTraversal rejects sibling-prefix attacks.
  totalTests += 1;
  try {
    refusePathTraversal('/tmp/faber', '/tmp/faber-evil/x');
    failures.push('refusePathTraversal: expected throw on sibling prefix');
  } catch (err) {
    if (!err.message.includes('path traversal refused')) {
      failures.push(`refusePathTraversal sibling: wrong message: ${err.message}`);
    }
  }

  // Test 5: buildPaths refuses empty input.
  totalTests += 1;
  try {
    buildPaths('');
    failures.push('buildPaths: expected throw on empty root');
  } catch (err) {
    if (!err.message.includes('non-empty')) {
      failures.push(`buildPaths empty: wrong message: ${err.message}`);
    }
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
