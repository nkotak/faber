// onboarding/config-read.mjs - whitelisted YAML read endpoint.
//
// Backs GET /api/config/parsed?file=<name>. Two YAML files are reachable:
// `profile.yml` and `portals.yml`. Anything else is refused at the
// whitelist layer BEFORE buildPaths is consulted, so the file argument
// never participates in path math. Traversal is impossible by
// construction.
//
// Library: yaml ^2.7 (https://eemeli.org/yaml/)
//
// Sample input:  ('/tmp/x', 'profile.yml')
// Expected output: { file: 'profile.yml', path: '/tmp/x/config/profile.yml',
//                    parsed: { ... }, raw: '...' }

import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { buildPaths } from './paths.mjs';

/**
 * Whitelist of file params we accept, mapped to the buildPaths key that
 * resolves the absolute on-disk location. The `Map` semantics give us an
 * exact-match check via .has() that ignores any traversal trick a caller
 * could try (e.g. 'profile.yml/../foo'); the value is never derived from
 * the input.
 *
 * @type {ReadonlyMap<string, 'profileYaml' | 'portalsYaml'>}
 */
const WHITELIST = new Map([
  ['profile.yml', 'profileYaml'],
  ['portals.yml', 'portalsYaml'],
]);

/**
 * Typed error so the route handler can map a single throw to an HTTP
 * status + machine-readable code.
 */
export class ConfigReadError extends Error {
  /**
   * @param {number} status http status to send (400, 404, 422)
   * @param {string} message human-readable detail
   * @param {string} code machine-readable code
   */
  constructor(status, message, code) {
    super(message);
    this.name = 'ConfigReadError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Read and parse one of the whitelisted config files.
 *
 * @param {string} root faber root absolute path
 * @param {string} fileParam exact-match against the WHITELIST keys
 * @returns {Promise<{file: string, path: string, parsed: unknown, raw: string}>}
 */
export async function readParsedConfig(root, fileParam) {
  if (!WHITELIST.has(fileParam)) {
    throw new ConfigReadError(400, `file not allowed: ${fileParam}`, 'NOT_WHITELISTED');
  }
  const paths = buildPaths(root);
  const pathKey = WHITELIST.get(fileParam);
  const absPath = paths[pathKey];

  let text;
  try {
    text = await readFile(absPath, 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new ConfigReadError(404, `${fileParam} does not exist`, 'NOT_FOUND');
    }
    throw err;
  }

  let doc;
  try {
    doc = YAML.parse(text);
  } catch (err) {
    throw new ConfigReadError(
      422,
      `${fileParam} is malformed YAML: ${err.message}`,
      'YAML_PARSE_ERROR',
    );
  }

  return { file: fileParam, path: absPath, parsed: doc, raw: text };
}

// ---------------------------------------------------------------------------
// Validation block (run via: node server/onboarding/config-read.mjs)
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = [];
  let totalTests = 0;

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const tmpRoot = `/tmp/config-read-validate-${Date.now()}`;
  await fs.mkdir(path.join(tmpRoot, 'config'), { recursive: true });

  // Seed two valid files.
  await fs.writeFile(
    path.join(tmpRoot, 'config', 'profile.yml'),
    'candidate:\n  full_name: Jane\n  email: a@b.co\n',
  );
  await fs.writeFile(
    path.join(tmpRoot, 'portals.yml'),
    'tracked_companies:\n  - name: Anthropic\n    enabled: true\n',
  );

  // Test 1: happy path on profile.yml returns parsed JSON.
  totalTests += 1;
  try {
    const r = await readParsedConfig(tmpRoot, 'profile.yml');
    if (!r.parsed || r.parsed.candidate?.full_name !== 'Jane') {
      failures.push(`profile.yml happy path: parsed.candidate.full_name = ${r.parsed?.candidate?.full_name}`);
    }
    if (!r.raw.includes('full_name: Jane')) failures.push('profile.yml: raw missing');
    if (r.file !== 'profile.yml') failures.push(`profile.yml: file = ${r.file}`);
  } catch (err) {
    failures.push(`profile.yml happy path threw: ${err.message}`);
  }

  // Test 2: happy path on portals.yml.
  totalTests += 1;
  try {
    const r = await readParsedConfig(tmpRoot, 'portals.yml');
    if (!Array.isArray(r.parsed?.tracked_companies)) {
      failures.push('portals.yml: tracked_companies missing');
    }
  } catch (err) {
    failures.push(`portals.yml happy path threw: ${err.message}`);
  }

  // Test 3: cv.md is refused (not whitelisted).
  totalTests += 1;
  try {
    await readParsedConfig(tmpRoot, 'cv.md');
    failures.push('cv.md: expected throw, did not throw');
  } catch (err) {
    if (!(err instanceof ConfigReadError)) {
      failures.push(`cv.md: wrong error type ${err.name}`);
    } else if (err.status !== 400 || err.code !== 'NOT_WHITELISTED') {
      failures.push(`cv.md: wrong status/code ${err.status}/${err.code}`);
    }
  }

  // Test 4: traversal attempt is refused (still NOT_WHITELISTED, never sees buildPaths).
  totalTests += 1;
  try {
    await readParsedConfig(tmpRoot, '../../etc/passwd');
    failures.push('traversal: expected throw, did not throw');
  } catch (err) {
    if (!(err instanceof ConfigReadError)) {
      failures.push(`traversal: wrong error type ${err.name}`);
    } else if (err.status !== 400 || err.code !== 'NOT_WHITELISTED') {
      failures.push(`traversal: wrong status/code ${err.status}/${err.code}`);
    }
  }

  // Test 5: missing file returns 404.
  totalTests += 1;
  await fs.unlink(path.join(tmpRoot, 'portals.yml'));
  try {
    await readParsedConfig(tmpRoot, 'portals.yml');
    failures.push('missing portals.yml: expected throw');
  } catch (err) {
    if (!(err instanceof ConfigReadError)) {
      failures.push(`missing: wrong error type ${err.name}`);
    } else if (err.status !== 404 || err.code !== 'NOT_FOUND') {
      failures.push(`missing: wrong status/code ${err.status}/${err.code}`);
    }
  }

  // Test 6: malformed YAML returns 422.
  totalTests += 1;
  await fs.writeFile(path.join(tmpRoot, 'portals.yml'), '::not yaml::\n  broken: [');
  try {
    await readParsedConfig(tmpRoot, 'portals.yml');
    failures.push('malformed yaml: expected throw');
  } catch (err) {
    if (!(err instanceof ConfigReadError)) {
      failures.push(`malformed: wrong error type ${err.name}`);
    } else if (err.status !== 422 || err.code !== 'YAML_PARSE_ERROR') {
      failures.push(`malformed: wrong status/code ${err.status}/${err.code}`);
    }
  }

  // Test 7: empty fileParam string is refused.
  totalTests += 1;
  try {
    await readParsedConfig(tmpRoot, '');
    failures.push('empty file: expected throw');
  } catch (err) {
    if (!(err instanceof ConfigReadError)) {
      failures.push(`empty: wrong error type ${err.name}`);
    } else if (err.status !== 400 || err.code !== 'NOT_WHITELISTED') {
      failures.push(`empty: wrong status/code ${err.status}/${err.code}`);
    }
  }

  await fs.rm(tmpRoot, { recursive: true, force: true });

  if (failures.length > 0) {
    console.error(`VALIDATION FAILED - ${failures.length} of ${totalTests} tests failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  } else {
    console.log(`VALIDATION PASSED - All ${totalTests} tests produced expected results`);
    process.exit(0);
  }
}
