// onboarding/writers/cv.mjs - promote cv-imported.md to cv.md.
//
// The "commit" step of onboarding step 1: validates the staged shape,
// backs up an existing cv.md to cv.md.bak-<ts> (so re-onboarding never
// destroys data), and atomically renames the staged file into place.
//
// Hard rules:
//   - The skill at .claude/skills/onboard-cv/SKILL.md is the only thing
//     that ever touches cv-imported.md. cv.md is touched only here.
//   - Three required headings must be present BEFORE we promote; if any
//     are missing we throw CommitCvShapeError so the route returns 422.
//   - Atomic write pattern: write .tmp-<pid>-<ts>, then rename. If rename
//     fails the .tmp- file is unlinked.

import { readFile, writeFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { buildPaths } from '../paths.mjs';

/** Minimum sensible markdown length for a CV. */
const CV_MIN_BYTES = 200;
/** Hard cap to avoid memory abuse from a runaway editor field. */
const CV_MAX_BYTES = 200_000;

/** Required H2 sections (case-sensitive, leading "## "). */
const REQUIRED_HEADINGS = ['## CORE SKILLS', '## PROFESSIONAL EXPERIENCE', '## EDUCATION'];

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

export class CommitCvShapeError extends Error {
  constructor(message, { missing }) {
    super(message);
    this.name = 'CommitCvShapeError';
    this.code = 'CV_SHAPE_INVALID';
    this.missing = missing ?? [];
  }
}

export class CommitCvNotStagedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommitCvNotStagedError';
    this.code = 'CV_NOT_STAGED';
  }
}

/**
 * Validate the markdown shape of CV content.
 *
 * @param {string} content
 * @returns {string[]} list of missing required headings (empty = OK).
 */
function validateCvShape(content) {
  const missing = [];
  for (const h of REQUIRED_HEADINGS) {
    // Match the heading at the start of any line.
    const re = new RegExp(`^${escapeRegex(h)}\\b`, 'm');
    if (!re.test(content)) missing.push(h);
  }
  // Need a top-level title (# NAME).
  if (!/^#\s+\S/m.test(content)) missing.push('# <NAME> top heading');
  return missing;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Promote cv-imported.md (or editedContent override) to cv.md.
 *
 * @param {string} root
 * @param {string|undefined} editedContent  if provided, use this instead of
 *                                          reading cv-imported.md from disk.
 * @returns {Promise<{ committedAt: number, backupPath: string|null, bytes: number }>}
 */
export async function commitCv(root, editedContent) {
  const paths = buildPaths(root);

  // Source content: edited override OR staged file.
  let content;
  if (typeof editedContent === 'string' && editedContent.length > 0) {
    content = editedContent;
  } else {
    try {
      content = await readFile(paths.cvImported, 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new CommitCvNotStagedError('cv-imported.md not found; run parse-resume first');
      }
      throw err;
    }
  }

  if (typeof content !== 'string' || content.length < CV_MIN_BYTES) {
    throw new CommitCvShapeError(
      `cv content too short: ${content?.length ?? 0} bytes`,
      { missing: ['content too short'] },
    );
  }
  if (content.length > CV_MAX_BYTES) {
    throw new CommitCvShapeError(
      `cv content too large: ${content.length} bytes`,
      { missing: ['content too large'] },
    );
  }

  const missing = validateCvShape(content);
  if (missing.length > 0) {
    throw new CommitCvShapeError(
      `cv missing required sections: ${missing.join(', ')}`,
      { missing },
    );
  }

  return withFileMutex(paths.cv, async () => {
    // Back up an existing cv.md if present.
    let backupPath = null;
    try {
      const st = await stat(paths.cv);
      if (st.isFile()) {
        const ts = Date.now();
        backupPath = paths.cvBackup(ts);
        await rename(paths.cv, backupPath);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Now write the promoted content atomically.
    await atomicWrite(paths.cv, content);

    // Best-effort: delete the staged file after a successful promote so
    // the modal correctly shows "cv committed; staging cleaned up".
    try { await unlink(paths.cvImported); } catch { /* ignore */ }

    return { committedAt: Date.now(), backupPath, bytes: content.length };
  });
}

// ---------------------------------------------------------------------------
// Validation block
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = [];
  let totalTests = 0;
  const fs = await import('node:fs/promises');
  const tmpRoot = `/tmp/onboarding-cv-validate-${Date.now()}`;
  await fs.mkdir(tmpRoot, { recursive: true });

  // Test 1: missing staging throws CV_NOT_STAGED.
  totalTests += 1;
  try {
    await commitCv(tmpRoot);
    failures.push('expected CV_NOT_STAGED');
  } catch (err) {
    if (err.code !== 'CV_NOT_STAGED') failures.push(`expected CV_NOT_STAGED, got ${err.code}`);
  }

  // Test 2: shape-invalid rejected.
  totalTests += 1;
  try {
    await commitCv(tmpRoot, 'just some text\n' + 'x'.repeat(500));
    failures.push('expected CV_SHAPE_INVALID');
  } catch (err) {
    if (err.code !== 'CV_SHAPE_INVALID') failures.push(`expected CV_SHAPE_INVALID, got ${err.code}`);
  }

  // Test 3: well-shaped CV commits successfully.
  totalTests += 1;
  const goodCv = `# JANE DOE

NYC | jane@example.com | 555-1234

---

## CORE SKILLS

**Engineering:** Python, JavaScript

---

## PROFESSIONAL EXPERIENCE

### Senior Engineer | Acme | NYC
**2022 – Present**

- Did stuff that mattered.

---

## EDUCATION

**MS CS** | Stanford | 2018
`;
  try {
    const r = await commitCv(tmpRoot, goodCv);
    if (typeof r.bytes !== 'number') failures.push('commitCv result missing bytes');
    const written = await fs.readFile(path.join(tmpRoot, 'cv.md'), 'utf-8');
    if (written !== goodCv) failures.push('cv.md content mismatch after commit');
  } catch (err) {
    failures.push(`good CV commit threw: ${err.message}`);
  }

  // Test 4: re-commit backs up the existing cv.md.
  totalTests += 1;
  try {
    const before = await fs.readdir(tmpRoot);
    await commitCv(tmpRoot, goodCv.replace('Did stuff', 'Did more stuff'));
    const after = await fs.readdir(tmpRoot);
    const backups = after.filter((n) => n.startsWith('cv.md.bak-'));
    if (backups.length === 0) failures.push('expected cv.md.bak-* after re-commit');
    void before;
  } catch (err) {
    failures.push(`re-commit threw: ${err.message}`);
  }

  // cleanup
  try { await fs.rm(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }

  if (failures.length > 0) {
    console.error(`VALIDATION FAILED - ${failures.length} of ${totalTests} tests failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  } else {
    console.log(`VALIDATION PASSED - All ${totalTests} tests produced expected results`);
    process.exit(0);
  }
}
