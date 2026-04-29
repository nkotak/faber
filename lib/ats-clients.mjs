/**
 * lib/ats-clients.mjs — Shared ATS API client for Greenhouse, Ashby, Lever.
 *
 * Consolidates URL classification + board/job fetching logic that was previously
 * duplicated across `fetch-jd.mjs` and `scan-apis.mjs`. Both consumers now
 * import from here.
 *
 * Public API:
 *   classifyAtsUrl(url) → { platform, slug, id } | null
 *   fetchAtsBoard({ platform, slug }, opts?) → raw jobs array (platform-native shape)
 *   fetchAtsJob({ platform, slug, id }, opts?) → normalized job metadata
 *   getBoardJobId(rawJob, platform) → canonical id string
 *   indexBoardByJobId(rawJobs, platform) → Set<string>
 *   stripHtmlContent(html) → plain text
 *
 * Pure functions; no I/O outside `fetch()`. Callers manage their own
 * concurrency / memoization. Pass an external `AbortSignal` to cancel.
 *
 * Docs:
 *   Greenhouse Job Board API: https://developers.greenhouse.io/job-board.html
 *   Ashby Posting API:        https://developers.ashbyhq.com/docs/posting-api-overview
 *   Lever Postings API:       https://github.com/lever/postings-api
 */

const DEFAULT_TIMEOUT_MS = 30_000;
// Lever embeds full HTML descriptions — Spotify's board has historically taken ~45s.
// Caller can override per-call via opts.timeoutMs.
const BOARD_DEFAULT_TIMEOUT_MS = 90_000;

export const ATS_PLATFORMS = Object.freeze(['ashby', 'lever', 'greenhouse']);

// ---------------------------------------------------------------------------
// URL classifier
// ---------------------------------------------------------------------------

const GREENHOUSE_URL_RE = /https?:\/\/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/;
const ASHBY_URL_RE = /https?:\/\/jobs\.ashbyhq\.com\/([^/]+)\/([0-9a-f-]{8,})/i;
const LEVER_URL_RE = /https?:\/\/jobs\.lever\.co\/([^/]+)\/([0-9a-f-]{8,})/i;

/**
 * Parse a job URL into its platform + slug + id components.
 * Returns null if the URL doesn't match any ATS-API-backed pattern (Workable,
 * custom careers pages, etc. all return null — caller should fall through to
 * agent-browser / Playwright / WebFetch).
 *
 * @param {string} url
 * @returns {{platform: 'ashby'|'lever'|'greenhouse', slug: string, id: string} | null}
 */
export function classifyAtsUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let m;
  if ((m = url.match(GREENHOUSE_URL_RE))) {
    return { platform: 'greenhouse', slug: m[1], id: m[2] };
  }
  if ((m = url.match(ASHBY_URL_RE))) {
    return { platform: 'ashby', slug: m[1], id: m[2] };
  }
  if ((m = url.match(LEVER_URL_RE))) {
    return { platform: 'lever', slug: m[1], id: m[2] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal: fetch with timeout + AbortSignal composition
// ---------------------------------------------------------------------------

async function fetchJsonWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, userAgent = 'faber/1.0', signal } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener('abort', () => ac.abort(), { once: true });
  }
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': userAgent },
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${url}`);
      err.status = res.status;
      err.url = url;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Board fetchers — return raw, platform-native arrays
// ---------------------------------------------------------------------------

async function fetchAshbyBoardRaw(slug, opts) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
  const data = await fetchJsonWithTimeout(url, opts);
  return data.jobs || [];
}

async function fetchLeverBoardRaw(slug, opts) {
  const url = `https://api.lever.co/v0/postings/${slug}`;
  const data = await fetchJsonWithTimeout(url, opts);
  return Array.isArray(data) ? data : [];
}

async function fetchGreenhouseBoardRaw(slug, opts) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
  const data = await fetchJsonWithTimeout(url, opts);
  return data.jobs || [];
}

const BOARD_FETCHERS = {
  ashby: fetchAshbyBoardRaw,
  lever: fetchLeverBoardRaw,
  greenhouse: fetchGreenhouseBoardRaw,
};

/**
 * Fetch all jobs from an ATS board.
 *
 * @param {{platform, slug}} arg
 * @param {{timeoutMs?, userAgent?, signal?}} [opts]
 * @returns {Promise<Array<object>>} platform-native jobs array
 *
 * Throws on HTTP error (the error has `.status` and `.url` set when available).
 */
export async function fetchAtsBoard({ platform, slug }, opts = {}) {
  const fetcher = BOARD_FETCHERS[platform];
  if (!fetcher) throw new Error(`Unknown ATS platform: ${platform}`);
  if (!slug) throw new Error(`Missing slug for platform ${platform}`);
  return await fetcher(slug, { timeoutMs: BOARD_DEFAULT_TIMEOUT_MS, ...opts });
}

// ---------------------------------------------------------------------------
// Single-job fetchers — normalize to a common shape
// ---------------------------------------------------------------------------

async function fetchGreenhouseJobNormalized({ slug, id }, opts) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?content=true`;
  const data = await fetchJsonWithTimeout(url, opts);
  return {
    platform: 'greenhouse',
    slug,
    id,
    title: data.title || '',
    location: data.location?.name || '',
    company: '', // Greenhouse public API doesn't expose company name
    content: decodeHtmlEntities(data.content || ''),
    departments: (data.departments || []).map((d) => d.name).join(', '),
    compensation: '',
    source: url,
  };
}

async function fetchAshbyJobNormalized({ slug, id }, opts) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
  const data = await fetchJsonWithTimeout(url, opts);
  const job = (data.jobs || []).find((j) => j.id === id || j.jobUrl?.includes(id));
  if (!job) {
    const err = new Error(`Ashby job ${id} not found in board ${slug}`);
    err.code = 'JOB_NOT_FOUND';
    throw err;
  }
  return {
    platform: 'ashby',
    slug,
    id,
    title: job.title || '',
    location: job.location || '',
    company: '',
    content: job.descriptionHtml
      ? decodeHtmlEntities(job.descriptionHtml)
      : job.descriptionPlain || '',
    departments: job.department || job.team || '',
    compensation: job.compensation?.compensationTierSummary || '',
    source: url,
  };
}

async function fetchLeverJobNormalized({ slug, id }, opts) {
  const url = `https://api.lever.co/v0/postings/${slug}/${id}`;
  const data = await fetchJsonWithTimeout(url, opts);
  if (!data || !data.text) {
    const err = new Error(`Lever job ${id} returned empty payload`);
    err.code = 'JOB_NOT_FOUND';
    throw err;
  }
  return {
    platform: 'lever',
    slug,
    id,
    title: data.text || '',
    location: data.categories?.location || (data.categories?.allLocations || []).join(', ') || '',
    company: '',
    content: data.descriptionPlain || stripHtml(data.description || ''),
    departments: data.categories?.team || '',
    compensation: '',
    source: url,
  };
}

const JOB_FETCHERS = {
  greenhouse: fetchGreenhouseJobNormalized,
  ashby: fetchAshbyJobNormalized,
  lever: fetchLeverJobNormalized,
};

/**
 * Fetch a single job's metadata, normalized to a common shape across platforms.
 *
 * @param {{platform, slug, id}} arg
 * @param {{timeoutMs?, userAgent?, signal?}} [opts]
 * @returns {Promise<{platform, slug, id, title, location, company, content, departments, compensation, source}>}
 */
export async function fetchAtsJob({ platform, slug, id }, opts = {}) {
  const fetcher = JOB_FETCHERS[platform];
  if (!fetcher) throw new Error(`Unknown ATS platform: ${platform}`);
  if (!slug) throw new Error('Missing slug');
  if (!id) throw new Error('Missing id');
  return await fetcher({ slug, id }, opts);
}

// ---------------------------------------------------------------------------
// Liveness helpers — for cleanup-dead's tier-1 check
// ---------------------------------------------------------------------------

/**
 * Extract a canonical id from a raw job object (returned by fetchAtsBoard).
 */
export function getBoardJobId(rawJob, platform) {
  if (!rawJob) return null;
  switch (platform) {
    case 'greenhouse':
      return rawJob.id != null ? String(rawJob.id) : null;
    case 'ashby':
      return typeof rawJob.id === 'string' ? rawJob.id : null;
    case 'lever':
      return typeof rawJob.id === 'string' ? rawJob.id : null;
    default:
      return null;
  }
}

/**
 * Build a Set<string> of job ids from a board's raw jobs array.
 * Used by cleanup-dead-jobs.mjs to verify whether a specific URL's id is
 * still present in the board (active) or absent (expired).
 */
export function indexBoardByJobId(rawJobs, platform) {
  const set = new Set();
  if (!Array.isArray(rawJobs)) return set;
  for (const job of rawJobs) {
    const id = getBoardJobId(job, platform);
    if (id) set.add(id);
  }
  return set;
}

// ---------------------------------------------------------------------------
// HTML utilities
// ---------------------------------------------------------------------------

function decodeHtmlEntities(s) {
  if (!s) return '';
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
  if (!s) return '';
  return decodeHtmlEntities(
    s
      .replace(/<\/?(p|br|li|ul|ol|h\d|div|section|article)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

export { stripHtml as stripHtmlContent };

// ---------------------------------------------------------------------------
// Validation block
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const cases = [
    {
      name: 'classify greenhouse',
      input: 'https://job-boards.greenhouse.io/anthropic/jobs/4985920008',
      expect: { platform: 'greenhouse', slug: 'anthropic', id: '4985920008' },
    },
    {
      name: 'classify greenhouse EU',
      input: 'https://job-boards.eu.greenhouse.io/clarityai/jobs/123456',
      expect: { platform: 'greenhouse', slug: 'clarityai', id: '123456' },
    },
    {
      name: 'classify greenhouse legacy boards.',
      input: 'https://boards.greenhouse.io/cohere/jobs/789',
      expect: { platform: 'greenhouse', slug: 'cohere', id: '789' },
    },
    {
      name: 'classify ashby',
      input: 'https://jobs.ashbyhq.com/anthropic/abc12345-6789-abcd-ef01-234567890abc',
      expect: { platform: 'ashby', slug: 'anthropic', id: 'abc12345-6789-abcd-ef01-234567890abc' },
    },
    {
      name: 'classify lever',
      input: 'https://jobs.lever.co/mistral/c08c3a0f-9899-4e6c-8195-8b1cc24c56ff',
      expect: { platform: 'lever', slug: 'mistral', id: 'c08c3a0f-9899-4e6c-8195-8b1cc24c56ff' },
    },
    {
      name: 'classify workable returns null',
      input: 'https://apply.workable.com/huggingface/j/ABC123',
      expect: null,
    },
    {
      name: 'classify custom careers null',
      input: 'https://stripe.com/jobs/listing/abc',
      expect: null,
    },
    {
      name: 'classify empty url null',
      input: '',
      expect: null,
    },
    {
      name: 'classify garbage null',
      input: 'not-a-url',
      expect: null,
    },
  ];

  let failures = 0;
  for (const c of cases) {
    const got = classifyAtsUrl(c.input);
    const ok = JSON.stringify(got) === JSON.stringify(c.expect);
    if (!ok) {
      failures++;
      console.error(`✗ ${c.name}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
    }
  }

  // indexBoardByJobId tests
  const ghBoard = [{ id: 1, title: 'a' }, { id: 2 }, { id: '3' }];
  const ghIds = indexBoardByJobId(ghBoard, 'greenhouse');
  if (ghIds.size !== 3 || !ghIds.has('1') || !ghIds.has('2') || !ghIds.has('3')) {
    failures++;
    console.error(`✗ indexBoardByJobId greenhouse: expected {1,2,3}, got ${[...ghIds]}`);
  }

  const ashBoard = [{ id: 'uuid-a', title: 'A' }, { id: 'uuid-b' }, { /* no id */ }];
  const ashIds = indexBoardByJobId(ashBoard, 'ashby');
  if (ashIds.size !== 2 || !ashIds.has('uuid-a') || !ashIds.has('uuid-b')) {
    failures++;
    console.error(`✗ indexBoardByJobId ashby: expected {uuid-a,uuid-b}, got ${[...ashIds]}`);
  }

  if (failures > 0) {
    console.error(`\n❌ ${failures} of ${cases.length + 2} tests failed`);
    process.exit(1);
  }
  console.log(`✅ All ${cases.length + 2} ats-clients tests passed`);
}
