#!/usr/bin/env node

/**
 * fetch-jd.mjs — Extract a job description from a URL via the fastest
 * available method.
 *
 * Priority:
 *   1. ATS JSON API (Greenhouse, Ashby, Lever) — ~200ms, structured content
 *   2. (future) agent-browser fallback — not auto-invoked from this script
 *
 * Exits 0 on success with the JD text on stdout (plain text, not JSON).
 * Exits 2 if the URL isn't an API-supported ATS — the caller should fall
 * through to agent-browser / Playwright / WebFetch / WebSearch.
 * Exits 1 on fetch error (network, 404, auth).
 *
 * Usage:
 *   node fetch-jd.mjs "https://job-boards.greenhouse.io/anthropic/jobs/4985920008"
 *   node fetch-jd.mjs "https://jobs.ashbyhq.com/cohere/abc123"
 *   node fetch-jd.mjs "https://jobs.lever.co/mistral/xyz789"
 *
 * URL classification + ATS API logic lives in lib/ats-clients.mjs (shared
 * with scan-apis.mjs and the cleanup scripts).
 */

import { classifyAtsUrl, fetchAtsJob, stripHtmlContent } from './lib/ats-clients.mjs';

function log(msg) {
  process.stderr.write(`[fetch-jd] ${msg}\n`);
}

function usage(code = 2) {
  process.stderr.write('Usage: node fetch-jd.mjs "<URL>"\n');
  process.exit(code);
}

async function main() {
  const url = process.argv[2];
  if (!url) usage(2);

  const classified = classifyAtsUrl(url);
  if (!classified) {
    log('No ATS API match for URL — caller should fall through to agent-browser / Playwright / WebFetch.');
    process.exit(2);
  }

  log(`Platform: ${classified.platform} | slug: ${classified.slug} | id: ${classified.id}`);

  let job;
  try {
    job = await fetchAtsJob(classified);
  } catch (err) {
    log(`Fetch failed: ${err.message}`);
    process.exit(1);
  }

  // Emit a plain-text JD block the worker can feed into the evaluation prompt.
  const content = stripHtmlContent(job.content || '');
  const out = [
    `# ${job.title}`,
    '',
    `**URL:** ${url}`,
    `**Platform:** ${classified.platform}`,
    job.location ? `**Location:** ${job.location}` : '',
    job.departments ? `**Department:** ${job.departments}` : '',
    job.compensation ? `**Compensation:** ${job.compensation}` : '',
    '',
    '---',
    '',
    content,
  ].filter(Boolean).join('\n');

  process.stdout.write(out + '\n');
}

main().catch((err) => {
  log(`fatal: ${err.message}`);
  process.exit(1);
});
