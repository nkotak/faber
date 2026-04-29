# Mode: scan — Portal Scanner (Offer Discovery)

Scan configured job portals, filter by title relevance, and add new offers to the pipeline for later evaluation.

## Recommended execution

Run as a subagent so it doesn't consume the main context:

```
Agent(
    subagent_type="general-purpose",
    prompt="[contents of this file + specific data]",
    run_in_background=True
)
```

## Configuration

Read `portals.yml`, which contains:
- `tracked_companies`: companies with `platform`, `slug`, and `careers_url` (the curated template defaults)
- `custom_companies`: additional user-added companies with the same shape (parallel block; see "your additions" pane in the web dashboard). Iterate them alongside `tracked_companies` for both Level 1 (API fetches in `scan-apis.mjs` already cover both via its parent-key-agnostic parser) and Level 2 (agent-browser walks).
- `search_queries`: WebSearch queries with `site:` filters (broad discovery)
- `title_filter`: positive / negative / seniority_boost keywords for title filtering

Each tracked company has a `platform` field:
- `ashby` → fetched via API (scan-apis.mjs)
- `lever` → fetched via API (scan-apis.mjs)
- `greenhouse` → fetched via API (scan-apis.mjs)
- `workable` → fetched via agent-browser CLI
- `custom` → fetched via agent-browser CLI

## Discovery strategy (3 levels)

### Level 1 — ATS APIs (PRIMARY, ~30 companies)

**Run `node scan-apis.mjs` via Bash.** This fetches all companies with `platform: ashby|lever|greenhouse` in parallel using their public JSON APIs:

- **Ashby:** `api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`
- **Lever:** `api.lever.co/v0/postings/{slug}`
- **Greenhouse:** `boards-api.greenhouse.io/v1/boards/{slug}/jobs`

Returns a JSON array to stdout with every job listing: `{title, url, company, department, location, compensation, platform, slug}`.

**No filtering is done by the script** (Option B design). The agent receives ALL jobs and applies `title_filter` from `portals.yml` using judgment — the agent can include a borderline title that keyword matching would miss.

**Advantages over browser scraping:**
- Runs in ~5 seconds (vs. 20-40 minutes with Playwright)
- 100% reliable — no browser session, no SPA rendering, no extension dependency
- Structured JSON — no accessibility tree parsing needed
- Includes compensation data (Ashby), department, team, location
- Works in any agent context (foreground, background, batch `claude -p`)

**Usage:**
```bash
node scan-apis.mjs              # Full JSON output to stdout, summary to stderr
node scan-apis.mjs --summary    # Counts only (useful for quick check)
node scan-apis.mjs --platform=ashby  # Only Ashby companies
node scan-apis.mjs --company=anthropic  # Single company by slug
```

### Level 2 — agent-browser CLI (COMPLEMENTARY, ~22 companies)

For companies with `platform: workable` or `platform: custom`, use the `agent-browser` CLI via Bash. These are companies with custom careers pages that don't expose a JSON API.

**agent-browser** is a Rust-native headless Chrome CLI (no Playwright/MCP dependency):

```bash
# Navigate to a careers page
agent-browser open "https://careers.google.com" --headless --wait="networkidle"

# Get accessibility tree snapshot (optimized for AI)
agent-browser snapshot

# Close browser when done
agent-browser close
```

**For each company with `platform: workable|custom` and `enabled: true`:**
1. `agent-browser open "{careers_url}" --headless --wait="networkidle"` via Bash
2. `agent-browser snapshot` via Bash → read job listings from the accessibility tree
3. Extract `{title, url, company}` from the snapshot
4. If the page has filters/departments, navigate relevant sections
5. If the page paginates, navigate additional pages

**Sequential only** — process one company at a time (one browser instance).

**If `agent-browser` is not installed:** Run `npm install -g agent-browser && agent-browser install` first.

**If a page fails to load (404, timeout, bot detection):** Log as `skipped_error` in scan-history.tsv and continue to the next company. Don't stop the scan.

### Level 3 — WebSearch queries (BROAD DISCOVERY)

The `search_queries` with `site:` filters cover portals cross-cutting (all of Ashby, all of Greenhouse, etc.). Useful to discover NEW companies that aren't in `tracked_companies` yet, but results can be stale.

**Execution priority:**
1. Level 1: `node scan-apis.mjs` → all API-eligible companies (5 seconds)
2. Level 2: agent-browser → every `platform: workable|custom` company with `enabled: true`
3. Level 3: WebSearch → every `search_queries` entry with `enabled: true`

The levels are additive — all run, results are merged and deduplicated.

## Workflow

1. **Read configuration**: `portals.yml`
2. **Read history**: `data/scan-history.tsv` → URLs already seen
3. **Read dedup sources**: `data/applications.md` + `data/pipeline.md`

4. **Level 1 — API scan:**
   a. Run `node scan-apis.mjs` via Bash
   b. Parse the JSON array from stdout
   c. The stderr output shows a summary (company counts + errors)
   d. Each entry already has `{title, url, company, department, location, compensation, platform, slug}`
   e. These jobs are inherently real-time and don't need liveness verification

5. **Level 2 — agent-browser scan** (sequential):
   For each company with `platform: workable|custom` and `enabled: true`:
   a. Run `agent-browser open "{careers_url}" --headless --wait="networkidle"` via Bash
   b. Run `agent-browser snapshot` via Bash to read all job listings
   c. If the page has filters/departments, navigate the relevant sections
   d. For each job listing extract: `{title, url, company}`
   e. If the page paginates, navigate additional pages
   f. Run `agent-browser close` after each company to free resources
   g. Accumulate into the candidate list
   h. If `careers_url` fails (404, redirect), try `scan_query` via WebSearch as fallback

6. **Level 3 — WebSearch queries:**
   For each query in `search_queries` with `enabled: true`:
   a. Run WebSearch with the defined `query`
   b. Extract from each result: `{title, url, company}`
      - **title**: from the result title (before " @ " or " | ")
      - **url**: result URL
      - **company**: after " @ " in the title, or extracted from domain/path
   c. Accumulate into the candidate list (dedup against Level 1+2)

7. **Filter by title** using `title_filter` from `portals.yml`:
   - Use `title_filter` as a guide, not a strict gate
   - At least 1 keyword from `positive` should appear in the title (case-insensitive)
   - 0 keywords from `negative` should appear
   - `seniority_boost` keywords give priority but are not required
   - **Use judgment**: if a title is clearly relevant despite not matching keywords (e.g., "AI Product Engineering Manager"), include it

7.5. **Filter by location** using `location_filter` from `config/profile.yml` (if configured and enabled):
   - For Level 1 jobs, `scan-apis.mjs` already applies the filter and emits a summary on stderr — no agent action needed.
   - For Level 2 (`agent-browser`) and Level 3 (`WebSearch`) results, the agent must apply the same rules manually using `lib/location-filter.mjs` semantics:
     - `allow` matches: a job's location string matches a `hybrid.locations` entry, an `onsite.locations` entry, or a `remote` rule with an accepted region.
     - `deny` is implicit: anything not matching an allow rule is rejected (and logged as `skipped_location`).
     - `unknown_policy` controls behavior for empty/unparseable location strings (`allow` / `deny` / `ask`).
   - Use built-in aliases from `config/location-aliases.json` (e.g., `NYC` ≡ "New York City" ≡ "Manhattan") plus any user-defined `custom_aliases` in `profile.yml`.
   - Multi-location postings ("San Francisco | NYC | Remote") pass if ANY piece matches an allow rule.
   - When the filter rejects a job, log it to `scan-history.tsv` with status `skipped_location` and DO NOT add it to `pipeline.md`.
   - When `location_filter` is missing or `enabled: false`, this step is a no-op (default: every location passes — same as previous behavior).

8. **Deduplicate** against 3 sources:
   - `scan-history.tsv` → exact URL already seen
   - `applications.md` → company + normalized role already evaluated
   - `pipeline.md` → exact URL already pending or processed

8.5. **Verify liveness of Level 3 (WebSearch) results** — BEFORE adding to pipeline:

   WebSearch results can be stale (Google caches results for weeks or months). To avoid evaluating expired offers, verify with agent-browser every new URL that came from Level 3. Levels 1 and 2 are inherently real-time and don't need this verification.

   For each new Level 3 URL (sequential):
   a. `agent-browser open "{url}" --headless` via Bash
   b. `agent-browser snapshot` via Bash
   c. Classify:
      - **Active**: job title visible + role description + Apply/Submit button
      - **Expired** (any of these signals):
        - Final URL contains `?error=true` (Greenhouse redirects this way when the offer is closed)
        - Page contains: "job no longer available" / "no longer open" / "position has been filled" / "this job has expired" / "page not found"
        - Only navbar and footer visible, no JD content (content < ~300 chars)
   d. If expired: log in `scan-history.tsv` with status `skipped_expired` and discard
   e. If active: continue to step 9
   f. `agent-browser close` after verification

   **Don't stop the entire scan if a single URL fails.** If agent-browser errors (timeout, 403, etc.), mark as `skipped_expired` and continue to the next.

9. **For each new verified offer that passes the filters**:
   a. Add to `pipeline.md` under the "Pending" section: `- [ ] {url} | {company} | {title} | {location}`
      The `{location}` field is appended when known. If the source didn't return a location string, omit the trailing ` | {location}` segment — older parsers tolerate the shorter line, and the dashboard renders no location pill.
   b. Log in `scan-history.tsv`: `{url}\t{date}\t{query_name}\t{title}\t{company}\tadded\t{location}`

10. **Offers filtered out by title**: log in `scan-history.tsv` with status `skipped_title`
11. **Duplicate offers**: log with status `skipped_dup`
12. **Expired offers (Level 3)**: log with status `skipped_expired`
13. **Location-rejected offers**: log with status `skipped_location` (added in 2026-04). The `location` column captures the raw location string for diagnostics.

## Extracting title and company from WebSearch results

WebSearch results come in the format: `"Job Title @ Company"` or `"Job Title | Company"` or `"Job Title — Company"`.

Extraction patterns by portal:
- **Ashby**: `"Senior AI PM (Remote) @ EverAI"` → title: `Senior AI PM`, company: `EverAI`
- **Greenhouse**: `"AI Engineer at Anthropic"` → title: `AI Engineer`, company: `Anthropic`
- **Lever**: `"Product Manager - AI @ Temporal"` → title: `Product Manager - AI`, company: `Temporal`

Generic regex: `(.+?)(?:\s*[@|—–-]\s*|\s+at\s+)(.+?)$`

## Private URLs

If a URL isn't publicly accessible:
1. Save the JD to `jds/{company}-{role-slug}.md`
2. Add to pipeline.md as: `- [ ] local:jds/{company}-{role-slug}.md | {company} | {title}`

## Scan History

`data/scan-history.tsv` tracks EVERY URL seen:

```
url	first_seen	portal	title	company	status	location
https://...	2026-02-10	Ashby — AI PM	PM AI	Acme	added	Remote — US
https://...	2026-02-10	Greenhouse — SA	Junior Dev	BigCo	skipped_title	San Francisco
https://...	2026-02-10	Ashby — AI PM	SA AI	OldCo	skipped_dup	NYC
https://...	2026-02-10	WebSearch — AI PM	PM AI	ClosedCo	skipped_expired	(empty)
https://...	2026-04-28	Lever — Mistral	Sr PM	Mistral AI	skipped_location	Paris, France
```

The `location` column was added in 2026-04 alongside the location filter. Existing rows with 6 columns continue to parse; readers should treat the 7th field as optional.

## Output summary

```
Portal Scan — {YYYY-MM-DD}
━━━━━━━━━━━━━━━━━━━━━━━━━━
Level 1 (APIs): N jobs from N companies (Ashby: N, Lever: N, Greenhouse: N)
Level 2 (agent-browser): N jobs from N companies
Level 3 (WebSearch): N results from N queries
Total offers found: N
Filtered by title: N relevant
Duplicates: N (already evaluated or in pipeline)
Expired discarded: N (dead links, Level 3)
New entries added to pipeline.md: N

  + {company} | {title} | {source_level}
  ...

→ Run /faber pipeline to evaluate the new offers.
```

## portals.yml maintenance

- **Platform field** determines the scan method — update when companies switch ATS
- **slug field** must match the ATS slug (derivable from careers_url)
- Add new queries as new portals or interesting roles are discovered
- Disable queries with `enabled: false` if they generate too much noise
- Adjust filter keywords as target roles evolve
- Add companies to `tracked_companies` when they're worth tracking closely
- If an API returns 404, the company may have switched ATS — update `platform` to `custom` and set a new `careers_url`
- Companies that moved ATS platforms are noted in portals.yml with comments

## Known platform patterns for `careers_url`

- **Ashby:** `https://jobs.ashbyhq.com/{slug}`
- **Greenhouse:** `https://job-boards.greenhouse.io/{slug}` or `https://job-boards.eu.greenhouse.io/{slug}`
- **Lever:** `https://jobs.lever.co/{slug}`
- **Workable:** `https://apply.workable.com/{slug}`
- **Custom:** company's own URL (e.g., `https://openai.com/careers`)

## Dependencies

- **Node.js** (for `scan-apis.mjs`)
- **agent-browser** CLI (for Level 2): `npm install -g agent-browser && agent-browser install`
- **WebSearch** tool (for Level 3)
