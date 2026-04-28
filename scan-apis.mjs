#!/usr/bin/env node

/**
 * scan-apis.mjs — Fetch job listings from ATS APIs (Ashby, Lever, Greenhouse)
 *
 * Reads portals.yml, identifies companies with platform: ashby|lever|greenhouse,
 * fetches their public JSON APIs in parallel, and outputs compact job listings
 * to stdout as JSON.
 *
 * Option B design: NO title filtering. Returns ALL jobs so the agent can apply
 * its own judgment. Title filtering happens in modes/scan.md, not here.
 *
 * Usage:
 *   node scan-apis.mjs                    # Fetch all API-eligible companies
 *   node scan-apis.mjs --platform=ashby   # Fetch only Ashby companies
 *   node scan-apis.mjs --company=anthropic # Fetch a single company by slug
 *   node scan-apis.mjs --summary          # Print counts only, no job list
 *
 * Output (stdout): JSON array of job objects:
 *   { title, url, company, department, location, compensation, platform, slug }
 *
 * Docs:
 *   Ashby Posting API: https://developers.ashbyhq.com/docs/posting-api-overview
 *   Lever Postings API: https://github.com/lever/postings-api
 *   Greenhouse Job Board API: https://developers.greenhouse.io/job-board.html
 *
 * Sample output:
 *   [
 *     {
 *       "title": "Senior Product Manager, Claude Code",
 *       "url": "https://job-boards.greenhouse.io/anthropic/jobs/123",
 *       "company": "Anthropic",
 *       "department": "Product",
 *       "location": "San Francisco, CA",
 *       "compensation": "$200K – $300K",
 *       "platform": "greenhouse",
 *       "slug": "anthropic"
 *     }
 *   ]
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    platform: { type: 'string' },
    company: { type: 'string' },
    summary: { type: 'boolean', default: false },
  },
  strict: false,
});

// ---------------------------------------------------------------------------
// Load portals.yml (simple YAML subset parser — avoids js-yaml dependency)
// ---------------------------------------------------------------------------

function parsePortalsYaml(text) {
  const companies = [];
  let current = null;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');

    // New company entry
    if (/^\s{2}- name:\s*(.+)/.test(line)) {
      if (current) companies.push(current);
      current = { name: line.match(/name:\s*(.+)/)[1].trim().replace(/^["']|["']$/g, '') };
      continue;
    }

    if (!current) continue;

    // Key-value pairs under current company
    const kv = line.match(/^\s{4,}(\w[\w_]*):\s*(.+)/);
    if (kv) {
      let [, key, val] = kv;
      val = val.trim().replace(/^["']|["']$/g, '');
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      current[key] = val;
    }
  }
  if (current) companies.push(current);
  return companies;
}

// ---------------------------------------------------------------------------
// API fetchers — one per platform
// ---------------------------------------------------------------------------

const API_TIMEOUT = 90_000; // Lever embeds full HTML descriptions — Spotify needs ~45s

async function fetchWithTimeout(url, timeoutMs = API_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ashby Posting API
 * GET https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
 * Returns { jobs: [...] }
 */
async function fetchAshby(company) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${company.slug}?includeCompensation=true`;
  const data = await fetchWithTimeout(url);
  return (data.jobs || []).map(job => ({
    title: job.title || '',
    url: job.jobUrl || '',
    company: company.name,
    department: job.department || job.team || '',
    location: job.location || '',
    compensation: formatAshbyComp(job.compensation),
    platform: 'ashby',
    slug: company.slug,
  }));
}

function formatAshbyComp(comp) {
  if (!comp) return '';
  if (comp.compensationTierSummary) return comp.compensationTierSummary;
  if (comp.summaryComponents?.length) {
    const c = comp.summaryComponents[0];
    if (c.minValue && c.maxValue) {
      return `$${Math.round(c.minValue / 1000)}K – $${Math.round(c.maxValue / 1000)}K`;
    }
  }
  return '';
}

/**
 * Lever Postings API
 * GET https://api.lever.co/v0/postings/{slug}
 * Returns array of posting objects
 */
async function fetchLever(company) {
  const url = `https://api.lever.co/v0/postings/${company.slug}`;
  const data = await fetchWithTimeout(url);
  return (Array.isArray(data) ? data : []).map(job => ({
    title: job.text || '',
    url: job.hostedUrl || '',
    company: company.name,
    department: job.categories?.team || '',
    location: job.categories?.location || (job.categories?.allLocations || []).join(', ') || '',
    compensation: '',  // Lever API doesn't expose comp
    platform: 'lever',
    slug: company.slug,
  }));
}

/**
 * Greenhouse Job Board API
 * GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
 * Returns { jobs: [...] }
 */
async function fetchGreenhouse(company) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs`;
  const data = await fetchWithTimeout(url);
  return (data.jobs || []).map(job => ({
    title: job.title || '',
    url: job.absolute_url || '',
    company: company.name,
    department: job.departments?.map(d => d.name).join(', ') || '',
    location: job.location?.name || '',
    compensation: '',  // Greenhouse board API doesn't expose comp
    platform: 'greenhouse',
    slug: company.slug,
  }));
}

const FETCHERS = {
  ashby: fetchAshby,
  lever: fetchLever,
  greenhouse: fetchGreenhouse,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const yamlText = readFileSync(join(ROOT, 'portals.yml'), 'utf-8');
  const companies = parsePortalsYaml(yamlText);

  // Filter to API-eligible, enabled companies
  let eligible = companies.filter(
    c => c.enabled === true && c.platform && FETCHERS[c.platform] && c.slug
  );

  // Apply CLI filters
  if (args.platform) {
    eligible = eligible.filter(c => c.platform === args.platform);
  }
  if (args.company) {
    eligible = eligible.filter(c => c.slug === args.company);
  }

  if (eligible.length === 0) {
    console.error('No API-eligible companies found matching filters.');
    process.exit(1);
  }

  // Fetch all in parallel
  const results = await Promise.allSettled(
    eligible.map(async company => {
      const fetcher = FETCHERS[company.platform];
      try {
        const jobs = await fetcher(company);
        return { company: company.name, slug: company.slug, platform: company.platform, jobs, error: null };
      } catch (err) {
        return { company: company.name, slug: company.slug, platform: company.platform, jobs: [], error: err.message };
      }
    })
  );

  const allJobs = [];
  const summary = { total: 0, byPlatform: {}, byCompany: {}, errors: [] };

  for (const result of results) {
    const val = result.status === 'fulfilled' ? result.value : {
      company: 'unknown', slug: 'unknown', platform: 'unknown', jobs: [], error: result.reason?.message,
    };

    allJobs.push(...val.jobs);

    const count = val.jobs.length;
    summary.total += count;
    summary.byPlatform[val.platform] = (summary.byPlatform[val.platform] || 0) + count;
    summary.byCompany[val.company] = count;

    if (val.error) {
      summary.errors.push({ company: val.company, slug: val.slug, error: val.error });
    }
  }

  if (args.summary) {
    // Summary mode: print counts to stdout
    console.log(JSON.stringify(summary, null, 2));
  } else {
    // Full mode: print all jobs to stdout
    console.log(JSON.stringify(allJobs));
  }

  // Always print summary to stderr so the agent can see it even in full mode
  const companyLines = Object.entries(summary.byCompany)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `  ${name}: ${count}`)
    .join('\n');

  console.error(`\nscan-apis: ${summary.total} jobs from ${eligible.length} companies`);
  console.error(`  ashby: ${summary.byPlatform.ashby || 0} | lever: ${summary.byPlatform.lever || 0} | greenhouse: ${summary.byPlatform.greenhouse || 0}`);
  console.error(companyLines);

  if (summary.errors.length > 0) {
    console.error(`\n${summary.errors.length} errors:`);
    for (const e of summary.errors) {
      console.error(`  ${e.company} (${e.slug}): ${e.error}`);
    }
  }
}

main().catch(err => {
  console.error(`scan-apis fatal: ${err.message}`);
  process.exit(1);
});
