// pipeline-inbox.mjs - append a single user-supplied URL to data/pipeline.md.
//
// The user types a URL into a Cmd+J inbox in the dashboard; this writer is the
// non-LLM equivalent of running `/faber scan` for one URL: fetch what metadata
// we can from the ATS API (title, location), dedup against existing rows, and
// append a Pending row under a `### Manually added` subsection.
//
// Bypasses title_filter intentionally — if the user typed it in, they want it.

import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { classifyAtsUrl, fetchAtsJob } from '../../../lib/ats-clients.mjs';

const SECTION_HEADER = '### Manually added';

/** Best-effort metadata fetch: returns blanks on any failure. */
async function fetchMetadata(url) {
  const cls = classifyAtsUrl(url);
  if (!cls) return { company: '', title: '', location: '' };
  try {
    const job = await fetchAtsJob(cls);
    return {
      company: job.company || cls.slug, // ATS APIs don't expose display name
      title: job.title || '',
      location: job.location || '',
    };
  } catch {
    return { company: cls.slug, title: '', location: '' };
  }
}

/**
 * Append a new Pending row to data/pipeline.md.
 *
 * @param {string} careerOpsRoot
 * @param {string} url - http(s) URL to add
 * @returns {Promise<{ok: true, row: string} | {ok: false, error: string, code?: number}>}
 */
export async function appendInboxUrl(careerOpsRoot, url) {
  if (!url || typeof url !== 'string') {
    return { ok: false, error: 'url required', code: 400 };
  }
  if (!/^https?:\/\//.test(url)) {
    return { ok: false, error: 'url must be http(s)', code: 400 };
  }

  const pipelinePath = path.join(careerOpsRoot, 'data', 'pipeline.md');
  if (!existsSync(pipelinePath)) {
    return { ok: false, error: 'data/pipeline.md not found', code: 404 };
  }

  const text = await readFile(pipelinePath, 'utf-8');

  // Dedup: a single URL substring match across the file is sufficient — every
  // row that contains a URL contains it verbatim.
  if (text.includes(url)) {
    return { ok: false, error: 'URL already in pipeline', code: 409 };
  }

  const meta = await fetchMetadata(url);
  const row = `- [ ] ${url} | ${meta.company} | ${meta.title} | ${meta.location}`;

  const next = insertUnderSection(text, SECTION_HEADER, row);

  await copyFile(pipelinePath, pipelinePath + '.bak');
  await writeFile(pipelinePath, next, 'utf-8');

  return { ok: true, row };
}

/**
 * Insert `row` under `### Manually added`. If the subsection doesn't exist,
 * create it as the first subsection inside `## Pending`. Falls back to
 * appending at end of file if `## Pending` is missing.
 */
function insertUnderSection(text, sectionHeader, row) {
  const lines = text.split('\n');

  // 1. Look for an existing `### Manually added` subsection.
  const sectionIdx = lines.findIndex((l) => l.trim() === sectionHeader);
  if (sectionIdx >= 0) {
    // Insert after the section header (and any blank line that follows).
    let insertAt = sectionIdx + 1;
    while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
    // Insert at end of this subsection (before the next `### ` or `## `).
    while (
      insertAt < lines.length &&
      !lines[insertAt].trim().startsWith('### ') &&
      !lines[insertAt].trim().startsWith('## ')
    ) {
      insertAt++;
    }
    // Trim trailing blank lines inside the section so the new row sits flush.
    while (insertAt > sectionIdx + 1 && lines[insertAt - 1].trim() === '') insertAt--;
    lines.splice(insertAt, 0, row);
    return lines.join('\n');
  }

  // 2. No existing section — create one inside `## Pending`.
  const pendingIdx = lines.findIndex((l) => l.trim() === '## Pending');
  if (pendingIdx >= 0) {
    let insertAt = pendingIdx + 1;
    // Skip the blank line + any HTML comment block right after `## Pending`.
    while (
      insertAt < lines.length &&
      (lines[insertAt].trim() === '' ||
        lines[insertAt].trim().startsWith('<!--') ||
        (insertAt > 0 && lines[insertAt - 1].includes('<!--') && !lines[insertAt - 1].includes('-->')))
    ) {
      // crude multi-line comment skip: if previous line opened a comment that
      // didn't close, keep advancing until we see `-->`.
      if (lines[insertAt].includes('-->')) {
        insertAt++;
        break;
      }
      insertAt++;
    }
    const block = ['', sectionHeader, row, ''];
    lines.splice(insertAt, 0, ...block);
    return lines.join('\n');
  }

  // 3. Fallback: append at end of file.
  return text.trimEnd() + '\n\n' + sectionHeader + '\n' + row + '\n';
}
