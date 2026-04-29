# Mode: cleanup — Pipeline & Tracker Cleanup

Two cleanup operations are available; route on the sub-argument:

| Sub-arg | Mode | What it does |
|---------|------|---------------|
| (empty) | `discovery` | Show the cleanup menu |
| `dead`  | `dead-jobs` | Run two-strikes liveness sweep |
| `region`| `region-mismatch` | Remove entries that don't match `config/profile.yml` `location_filter` |
| `both` / `all` | Run dead first, then region | |

Confirmation flow for both: **always run `--dry-run` first**, present the proposed changes to the user, wait for explicit confirmation, then run live. NEVER blast through to `--apply` without showing the user what's about to change.

---

## Discovery (no sub-arg)

Print:

```
faber cleanup — pick one:

  /faber cleanup dead   → Two-strikes liveness sweep
                         Walks data/applications.md + data/pipeline.md, hits each
                         URL with Playwright, marks confirmed-dead entries Discarded.
                         State persists in data/liveness-cache.tsv.

  /faber cleanup region → Region mismatch pruning
                         Reads config/profile.yml location_filter, removes pipeline
                         rows whose location field doesn't match. Marks evaluated
                         applications Discarded with a "region mismatch" note.

  /faber cleanup both   → Run dead first, then region

Both operations write .bak backups before mutating, and a --dry-run preview
runs first so you see the diff before applying.
```

Then ask the user which one they want.

---

## Sub-mode: `dead-jobs`

### Step 1 — Pre-flight info

Print a one-line summary by running:
```bash
node verify-pipeline.mjs 2>&1 | tail -3
```
Confirm the data files are healthy before proceeding.

### Step 2 — Dry-run

Run:
```bash
node cleanup-dead-jobs.mjs --dry-run --concurrency=4 --limit=100 --verbose
```

Capture the stderr summary block:
```
Results:
  ✅ N active   ❌ N expired   ⚠️  N uncertain

Changes (would apply, but --dry-run):
  applications.md: N marked Discarded   N tentative (1st strike)
  pipeline.md: N flipped to [!]   N tentative (1st strike)
```

### Step 3 — Present + confirm

Show the user the dry-run summary as a clean markdown block. Then ask:

> "Apply these changes? (yes / no / show details)"

- `no` → exit cleanly, suggest re-running later.
- `show details` → re-run with no `--limit` and `--verbose`, then re-prompt.
- `yes` → proceed to Step 4.

### Step 4 — Apply

Run the same command WITHOUT `--dry-run`:
```bash
node cleanup-dead-jobs.mjs --concurrency=4 --limit=100 --verbose
```

Show the user the post-apply summary including the backup paths.

### Step 5 — Suggest follow-ups

If the run produced any "tentative (1st strike)" entries, tell the user:
> "N entries are tentatively expired. Re-run `/faber cleanup dead` in ~7 days to confirm — the second consecutive failure flips them to Discarded."

Optionally:
> "Want this to run automatically? Use `/schedule` to set up a weekly cleanup cron."

---

## Sub-mode: `region-mismatch`

### Step 1 — Pre-flight: confirm filter is configured

Run:
```bash
grep -A2 "^location_filter:" config/profile.yml 2>&1 | head -5
```

If `config/profile.yml` doesn't have a `location_filter` block (or `enabled: false`), tell the user:
> "No location filter is configured in config/profile.yml. Set one up in the Settings → Location filter pane (web dashboard) or by uncommenting the block in config/profile.example.yml and editing your config/profile.yml. Aborting cleanup."

Don't run the script in this case.

### Step 2 — Dry-run

Run:
```bash
node cleanup-region-mismatch.mjs --dry-run --verbose
```

Capture the summary block:
```
Filter: hybrid=["NYC","NJ"], remote_regions=["us","americas","global"]

Results:
  pipeline.md: N mismatches (would remove)
  applications.md: N mismatches (would mark Discarded)
```

### Step 3 — Present + confirm

Show the user the filter being applied AND the proposed changes. Be explicit about which locations were rejected (e.g., "Paris (3), London (2), Berlin (1)") so the user can sanity-check the filter rules.

Ask:
> "Apply these changes? (yes / no / show details)"

### Step 4 — Apply

Run without `--dry-run`:
```bash
node cleanup-region-mismatch.mjs --verbose
```

Pipeline rows are moved to a `## Discarded — region mismatch (DATE)` section at the bottom of `data/pipeline.md` (audit trail preserved). Evaluated apps in `data/applications.md` get status flipped to `Discarded` with a `Region mismatch (LOCATION) — filter excluded {date}` note.

### Step 5 — Suggest follow-ups

> "Pipeline now reflects your current location filter. Re-running `/faber scan` will only add jobs that match — the filter is applied at scan time too, so this should be the last region cleanup you need to run for that filter version."

---

## Sub-mode: `both` / `all`

Run `dead-jobs` first (it doesn't depend on the filter), then `region-mismatch`. This order matters because:
1. Dead-jobs may reduce the candidate set for region cleanup (a 404 URL doesn't need its location checked).
2. Region cleanup may move entries to a "Discarded — region" section, which would be a poor input for liveness checks.

Show one combined final summary at the end.

---

## Constraints

- NEVER auto-apply without dry-run + confirmation.
- NEVER skip the `.bak` backup; both scripts handle this internally.
- NEVER touch entries with terminal statuses (`Rejected`, `Offer`, `Interview`, `Responded`, `Discarded`, `SKIP`) — those are active conversations or already terminal; the cleanup scripts already respect this.
- DO surface the backup paths so the user knows where to restore from if they made a mistake.
