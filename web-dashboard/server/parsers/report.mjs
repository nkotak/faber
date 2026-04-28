// report.mjs - read a single report markdown file for the viewer endpoint.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function loadReport(careerOpsRoot, relReportPath) {
  // Security: refuse paths that escape careerOpsRoot.
  const root = path.resolve(careerOpsRoot);
  const full = path.resolve(path.join(root, relReportPath));
  if (!full.startsWith(root + path.sep)) {
    throw new Error('path traversal refused');
  }
  const content = await readFile(full, 'utf-8');
  return { content, absolutePath: full };
}

export async function loadInterviewPrep(careerOpsRoot, slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
    throw new Error('invalid slug');
  }
  const root = path.resolve(careerOpsRoot);
  const full = path.join(root, 'interview-prep', `${slug}.md`);
  const content = await readFile(full, 'utf-8');
  return { content, absolutePath: full };
}
