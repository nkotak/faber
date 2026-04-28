// writers/applications.mjs — atomic status mutations on applications.md.
//
// Port of Go UpdateApplicationStatus. Matches the row by report number (the
// [NUM] link in column 8), then swaps the status cell. Uses temp-file +
// rename so no partial writes ever land on disk.

import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

const activeWrites = new Map(); // filePath → Promise chain, acts as a mutex

async function withFileMutex(filePath, fn) {
  const prev = activeWrites.get(filePath) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  activeWrites.set(filePath, next);
  try {
    return await next;
  } finally {
    if (activeWrites.get(filePath) === next) {
      activeWrites.delete(filePath);
    }
  }
}

async function atomicWrite(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, filePath);
}

/**
 * Replace the status cell for the row whose report link is [NUM].
 * The swap is positional (split on `|`, cell 6 is status in pipe format,
 * cell 5 in tab format — keep in sync with the parser's column map).
 */
export async function updateApplicationStatus(filePath, reportNumber, newStatus) {
  if (!reportNumber) throw new Error('reportNumber required');
  return withFileMutex(filePath, async () => {
    const text = await readFile(filePath, 'utf-8');
    const lines = text.split('\n');
    const marker = `[${reportNumber}]`;
    let replaced = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim().startsWith('|')) continue;
      if (!line.includes(marker)) continue;

      // Detect delimiter (pipe-only vs mixed pipe+tab).
      if (line.includes('\t')) {
        // Mixed: leading "| " then tab-separated fields.
        const prefix = line.match(/^\|\s*/)?.[0] ?? '| ';
        const body = line.slice(prefix.length);
        const cells = body.split('\t');
        // Status is cell index 5 in tab layout (# date company role score STATUS pdf report notes).
        if (cells.length < 8) continue;
        cells[5] = ` ${newStatus} `;
        lines[i] = prefix + cells.join('\t');
        replaced = true;
        break;
      } else {
        const parts = line.split('|');
        // parts[0] = '' (before leading pipe), so status is parts[6].
        if (parts.length < 9) continue;
        parts[6] = ` ${newStatus} `;
        lines[i] = parts.join('|');
        replaced = true;
        break;
      }
    }

    if (!replaced) {
      throw new Error(`row with report marker ${marker} not found in ${path.basename(filePath)}`);
    }

    await atomicWrite(filePath, lines.join('\n'));
    return { reportNumber, newStatus };
  });
}
