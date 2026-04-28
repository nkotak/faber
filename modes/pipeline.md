# Mode: pipeline — URL Inbox (Second Brain)

Process offer URLs accumulated in `data/pipeline.md`. The user adds URLs whenever they want and then runs `/faber pipeline` to process them all.

## Workflow

1. **Read** `data/pipeline.md` → look for `- [ ]` items under the "Pending" section
2. **For each pending URL**:
   a. Compute the next sequential `REPORT_NUM` (read `reports/`, take the highest number + 1). **For parallel execution, pre-assign numbers before spawning workers to avoid race conditions where all workers scan an empty `reports/` and pick the same number.**
   b. **Extract JD** using the priority chain (see below): `fetch-jd.mjs` (ATS API) → agent-browser → Playwright MCP → WebFetch → WebSearch
   c. If the URL isn't accessible → mark as `- [!]` with a note and continue
   d. **Run the full auto-pipeline**: A-F evaluation → Report .md → PDF (if score >= 3.0) → Tracker
   e. **Move from "Pending" to "Processed"**: `- [x] #NNN | URL | Company | Role | Score/5 | PDF ✅/❌`
3. **If there are 3+ pending URLs**, launch agents in parallel (Agent tool with `run_in_background`) to maximize speed. Each worker MUST use `fetch-jd.mjs` or `agent-browser` for extraction, NEVER Playwright MCP (the MCP server shares one browser instance across agents, which corrupts state — see `modes/_shared.md:95`).
4. **When finished**, show a summary table:

```
| # | Company | Role | Score | PDF | Recommended action |
```

## pipeline.md format

```markdown
## Pending
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company Inc | Senior PM
- [!] https://private.url/job — Error: login required

## Processed
- [x] #143 | https://jobs.example.com/posting/789 | Acme Corp | AI PM | 4.2/5 | PDF ✅
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF ❌
```

## Smart JD detection from a URL

This mirrors the `scan` mode's Level 1 → Level 2 → Level 3 pattern — prefer the cheapest, most parallel-safe method first.

1. **ATS JSON API (preferred):** `node fetch-jd.mjs "{URL}"`. Handles Greenhouse, Ashby, Lever via their public JSON endpoints. ~200ms per URL, structured content, parallel-safe, no browser. Exits 0 on success (JD text on stdout); exits non-zero if the URL isn't API-supported — fall through to the next method.
2. **agent-browser (fallback #1):** Rust-native headless Chrome CLI. Parallel-safe (independent instances per invocation). Works in `claude -p` batch context. Use via Bash:
    ```bash
    agent-browser open "{URL}" --headless --wait=networkidle
    agent-browser snapshot
    agent-browser close
    ```
3. **Playwright MCP (fallback #2):** `browser_navigate` + `browser_snapshot`. Only in interactive single-agent sessions. NEVER 2+ agents in parallel per `_shared.md:95`.
4. **WebFetch (fallback #3):** for static HTML pages that render without JS.
5. **WebSearch (last resort):** search secondary portals that index the JD in static HTML (e.g., Wellfound, Built In, HN Who's Hiring).

**Special cases:**
- **LinkedIn**: may require login → mark `[!]` and ask the user to paste the text
- **PDF**: if the URL points to a PDF, read it directly with the Read tool
- **`local:` prefix**: read the local file. Example: `local:jds/linkedin-pm-ai.md` → read `jds/linkedin-pm-ai.md`

## Automatic numbering

1. List every file in `reports/`
2. Extract the number from the prefix (e.g., `142-medispend...` → 142)
3. New number = max found + 1

## Source synchronization

Before processing any URL, verify sync:
```bash
node cv-sync-check.mjs
```
If there's desynchronization, warn the user before continuing.
