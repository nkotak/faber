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

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { parseYaml } from './lib/yaml-mini.mjs';
import { loadAliases, matchesFilter } from './lib/location-filter.mjs';
import { fetchAtsBoard, ATS_PLATFORMS } from './lib/ats-clients.mjs';

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
    'no-location-filter': { type: 'boolean', default: false },
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
// Location filter loader
// ---------------------------------------------------------------------------

/**
 * Read config/profile.yml's location_filter block and config/location-aliases.json.
 * Returns { filterConfig, aliasMap } or null if no filter is configured / disabled.
 *
 * If --no-location-filter is set OR profile.yml is missing OR location_filter is
 * absent OR location_filter.enabled is falsy, returns null and the script keeps
 * its previous (pre-filter) behavior.
 */
function loadFilterContext() {
  if (args['no-location-filter']) return null;

  const profilePath = join(ROOT, 'config', 'profile.yml');
  if (!existsSync(profilePath)) return null;

  let profile;
  try {
    profile = parseYaml(readFileSync(profilePath, 'utf-8'));
  } catch (err) {
    console.error(`scan-apis: failed to parse config/profile.yml — disabling location filter (${err.message})`);
    return null;
  }

  const filterConfig = profile?.location_filter;
  if (!filterConfig || !filterConfig.enabled) return null;

  // Load alias map (built-in + user custom_aliases)
  const aliasPath = join(ROOT, 'config', 'location-aliases.json');
  let builtinAliases = {};
  if (existsSync(aliasPath)) {
    try {
      builtinAliases = JSON.parse(readFileSync(aliasPath, 'utf-8'));
    } catch (err) {
      console.error(`scan-apis: failed to parse location-aliases.json (${err.message})`);
    }
  }
  const aliasMap = loadAliases(builtinAliases, filterConfig.custom_aliases ?? {});

  return { filterConfig, aliasMap };
}

// ---------------------------------------------------------------------------
// Per-platform mappers — convert raw board data into scan-output shape
// HTTP + timeout + error handling lives in lib/ats-clients.mjs.
// ---------------------------------------------------------------------------

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

const MAPPERS = {
  ashby: (job, company) => ({
    title: job.title || '',
    url: job.jobUrl || '',
    company: company.name,
    department: job.department || job.team || '',
    location: job.location || '',
    compensation: formatAshbyComp(job.compensation),
    platform: 'ashby',
    slug: company.slug,
  }),
  lever: (job, company) => ({
    title: job.text || '',
    url: job.hostedUrl || '',
    company: company.name,
    department: job.categories?.team || '',
    location: job.categories?.location || (job.categories?.allLocations || []).join(', ') || '',
    compensation: '', // Lever API doesn't expose comp
    platform: 'lever',
    slug: company.slug,
  }),
  greenhouse: (job, company) => ({
    title: job.title || '',
    url: job.absolute_url || '',
    company: company.name,
    department: job.departments?.map((d) => d.name).join(', ') || '',
    location: job.location?.name || '',
    compensation: '', // Greenhouse board API doesn't expose comp
    platform: 'greenhouse',
    slug: company.slug,
  }),
};

async function fetchCompanyJobs(company) {
  const mapper = MAPPERS[company.platform];
  if (!mapper) throw new Error(`No mapper for platform ${company.platform}`);
  const raw = await fetchAtsBoard({ platform: company.platform, slug: company.slug });
  return raw.map((job) => mapper(job, company));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const yamlText = readFileSync(join(ROOT, 'portals.yml'), 'utf-8');
  const companies = parsePortalsYaml(yamlText);

  // Filter to API-eligible, enabled companies
  let eligible = companies.filter(
    c => c.enabled === true && c.platform && ATS_PLATFORMS.includes(c.platform) && c.slug
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
      try {
        const jobs = await fetchCompanyJobs(company);
        return { company: company.name, slug: company.slug, platform: company.platform, jobs, error: null };
      } catch (err) {
        return { company: company.name, slug: company.slug, platform: company.platform, jobs: [], error: err.message };
      }
    })
  );

  // Load location filter context (null when disabled or unconfigured)
  const filterCtx = loadFilterContext();

  const allJobs = [];
  const summary = {
    total: 0,
    byPlatform: {},
    byCompany: {},
    errors: [],
    location: { applied: !!filterCtx, kept: 0, rejected: 0, byReason: {} },
  };

  for (const result of results) {
    const val = result.status === 'fulfilled' ? result.value : {
      company: 'unknown', slug: 'unknown', platform: 'unknown', jobs: [], error: result.reason?.message,
    };

    // Apply location filter to this company's jobs
    let kept = val.jobs;
    if (filterCtx) {
      kept = [];
      for (const job of val.jobs) {
        const r = matchesFilter(job.location, filterCtx.filterConfig, filterCtx.aliasMap);
        if (r.pass) {
          kept.push(job);
          summary.location.kept++;
        } else {
          summary.location.rejected++;
          summary.location.byReason[r.reason] = (summary.location.byReason[r.reason] || 0) + 1;
        }
      }
    }

    allJobs.push(...kept);

    const count = kept.length;
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

  if (summary.location.applied) {
    console.error(`\nlocation filter: kept ${summary.location.kept}, rejected ${summary.location.rejected}`);
    for (const [reason, n] of Object.entries(summary.location.byReason).sort((a, b) => b[1] - a[1])) {
      console.error(`  ${reason}: ${n}`);
    }
  }

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
