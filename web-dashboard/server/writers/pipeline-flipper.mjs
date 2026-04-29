// pipeline-flipper.mjs - flip `- [ ] {url}` → `- [x] {url}` in data/pipeline.md.
//
// Called as a deterministic post-success hook on /api/jobs/eval so a URL that
// got evaluated through the dashboard disappears from the Queue UI without
// requiring claude to do the housekeeping (claude is non-deterministic about
// these side effects). Works for any pending row regardless of which section
// it's in — manually-added rows under "### Manually added", scanned rows
// under "### Scanned YYYY-MM-DD", etc.
//
// Idempotent: if the URL is already `[x]` or absent, returns ok:false with a
// reason but does not throw.

import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {string} careerOpsRoot
 * @param {string} url - the pending URL to flip
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function markUrlEvaluated(careerOpsRoot, url) {
  if (!url || typeof url !== 'string') {
    return { ok: false, reason: 'no url' };
  }

  const pipelinePath = path.join(careerOpsRoot, 'data', 'pipeline.md');
  if (!existsSync(pipelinePath)) {
    return { ok: false, reason: 'pipeline.md not found' };
  }

  const text = await readFile(pipelinePath, 'utf-8');
  const lines = text.split('\n');

  // Match a Pending row whose URL is the one we just evaluated. We anchor on
  // `- [ ]` followed by whitespace and the literal URL (URL is the first
  // non-whitespace token after the checkbox). Substring-after-URL containment
  // is fine because rows are `- [ ] {url} | ...` — the URL is followed by a
  // space-pipe or end-of-line.
  const PENDING_RE = /^(\s*)-\s*\[\s*\]\s*(\S+)/;
  let flippedAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(PENDING_RE);
    if (!m) continue;
    if (m[2] !== url) continue;
    // Found the row. Replace the checkbox in-place; preserve everything else
    // (including the URL, delimiters, trailing fields).
    lines[i] = lines[i].replace(/^(\s*)-\s*\[\s*\]/, '$1- [x]');
    flippedAt = i;
    break;
  }

  if (flippedAt < 0) {
    return { ok: false, reason: 'no matching pending row' };
  }

  await copyFile(pipelinePath, pipelinePath + '.bak');
  await writeFile(pipelinePath, lines.join('\n'), 'utf-8');
  return { ok: true };
}
