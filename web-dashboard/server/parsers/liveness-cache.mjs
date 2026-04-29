// liveness-cache.mjs - read data/liveness-cache.tsv as a Map<url, entry>.
//
// Cache schema (TSV):
//   url \t last_checked (YYYY-MM-DD) \t last_result \t consecutive_failures \t reason
//
// Written by cleanup-dead-jobs.mjs after each two-strikes liveness sweep.
// The queue UI displays a small "checked Nd ago" badge per pending row when
// the row's URL is present in the cache.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function loadLivenessCache(careerOpsRoot) {
  const cachePath = path.join(careerOpsRoot, 'data', 'liveness-cache.tsv');
  let text;
  try {
    text = await readFile(cachePath, 'utf-8');
  } catch {
    return new Map();
  }

  const map = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.startsWith('#')) continue;
    const fields = line.split('\t');
    if (fields.length < 4) continue;
    const [url, lastChecked, lastResult, consecutiveFailuresRaw, reason = ''] = fields;
    if (!url) continue;
    map.set(url, {
      lastChecked,
      lastResult, // 'active' | 'expired' | 'uncertain'
      consecutiveFailures: Number.parseInt(consecutiveFailuresRaw, 10) || 0,
      reason,
    });
  }
  return map;
}
