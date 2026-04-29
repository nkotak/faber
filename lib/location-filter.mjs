/**
 * lib/location-filter.mjs — Pure filter logic for matching ATS-emitted location
 * strings against a user's location_filter config block in config/profile.yml.
 *
 * No I/O. Imported by scan-apis.mjs (pre-pipeline filtering) and by the two
 * cleanup scripts (cleanup-region-mismatch.mjs, cleanup-dead-jobs.mjs for
 * inferring whether a "discarded" should mention region).
 *
 * Public surface:
 *   - loadAliases(builtinAliases, customAliases?) → Map<canonical, Set<variant>>
 *   - normalizeLocation(rawLocation, aliasMap) → string[]   // canonical names that match
 *   - matchesFilter(rawLocation, filterConfig, aliasMap) → { pass, reason, matched }
 */

// Note: em-dash (—) is intentionally NOT a separator; it's a region qualifier
// in strings like "Remote — Americas" or "Remote — EU". Splitting on it would
// turn "Remote — EMEA" into ["Remote", "EMEA"] and lose the rejection signal.
const MULTI_LOCATION_SEPARATORS = /\s*(?:\||\/|;| or | OR | and | AND | & |, then |, plus )\s*/;

const REMOTE_TOKENS = ['remote', 'anywhere', 'distributed', 'work from anywhere', 'fully remote'];

const REGION_ALIASES = {
  us: ['us', 'u.s.', 'usa', 'united states', 'states-side', 'stateside'],
  americas: ['americas', 'north america', 'na', 'latam', 'south america'],
  emea: ['emea', 'europe', 'eu', 'european union', 'uk', 'united kingdom'],
  apac: ['apac', 'asia', 'asia-pacific', 'asia pacific'],
  global: ['global', 'worldwide', 'anywhere'],
};

/**
 * Merge built-in alias map with user-provided custom aliases. Returns a
 * Map<canonicalName, Set<variantLowercase>>. Both inputs are objects with
 * { canonicalName: [variant, variant, ...] } shape; user wins on conflict.
 */
export function loadAliases(builtinAliases, customAliases = {}) {
  const map = new Map();
  const ingest = (source) => {
    for (const [canonical, variants] of Object.entries(source)) {
      if (canonical.startsWith('_')) continue; // skip _comment-style metadata keys
      if (!Array.isArray(variants)) continue;
      const set = map.get(canonical) ?? new Set();
      for (const v of variants) {
        if (typeof v === 'string' && v.trim()) {
          set.add(v.trim().toLowerCase());
        }
      }
      // Also include the canonical name itself as a variant
      set.add(canonical.trim().toLowerCase());
      map.set(canonical, set);
    }
  };
  ingest(builtinAliases);
  ingest(customAliases);
  return map;
}

/**
 * Given a raw location string, return all canonical names from the alias map
 * that match (case-insensitive substring on either side). Multiple canonicals
 * can match the same string — e.g., "Brooklyn, NY" matches "NYC".
 */
export function normalizeLocation(rawLocation, aliasMap) {
  if (!rawLocation || typeof rawLocation !== 'string') return [];
  const lower = rawLocation.toLowerCase();
  const matches = [];
  for (const [canonical, variants] of aliasMap) {
    for (const variant of variants) {
      if (lower.includes(variant)) {
        matches.push(canonical);
        break;
      }
    }
  }
  return matches;
}

/**
 * Split a location string on common multi-location separators.
 * E.g., "San Francisco | NYC | Remote" → ["San Francisco", "NYC", "Remote"].
 */
function splitLocations(raw) {
  if (!raw) return [''];
  return raw.split(MULTI_LOCATION_SEPARATORS).map((s) => s.trim()).filter(Boolean);
}

/**
 * Detect whether a string indicates a remote role and (if present) which
 * region. Returns { isRemote: bool, region: string|null }.
 *
 * "Remote — Americas" → { isRemote: true, region: 'americas' }
 * "Remote"            → { isRemote: true, region: null }
 * "San Francisco"     → { isRemote: false, region: null }
 */
function detectRemote(piece) {
  const lower = piece.toLowerCase();
  const isRemote = REMOTE_TOKENS.some((tok) => lower.includes(tok));
  if (!isRemote) return { isRemote: false, region: null };

  for (const [canonical, aliases] of Object.entries(REGION_ALIASES)) {
    for (const alias of aliases) {
      // Use word boundaries to avoid matching "us" inside "Houston"
      const wordBoundary = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i');
      if (wordBoundary.test(piece)) {
        return { isRemote: true, region: canonical };
      }
    }
  }
  return { isRemote: true, region: null };
}

/**
 * Core filter check.
 *
 * @param {string} rawLocation - The location string from the ATS API.
 * @param {object} filterConfig - The location_filter block from config/profile.yml.
 * @param {Map} aliasMap - From loadAliases().
 * @returns {{pass: boolean, reason: string, matched: string|null}}
 *
 * Reason codes:
 *   - 'filter_disabled' — pass; filter is off
 *   - 'allow_hybrid'    — pass; matched a hybrid location
 *   - 'allow_onsite'    — pass; matched an onsite location
 *   - 'allow_remote'    — pass; matched remote with accepted region
 *   - 'allow_unknown'   — pass; location empty/unknown and policy=allow
 *   - 'reject_remote_region' — fail; remote but region not accepted
 *   - 'reject_remote_disabled' — fail; remote disabled in filter
 *   - 'reject_no_match' — fail; no allow rule matched
 *   - 'reject_unknown'  — fail; location empty/unknown and policy=deny
 */
export function matchesFilter(rawLocation, filterConfig, aliasMap) {
  // Disabled or missing filter → everything passes (back-compat default).
  if (!filterConfig || !filterConfig.enabled) {
    return { pass: true, reason: 'filter_disabled', matched: null };
  }

  const remote = filterConfig.remote ?? { enabled: false, accept_regions: [], bare_remote_policy: 'unknown' };
  const hybridLocations = filterConfig.hybrid?.locations ?? [];
  const onsiteLocations = filterConfig.onsite?.locations ?? [];
  const unknownPolicy = filterConfig.unknown_policy ?? 'ask';

  // Empty location string → apply unknown policy
  const trimmed = (rawLocation ?? '').trim();
  if (!trimmed) {
    if (unknownPolicy === 'allow' || unknownPolicy === 'ask') {
      return { pass: true, reason: 'allow_unknown', matched: null };
    }
    return { pass: false, reason: 'reject_unknown', matched: null };
  }

  const pieces = splitLocations(trimmed);

  // We want ANY piece to pass for the job to pass (multi-location postings).
  // Track best-known reason for diagnostics.
  let bestRejectReason = 'reject_no_match';

  for (const piece of pieces) {
    const remoteInfo = detectRemote(piece);

    if (remoteInfo.isRemote) {
      if (!remote.enabled) {
        bestRejectReason = 'reject_remote_disabled';
        continue;
      }
      const acceptRegions = (remote.accept_regions ?? []).map((r) => String(r).toLowerCase());

      if (remoteInfo.region) {
        // Remote with explicit region — must be in accept list.
        // Note: 'global' in accept_regions matches ONLY when the JD explicitly
        // says "Remote — Worldwide" (region === 'global'), not as a wildcard.
        if (acceptRegions.includes(remoteInfo.region)) {
          return { pass: true, reason: 'allow_remote', matched: `remote:${remoteInfo.region}` };
        }
        bestRejectReason = 'reject_remote_region';
        continue;
      }

      // Bare "Remote" — no region detected
      const bare = remote.bare_remote_policy ?? 'unknown';
      if (bare === 'allow') {
        return { pass: true, reason: 'allow_remote', matched: 'remote:bare' };
      }
      if (bare === 'unknown' && (unknownPolicy === 'allow' || unknownPolicy === 'ask')) {
        return { pass: true, reason: 'allow_unknown', matched: 'remote:bare' };
      }
      bestRejectReason = 'reject_remote_region';
      continue;
    }

    // Non-remote piece — check hybrid/onsite allow lists via alias matching
    const canonicals = normalizeLocation(piece, aliasMap);

    for (const canonical of canonicals) {
      if (hybridLocations.includes(canonical)) {
        return { pass: true, reason: 'allow_hybrid', matched: canonical };
      }
      if (onsiteLocations.includes(canonical)) {
        return { pass: true, reason: 'allow_onsite', matched: canonical };
      }
    }
  }

  return { pass: false, reason: bestRejectReason, matched: null };
}

// ---------------------------------------------------------------------------
// Validation block (run via `node lib/location-filter.mjs`)
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const builtin = {
    NYC: ['NYC', 'New York City', 'New York, NY', 'Manhattan', 'Brooklyn'],
    NJ: ['NJ', 'New Jersey', 'Jersey City'],
    'Bay Area': ['San Francisco', 'SF', 'Bay Area', 'Palo Alto'],
    London: ['London', 'London, UK'],
    Paris: ['Paris', 'Paris, France'],
  };
  const aliases = loadAliases(builtin, {});

  const filter = {
    enabled: true,
    remote: { enabled: true, accept_regions: ['us', 'americas'], bare_remote_policy: 'allow' },
    hybrid: { locations: ['NYC', 'NJ'] },
    onsite: { locations: [] },
    unknown_policy: 'ask',
  };

  const cases = [
    ['New York, NY', true, 'allow_hybrid', 'NYC'],
    ['Brooklyn, NY', true, 'allow_hybrid', 'NYC'],
    ['Jersey City, NJ', true, 'allow_hybrid', 'NJ'],
    ['Paris, France', false, 'reject_no_match', null],
    ['London, UK', false, 'reject_no_match', null],
    ['Remote — Americas', true, 'allow_remote', 'remote:americas'],
    ['Remote — EMEA', false, 'reject_remote_region', null],
    ['Remote', true, 'allow_remote', 'remote:bare'],
    ['', true, 'allow_unknown', null],
    ['San Francisco | NYC | Remote', true, 'allow_hybrid', 'NYC'],
    ['San Francisco | London', false, 'reject_no_match', null],
    ['Paris, France or NYC', true, 'allow_hybrid', 'NYC'],
  ];

  let failures = 0;
  for (const [input, expectPass, expectReason, expectMatched] of cases) {
    const r = matchesFilter(input, filter, aliases);
    const ok = r.pass === expectPass && r.reason === expectReason && r.matched === expectMatched;
    if (!ok) {
      failures++;
      console.error(`✗ "${input}" → expected pass=${expectPass} reason=${expectReason} matched=${expectMatched}`);
      console.error(`     got      pass=${r.pass} reason=${r.reason} matched=${r.matched}`);
    }
  }

  // Disabled filter passes everything
  const disabled = matchesFilter('Mars Colony', { enabled: false }, aliases);
  if (!disabled.pass || disabled.reason !== 'filter_disabled') {
    failures++;
    console.error(`✗ disabled filter should pass everything, got: ${JSON.stringify(disabled)}`);
  }

  if (failures > 0) {
    console.error(`\n❌ ${failures} of ${cases.length + 1} tests failed`);
    process.exit(1);
  }
  console.log(`✅ All ${cases.length + 1} location-filter tests passed`);
}
