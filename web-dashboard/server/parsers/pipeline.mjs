// pipeline.mjs - parse data/pipeline.md for pending URLs.
// Port of dashboard/internal/data/career.go ParsePipelinePending.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const RE_PENDING = /^\s*-\s*\[\s*\]\s*(\S+?)(?:\s*\|\s*(.+))?$/;

async function resolvePipelinePath(careerOpsRoot) {
  const candidates = [
    path.join(careerOpsRoot, 'data', 'pipeline.md'),
    path.join(careerOpsRoot, 'pipeline.md'),
  ];
  for (const p of candidates) {
    try {
      await readFile(p, 'utf-8');
      return p;
    } catch {
      // next
    }
  }
  return null;
}

export async function loadPipelinePending(careerOpsRoot) {
  const filePath = await resolvePipelinePath(careerOpsRoot);
  if (!filePath) return { pending: [], filePath: null };

  const text = await readFile(filePath, 'utf-8');
  const out = [];
  let section = '';

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '');
    const trimmed = raw.trim();

    if (trimmed.startsWith('### ')) {
      section = trimmed.slice(4).trim();
      const em = section.indexOf('\u2014');
      if (em > 0) section = section.slice(0, em).trim();
      continue;
    }
    if (trimmed.startsWith('## ')) {
      let hdr = trimmed.slice(3).trim();
      const em = hdr.indexOf('\u2014');
      if (em > 0) hdr = hdr.slice(0, em).trim();
      if (hdr !== 'Pending' && hdr !== 'Processed') {
        section = hdr;
      }
      continue;
    }

    const m = raw.match(RE_PENDING);
    if (!m) continue;
    const url = m[1];
    if (
      !url.startsWith('http://') &&
      !url.startsWith('https://') &&
      !url.startsWith('local:')
    ) {
      continue;
    }

    let company = '';
    let role = '';
    let location = '';
    if (m[2]) {
      const parts = m[2].split('|');
      company = (parts[0] ?? '').trim();
      role = (parts[1] ?? '').trim();
      // Optional 4th column (added with location_filter rollout 2026-04).
      // Older entries don't have it; treat missing as ''.
      location = (parts[2] ?? '').trim();
    }

    out.push({
      url,
      company,
      role,
      location,
      section,
      lineNumber: i + 1,
      rawLine: raw,
    });
  }

  return { pending: out, filePath };
}
