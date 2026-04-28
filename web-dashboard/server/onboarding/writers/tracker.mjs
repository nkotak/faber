// onboarding/writers/tracker.mjs - create the empty applications.md tracker.
//
// Header format mirrors CLAUDE.md lines 131-136 exactly:
//
//   # Applications Tracker
//
//   | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
//   |---|------|---------|------|-------|--------|-----|--------|-------|
//
// If applications.md already exists we leave it alone unless `force: true`
// is passed (the modal never sends force; this is for tooling).

import { mkdir, stat, writeFile, rename, unlink } from 'node:fs/promises';
import { buildPaths } from '../paths.mjs';

const TRACKER_HEADER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`;

const activeWrites = new Map();

async function withFileMutex(filePath, fn) {
  const prev = activeWrites.get(filePath) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  activeWrites.set(filePath, next);
  try {
    return await next;
  } finally {
    if (activeWrites.get(filePath) === next) activeWrites.delete(filePath);
  }
}

async function atomicWrite(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, content, 'utf-8');
    await rename(tmp, filePath);
  } catch (err) {
    try { await unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Initialize an empty applications tracker.
 *
 * @param {string} root
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{ path: string, created: boolean, alreadyExisted: boolean }>}
 */
export async function initTracker(root, opts = {}) {
  const paths = buildPaths(root);
  await mkdir(paths.dataDir, { recursive: true });
  return withFileMutex(paths.applicationsMd, async () => {
    let alreadyExisted = false;
    try {
      const st = await stat(paths.applicationsMd);
      alreadyExisted = st.isFile();
    } catch { /* ENOENT - that's fine */ }

    if (alreadyExisted && !opts.force) {
      return { path: paths.applicationsMd, created: false, alreadyExisted: true };
    }

    await atomicWrite(paths.applicationsMd, TRACKER_HEADER);
    return { path: paths.applicationsMd, created: true, alreadyExisted };
  });
}

// ---------------------------------------------------------------------------
// Validation block
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = [];
  let totalTests = 0;
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const tmpRoot = `/tmp/onboarding-tracker-validate-${Date.now()}`;
  await fs.mkdir(tmpRoot, { recursive: true });

  // Test 1: initial creation succeeds and writes the canonical header.
  totalTests += 1;
  try {
    const r = await initTracker(tmpRoot);
    if (!r.created) failures.push('expected created=true on first call');
    const onDisk = await fs.readFile(path.join(tmpRoot, 'data', 'applications.md'), 'utf-8');
    if (onDisk !== TRACKER_HEADER) failures.push(`header mismatch:\n${onDisk}`);
  } catch (err) {
    failures.push(`initial create threw: ${err.message}`);
  }

  // Test 2: re-init without force is a no-op.
  totalTests += 1;
  try {
    const r = await initTracker(tmpRoot);
    if (r.created !== false) failures.push('expected created=false on second call');
    if (r.alreadyExisted !== true) failures.push('expected alreadyExisted=true');
  } catch (err) {
    failures.push(`no-force re-init threw: ${err.message}`);
  }

  // Test 3: force re-init overwrites.
  totalTests += 1;
  try {
    await fs.writeFile(path.join(tmpRoot, 'data', 'applications.md'), 'corrupted');
    const r = await initTracker(tmpRoot, { force: true });
    if (!r.created) failures.push('expected created=true with force');
    const onDisk = await fs.readFile(path.join(tmpRoot, 'data', 'applications.md'), 'utf-8');
    if (onDisk !== TRACKER_HEADER) failures.push('force did not restore canonical header');
  } catch (err) {
    failures.push(`force re-init threw: ${err.message}`);
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
