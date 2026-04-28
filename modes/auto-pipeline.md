# Mode: auto-pipeline — Full Automatic Pipeline

When the user pastes a JD (text or URL) without an explicit sub-command, run the ENTIRE pipeline in sequence:

## Step 0 — Extract JD

If the input is a **URL** (not pasted JD text), follow this extraction strategy. This mirrors the `scan` mode's Level 1 → Level 2 → Level 3 pattern: prefer the cheapest, most parallel-safe method first.

**Priority order:**

1. **ATS JSON API (preferred) — `node fetch-jd.mjs {URL}`.** Covers Greenhouse, Ashby, Lever. Runs in ~200ms per URL, structured content, parallel-safe, no browser needed. Exits 0 on success with the JD text on stdout; exits non-zero if the URL isn't an API-supported ATS.

    - Greenhouse: `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{id}?content=true`
    - Ashby: board endpoint filtered by job ID
    - Lever: `https://api.lever.co/v0/postings/{slug}/{id}`

2. **agent-browser (fallback #1, for non-API URLs).** For Workday, custom careers pages, or any URL where `fetch-jd.mjs` exits non-zero. Run via Bash:
    ```bash
    agent-browser open "{URL}" --headless --wait=networkidle
    agent-browser snapshot
    agent-browser close
    ```
    Parallel-safe (each invocation spawns its own headless Chrome instance, unlike Playwright MCP). Works in batch/`claude -p` contexts.

3. **Playwright MCP (fallback #2).** Only when running in an interactive session AND no other Playwright agent is active. Use `browser_navigate` + `browser_snapshot`. Per `modes/_shared.md:95`, NEVER run 2+ Playwright MCP agents in parallel — they share a single browser instance.

4. **WebFetch (fallback #3).** For static HTML pages (older company career pages, some aggregators like ZipRecruiter / WeLoveProduct) that render without JavaScript.

5. **WebSearch (last resort).** Search for `"role title" "company" site:{ats-domain}` on secondary portals that index the JD in static HTML.

**If no method works:** ask the candidate to paste the JD manually or share a screenshot.

**If the input is JD text** (not a URL): use it directly — no fetch needed.

## Step 1 — A-F Evaluation
Run exactly like the `offer` mode (read `modes/offer.md` for all A-F blocks).

## Step 2 — Save Report .md
Save the full evaluation to `reports/{###}-{company-slug}-{YYYY-MM-DD}.md` (see format in `modes/offer.md`).

## Step 3 — Generate PDF
Run the complete `pdf` pipeline (read `modes/pdf.md`).

## Step 4 — Draft Application Answers (only if score >= 4.5)

If the final score is >= 4.5, generate draft answers for the application form:

1. **Extract form questions**: Use Playwright to navigate to the form and take a snapshot. If questions can't be extracted, fall back to the generic ones.
2. **Generate answers** following the tone (see below).
3. **Save in the report** under the section `## G) Draft Application Answers`.

### Generic questions (use if you can't extract them from the form)

- Why are you interested in this role?
- Why do you want to work at [Company]?
- Tell us about a relevant project or achievement
- What makes you a good fit for this position?
- How did you hear about this role?

### Tone for form answers

**Position: "I'm choosing you."** The candidate has options and is choosing this company for specific reasons.

**Tone rules:**
- **Confident without arrogance**: "I've spent the past year building production AI agent systems — your role is where I want to apply that experience next"
- **Selective without being smug**: "I've been intentional about finding a team where I can contribute meaningfully from day one"
- **Specific and concrete**: Always reference something REAL from the JD or the company, and something REAL from the candidate's experience
- **Direct, no fluff**: 2-4 sentences per answer. No "I'm passionate about..." or "I would love the opportunity to..."
- **The hook is proof, not assertion**: Instead of "I'm great at X", say "I built X that does Y"

**Framework per question:**
- **Why this role?** → "Your [specific thing] maps directly to [specific thing I built]."
- **Why this company?** → Mention something concrete about the company. "I've been using [product] for [time/purpose]."
- **Relevant experience?** → A quantified proof point. "Built [X] that [metric]. Sold the company in 2025."
- **Good fit?** → "I sit at the intersection of [A] and [B], which is exactly where this role lives."
- **How did you hear?** → Honest: "Found through [portal/scan], evaluated against my criteria, and it scored highest."

**Language**: Always in the language of the JD (EN default). Apply `/tech-translate`.

## Step 5 — Update Tracker
Register in `data/applications.md` with every column, including Report and PDF as ✅.

**If any step fails**, continue with the following ones and mark the failed step as pending in the tracker.
