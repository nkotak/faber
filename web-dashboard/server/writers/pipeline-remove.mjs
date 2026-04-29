// pipeline-remove.mjs - hard-delete a row from data/pipeline.md by URL.
//
// Used by the queue's per-row × button. Matches both `- [ ]` (pending) and
// `- [x]` (evaluated) rows so the user can wipe noise from either state.
// Returns ok:false with a reason when the URL isn't found, but does not
// throw — the UI can show the no-op as a toast.
//
// Backup is written as data/pipeline.md.bak. Idempotent: re-running on a
// missing URL is a no-op.

import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {string} careerOpsRoot
 * @param {string} url - the URL to remove from data/pipeline.md
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function removePipelineUrl(careerOpsRoot, url) {
  if (!url || typeof url !== 'string') {
    return { ok: false, reason: 'no url' };
  }

  const pipelinePath = path.join(careerOpsRoot, 'data', 'pipeline.md');
  if (!existsSync(pipelinePath)) {
    return { ok: false, reason: 'pipeline.md not found' };
  }

  const text = await readFile(pipelinePath, 'utf-8');
  const lines = text.split('\n');

  // Match `- [ ]` or `- [x]` rows where the URL is the first non-whitespace
  // token after the checkbox. Anchored on the URL so partial substring
  // matches in notes can't accidentally remove the wrong row.
  const ROW_RE = /^(\s*)-\s*\[[ xX!]\]\s*(\S+)/;
  let removedAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ROW_RE);
    if (!m) continue;
    if (m[2] !== url) continue;
    removedAt = i;
    break;
  }

  if (removedAt < 0) {
    return { ok: false, reason: 'url not found in pipeline.md' };
  }

  // Splice the line out. If the row was the only line in a subsection and
  // would leave a stray header, that's left alone for now — `## Pending`
  // and `### Manually added` are tiny enough that an empty header doesn't
  // hurt readability.
  lines.splice(removedAt, 1);

  await copyFile(pipelinePath, pipelinePath + '.bak');
  await writeFile(pipelinePath, lines.join('\n'), 'utf-8');
  return { ok: true };
}
