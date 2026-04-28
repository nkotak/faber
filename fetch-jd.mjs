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
 * Docs:
 *   Greenhouse Job Board API: https://developers.greenhouse.io/job-board.html
 *   Ashby Posting API:         https://developers.ashbyhq.com/docs/posting-api-overview
 *   Lever Postings API:        https://github.com/lever/postings-api
 */

const FETCH_TIMEOUT_MS = 30_000;

function log(msg) {
  process.stderr.write(`[fetch-jd] ${msg}\n`);
}

function usage(code = 2) {
  process.stderr.write('Usage: node fetch-jd.mjs "<URL>"\n');
  process.exit(code);
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'faber fetch-jd/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// URL classifiers
// ---------------------------------------------------------------------------

function classifyGreenhouse(u) {
  // https://job-boards.greenhouse.io/{slug}/jobs/{id}
  // https://boards.greenhouse.io/{slug}/jobs/{id}
  // https://job-boards.eu.greenhouse.io/{slug}/jobs/{id}
  const m = u.match(/https?:\/\/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/);
  return m ? { platform: 'greenhouse', slug: m[1], id: m[2] } : null;
}

function classifyAshby(u) {
  // https://jobs.ashbyhq.com/{slug}/{uuid}
  // https://jobs.ashbyhq.com/{slug}/{uuid}/application
  const m = u.match(/https?:\/\/jobs\.ashbyhq\.com\/([^/]+)\/([0-9a-f-]{8,})/i);
  return m ? { platform: 'ashby', slug: m[1], id: m[2] } : null;
}

function classifyLever(u) {
  // https://jobs.lever.co/{slug}/{uuid}
  const m = u.match(/https?:\/\/jobs\.lever\.co\/([^/]+)\/([0-9a-f-]{8,})/i);
  return m ? { platform: 'lever', slug: m[1], id: m[2] } : null;
}

// ---------------------------------------------------------------------------
// Per-platform fetchers — each returns { title, company, location, content }
// ---------------------------------------------------------------------------

async function fetchGreenhouseJob({ slug, id }) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?content=true`;
  const data = await fetchWithTimeout(url);
  // Greenhouse returns { title, location, content (HTML-escaped), departments, ... }
  return {
    title: data.title || '',
    location: data.location?.name || '',
    content: decodeHtmlEntities(data.content || ''),
    departments: (data.departments || []).map(d => d.name).join(', '),
    source: url,
  };
}

async function fetchAshbyJob({ slug, id }) {
  // Ashby's public posting-api exposes the whole board; filter for the job.
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
  const data = await fetchWithTimeout(url);
  const job = (data.jobs || []).find(j => j.id === id || j.jobUrl?.includes(id));
  if (!job) throw new Error(`Ashby job ${id} not found in board ${slug}`);
  return {
    title: job.title || '',
    location: job.location || '',
    content: job.descriptionHtml ? decodeHtmlEntities(job.descriptionHtml) : (job.descriptionPlain || ''),
    departments: job.department || job.team || '',
    compensation: job.compensation?.compensationTierSummary || '',
    source: url,
  };
}

async function fetchLeverJob({ slug, id }) {
  const url = `https://api.lever.co/v0/postings/${slug}/${id}`;
  const data = await fetchWithTimeout(url);
  if (!data || !data.text) throw new Error(`Lever job ${id} returned empty`);
  return {
    title: data.text || '',
    location: data.categories?.location || (data.categories?.allLocations || []).join(', ') || '',
    content: data.descriptionPlain || stripHtml(data.description || ''),
    departments: data.categories?.team || '',
    source: url,
  };
}

// ---------------------------------------------------------------------------
// HTML utils
// ---------------------------------------------------------------------------

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function stripHtml(s) {
  return decodeHtmlEntities(
    s
      .replace(/<\/?(p|br|li|ul|ol|h\d|div|section|article)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const url = process.argv[2];
  if (!url) usage(2);

  const classifier =
    classifyGreenhouse(url) ||
    classifyAshby(url) ||
    classifyLever(url);

  if (!classifier) {
    log(`No ATS API match for URL — caller should fall through to agent-browser / Playwright / WebFetch.`);
    process.exit(2);
  }

  log(`Platform: ${classifier.platform} | slug: ${classifier.slug} | id: ${classifier.id}`);

  let job;
  try {
    switch (classifier.platform) {
      case 'greenhouse':
        job = await fetchGreenhouseJob(classifier);
        break;
      case 'ashby':
        job = await fetchAshbyJob(classifier);
        break;
      case 'lever':
        job = await fetchLeverJob(classifier);
        break;
    }
  } catch (err) {
    log(`Fetch failed: ${err.message}`);
    process.exit(1);
  }

  // Emit a plain-text JD block the worker can feed into the evaluation prompt.
  const content = stripHtml(job.content || '');
  const out = [
    `# ${job.title}`,
    '',
    `**URL:** ${url}`,
    `**Platform:** ${classifier.platform}`,
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

main().catch(err => {
  log(`fatal: ${err.message}`);
  process.exit(1);
});
