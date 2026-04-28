# Dashboard Async PDF Jobs — Implementation Plan

**Status:** Design approved-in-spirit; awaiting final sign-off on open questions.
**Origin:** User reported that `tea.ExecProcess`-based PDF generation (current `p` keybinding) leaves the terminal looking blank — no indication generation is happening, no progress, no stage info. Looks identical to "the dashboard quit."

---

## 1. Root cause (two compounding problems)

### 1.1 `tea.ExecProcess` exits the alt-screen

When `tea.ExecProcess` fires, Bubble Tea calls `p.ReleaseTerminal()` which sends `\033[?1049l` to exit the alt-screen buffer. The terminal switches back to the **normal screen buffer**, which contains whatever was on screen before the TUI launched — typically blank, or stale shell history. The alt-screen history is preserved but not visible; the subprocess writes to the normal buffer, which scrolls from empty or from old lines.

This alone would be survivable: even though the "dashboard seems to quit" feels bad, if claude's tokens streamed to the terminal, you'd see activity.

### 1.2 `claude -p` does not stream when stdout is a pipe

Confirmed by three open/closed GitHub issues in `anthropics/claude-code`:

- [#25670](https://github.com/anthropics/claude-code/issues/25670) — `claude -p --output-format stream-json` piped to another process becomes **block-buffered (4–8KB chunks)**. Output does not flush line-by-line. Workaround `stdbuf -oL` is unavailable on macOS.
- [#9026](https://github.com/anthropics/claude-code/issues/9026) — `claude -p` **hangs without a TTY in the process tree**. A Go `exec.Cmd` without `creack/pty` gives the child a pipe, not a TTY → child sees `isatty(stdout)==false` → suppresses output or hangs.
- [#29213](https://github.com/anthropics/claude-code/issues/29213) — Even with a TTY, output is chunked, not token-by-token. Good for progress beats, bad for real-time token streaming.

So: even if we fixed the alt-screen issue, **piped `claude -p` produces no visible output until it completes or is given a TTY**. The fix must address the subprocess side, not just the Bubble Tea side.

### 1.3 Three workable fixes to the subprocess side (pick one)

| Approach | Pros | Cons |
|---|---|---|
| **A. Allocate PTY via `github.com/creack/pty`** | Real streaming, behaves exactly like interactive claude | New dependency; PTY lifecycle is finicky; raw ANSI escape codes leak into our output (need to strip) |
| **B. `claude -p --output-format stream-json`** | Documented streaming format (despite #25670's buffering — it still flushes on JSON message boundaries, which are every few tokens for stream-json, unlike text mode which flushes only at end); structured events we can parse for progress labels | JSON parsing overhead; the 4–8KB block issue still applies so progress updates arrive in bursts (tolerable for 30–60s jobs with 2-3 visible updates) |
| **C. Tee subprocess stdout to a file + poll** | Works without PTY or JSON; simplest subprocess code | Polling adds latency; requires disk writes; parsing text output is brittle |

**Recommendation: B, with A as upgrade path if B's flush cadence proves too coarse.** Stream-json gives structured tool-use events (`{"type":"tool_use","name":"Read","input":{...}}`) that map cleanly to "Reading cv.md…" / "Writing /tmp/cv-candidate-clay.html…" status lines. And even at 4–8KB block-buffering, a 30-second job produces multiple bursts — enough for the user to see "it's alive."

---

## 2. Design overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│ appModel (main.go)                                                       │
│                                                                          │
│   pipeline PipelineModel   ◄──── Update(msg) ◄──── tea.Msg pump          │
│   program  *tea.Program    ──┐                           ▲               │
│                              │                           │               │
└──────────────────────────────┼───────────────────────────┼───────────────┘
                               │ passed to goroutines      │ p.Send(msg)
                               ▼                           │
                     ┌─────────────────────┐               │
                     │ goroutine per job   │               │
                     │                     │               │
                     │ exec.CommandContext │               │
                     │   claude -p         │               │
                     │   --output-format   │               │
                     │   stream-json       │               │
                     │                     │               │
                     │ stdout.Pipe()       │               │
                     │    │                │               │
                     │    ▼                │               │
                     │ bufio.Scanner       │──── parsed ───┘
                     │   (per line)        │     ProgressMsg{Number, label}
                     │                     │
                     │ cmd.Wait()          │──── DoneMsg{Number, exitCode, err}
                     └─────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ PipelineModel (pipeline.go)                                              │
│                                                                          │
│   jobs         map[int]*pdfJob    ← keyed by app.Number                  │
│   jobOrder     []int              ← stable display order (queue-like)    │
│   spinnerFrame int                ← 0..9 for brail dots animation        │
│                                                                          │
│   renderJobsBar() ── row-chips ──► "⣯ #156 Clay (0:43) Reading cv.md…"  │
│                                                                          │
│   tea.Tick every 250ms while len(jobs)>0 → advance spinner + elapsed    │
└─────────────────────────────────────────────────────────────────────────┘
```

Every state mutation still goes through `Update(msg)`; goroutines never touch model fields directly. The goroutine → Update pump is `p.Send(msg)`.

---

## 3. The six design decisions (committed)

**3.1 State model** — `pdfJob` struct in `dashboard/internal/ui/screens/pipeline.go`:
```go
type pdfJobStatus int
const (
    jobRunning pdfJobStatus = iota
    jobSucceeded
    jobFailed
    jobCancelled
)

type pdfJob struct {
    Number      int
    Company     string
    Role        string
    ReportPath  string
    Status      pdfJobStatus
    StartedAt   time.Time
    FinishedAt  time.Time        // zero if still running
    LastLabel   string           // "Reading cv.md" / "Writing HTML" / "Rendering PDF" / ...
    Err         error
    ExitCode    int
    Cancel      context.CancelFunc
    ToastUntil  time.Time        // when the terminal-state chip should disappear
}
```
Collection: `jobs map[int]*pdfJob` keyed by `app.Number` (unique per row). `jobOrder []int` preserves insertion order for left-to-right display. Safety: map access only inside `Update(msg)`.

**3.2 Spawn mechanism** — new file `dashboard/internal/jobs/pdf.go`:
```go
package jobs

func Spawn(
    program *tea.Program,
    careerOpsPath, reportPath string,
    number int, company, role string,
) context.CancelFunc {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)

    go func() {
        defer cancel()

        cmd := exec.CommandContext(ctx, "claude",
            "-p", fmt.Sprintf("/faber pdf %s", reportPath),
            "--output-format", "stream-json",
            "--verbose",  // required for stream-json per claude CLI docs
        )
        cmd.Dir = careerOpsPath

        stdout, err := cmd.StdoutPipe()
        if err != nil {
            program.Send(DoneMsg{Number: number, Err: err})
            return
        }
        cmd.Stderr = cmd.Stdout  // merge for simplicity

        if err := cmd.Start(); err != nil {
            program.Send(DoneMsg{Number: number, Err: err})
            return
        }

        program.Send(StartedMsg{Number: number})

        scanner := bufio.NewScanner(stdout)
        scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)  // stream-json lines can be large
        for scanner.Scan() {
            label := parseStreamJSON(scanner.Bytes())
            if label != "" {
                program.Send(ProgressMsg{Number: number, Label: label})
            }
        }

        err = cmd.Wait()
        program.Send(DoneMsg{
            Number:   number,
            Err:      err,
            ExitCode: cmd.ProcessState.ExitCode(),
        })
    }()

    return cancel
}

// parseStreamJSON extracts a human-readable label from a single stream-json line.
// Stream-json events of interest:
//   {"type":"tool_use","name":"Read","input":{"file_path":"/.../cv.md"}}  → "Reading cv.md"
//   {"type":"tool_use","name":"Write","input":{"file_path":"/tmp/..."}}   → "Writing HTML"
//   {"type":"tool_use","name":"Bash","input":{"command":"node generate-pdf..."}} → "Rendering PDF"
//   {"type":"text","text":"..."}                                          → first ~60 chars
// Returns "" if the line has no useful label (ignore).
func parseStreamJSON(line []byte) string { /* … */ }

type StartedMsg  struct { Number int }
type ProgressMsg struct { Number int; Label string }
type DoneMsg     struct { Number int; Err error; ExitCode int }
```

The `*tea.Program` reference is captured in `main()` (where `tea.NewProgram(...)` returns it) and stored on `*appModel`. The appModel switches to **pointer receivers** (small refactor — currently value receivers throughout `main.go`).

**3.3 Progress signal** — Single bottom status bar above the existing help bar. Renders one chip per active/recently-completed job:

```
⣯ #156 Clay Labs (0:43) Writing HTML  ✓ #164 Hopper (0:58)  ⣾ #172 Spotify (0:12) Reading cv.md
─────────────────────────────────────────────────────────────────────────────────────────────────
↑↓ nav  ←→ tabs  s sort  Enter report  o open URL  p pdf  x cancel  c change  v view  Esc quit                          faber
```

- **Spinner glyphs:** brail dots `⣾⣽⣻⢿⡿⣟⣯⣷` (8 frames, the `charmbracelet/bubbles` spinner default). Advances at 4fps (250ms tick) **only while ≥1 job is active** — no CPU cost when idle.
- **Elapsed:** `MM:SS` since `StartedAt`, computed at render time.
- **Label:** last parsed `ProgressMsg.Label`, truncated to ~20 chars to fit multiple chips on one line.
- **Terminal chips:** ✓ (green) for succeeded, ✗ (red) for failed, ⊘ (yellow) for cancelled. Remain visible for **5s for success**, **10s for failure/cancel** so user has time to read, then the tick handler prunes them.
- **When 0 jobs:** the whole bar collapses to zero height (no visual debt when idle).

**3.4 Completion** — Goroutine's `DoneMsg` handler in `main.go`:
1. Look up the job in `pipeline.jobs[msg.Number]`.
2. Set `Status = jobSucceeded|jobFailed`, `FinishedAt = time.Now()`, `Err = msg.Err`, `ExitCode = msg.ExitCode`, `ToastUntil = now + (5s|10s)`.
3. Cancel the per-job context (no-op if already done; defensive).
4. Trigger the existing `pipelineReloadMsg` path to re-parse `applications.md` so `HasPDF` updates — **but preserve `pipeline.jobs` across the rebuild** (the current `CopyReportCache` call is extended with `CopyJobsState`).

**3.5 Cancellation** — new keybinding `x`:
- If current row has a running job (`app.Number in pipeline.jobs && jobs[n].Status == jobRunning`), emit `PipelineCancelPDFMsg{Number}`.
- Handler calls `jobs[n].Cancel()` (the `context.CancelFunc` from `exec.CommandContext`). `exec` kills the process group; `cmd.Wait()` returns `*exec.ExitError`; goroutine's existing `DoneMsg` path handles cleanup.
- `p` on a row that already has a running job: no-op + brief flash ("Job already running for #156"). Don't auto-cancel-and-restart — that's footgunny.
- 5-minute hard timeout: the `context.WithTimeout` in `Spawn` kills any job that runs past 5 minutes. `DoneMsg.Err` will be `context.DeadlineExceeded`; UI shows "timed out."

**3.6 UI placement** — **status bar above help bar** (not a jobs panel, not modal, not per-row inline badge). Rationale:
- User said "some indicator" — minimal UI surface is right.
- Status bar is always visible without toggling.
- Multiple jobs display horizontally; 3-4 fit on a typical terminal width.
- Zero real-estate cost when idle.
- Per-row inline badges were considered and rejected: they require more render-loop changes and duplicate information better served centrally.

---

## 4. Implementation blueprint

### 4.1 New file: `dashboard/internal/jobs/pdf.go`
~90 LOC covering: `Spawn()`, `parseStreamJSON()`, `StartedMsg`, `ProgressMsg`, `DoneMsg`. Zero dependencies on the screens package — fully self-contained.

### 4.2 Modified: `dashboard/internal/ui/screens/pipeline.go`

**New types** (near line 46, after existing Msg types):
```go
type PipelineCancelPDFMsg struct{ Number int }
type PipelineSpinnerTickMsg struct{}
```

**New state fields on `PipelineModel`** (near the existing cache / cursor fields):
```go
jobs         map[int]*pdfJob
jobOrder     []int
spinnerFrame int
```

**New methods** (at end of file, before `renderHelp`):
```go
func (m *PipelineModel) StartPDFJob(j *pdfJob)
func (m *PipelineModel) UpdatePDFJobLabel(number int, label string)
func (m *PipelineModel) CompletePDFJob(number int, err error, exit int)
func (m *PipelineModel) CancelPDFJob(number int) (context.CancelFunc, bool)
func (m *PipelineModel) PrunePDFJobs()            // drops chips whose ToastUntil has passed
func (m *PipelineModel) HasActivePDFJobs() bool   // true iff any job is running OR chip still visible
func (m *PipelineModel) AdvanceSpinner()          // m.spinnerFrame = (m.spinnerFrame+1) % 8
func (m *PipelineModel) CopyJobsState(src *PipelineModel)  // used by pipelineReloadMsg
func (m PipelineModel) renderJobsBar() string     // one chip per job in m.jobOrder
```

**Keybind additions** in `handleKey()`:
- `case "p":` — check if `app.Number` already has a running job. If yes → toast "Job already running" (via a transient `flashMsg` handled by the tick cycle). If no → emit `PipelineStartPDFMsg{CareerOpsPath, ReportPath, Number, Company, Role}` (renamed from the existing `PipelineGeneratePDFMsg` for clarity).
- `case "x":` — if current row has a running job, emit `PipelineCancelPDFMsg{Number}`.

**Help bar** (renderHelp, line ~790) — insert `x cancel` right after `p pdf`.

**Render integration** — in the main `View()` composition, insert `renderJobsBar()` output between the main table body and `renderHelp()`. The bar is an empty string when `len(jobs)==0`.

### 4.3 Modified: `dashboard/main.go`

**Imports** (add): `context`, `time`, the new `faber/dashboard/internal/jobs` package.

**appModel refactor** — switch to pointer receivers. Add field:
```go
type appModel struct {
    pipeline      screens.PipelineModel
    viewer        screens.ViewerModel
    state         viewState
    careerOpsPath string
    program       *tea.Program  // NEW, captured in main()
}
```

**main() changes** — capture the program reference:
```go
m := &appModel{ pipeline: pm, careerOpsPath: careerOpsPath }
p := tea.NewProgram(m, tea.WithAltScreen())
m.program = p
if _, err := p.Run(); err != nil { … }
```

**Update handler — DELETE** the current `tea.ExecProcess` branch (lines 108–128 of the old main.go).

**Update handler — ADD** these cases:

```go
case screens.PipelineStartPDFMsg:
    // Refuse if already running
    if _, running := m.pipeline.RunningJob(msg.Number); running {
        // Could show a toast; for v1, silent refusal
        return m, nil
    }
    cancel := jobs.Spawn(m.program, msg.CareerOpsPath, msg.ReportPath,
        msg.Number, msg.Company, msg.Role)
    m.pipeline.StartPDFJob(&screens.PdfJob{
        Number: msg.Number, Company: msg.Company, Role: msg.Role,
        ReportPath: msg.ReportPath,
        Status: screens.JobRunning, StartedAt: time.Now(),
        Cancel: cancel,
    })
    return m, spinnerTickCmd()

case screens.PipelineCancelPDFMsg:
    m.pipeline.CancelPDFJob(msg.Number)  // invokes the context's CancelFunc
    return m, nil

case jobs.StartedMsg:
    // No-op: we marked jobRunning at spawn time
    return m, nil

case jobs.ProgressMsg:
    m.pipeline.UpdatePDFJobLabel(msg.Number, msg.Label)
    return m, nil

case jobs.DoneMsg:
    m.pipeline.CompletePDFJob(msg.Number, msg.Err, msg.ExitCode)
    // Reload apps so HasPDF flag refreshes
    return m, func() tea.Msg {
        apps := data.ParseApplications(m.careerOpsPath)
        if apps == nil { return nil }
        return pipelineReloadMsg{apps: apps}
    }

case screens.PipelineSpinnerTickMsg:
    m.pipeline.AdvanceSpinner()
    m.pipeline.PrunePDFJobs()
    if m.pipeline.HasActivePDFJobs() {
        return m, spinnerTickCmd()  // keep ticking
    }
    return m, nil                    // stop ticking — no jobs

case pipelineReloadMsg:
    metrics := data.ComputeMetrics(msg.apps)
    old := m.pipeline
    m.pipeline = screens.NewPipelineModel(
        theme.NewTheme("catppuccin-mocha"),
        msg.apps, metrics, m.careerOpsPath,
        old.Width(), old.Height(),
    )
    m.pipeline.CopyReportCache(&old)
    m.pipeline.CopyJobsState(&old)  // NEW: preserve running jobs across reload
    return m, nil
```

**New helper**:
```go
func spinnerTickCmd() tea.Cmd {
    return tea.Tick(250*time.Millisecond, func(t time.Time) tea.Msg {
        return screens.PipelineSpinnerTickMsg{}
    })
}
```

### 4.4 `stream-json` parser (`jobs/pdf.go`)

```go
type streamEvent struct {
    Type    string          `json:"type"`
    Name    string          `json:"name,omitempty"`  // for tool_use
    Input   json.RawMessage `json:"input,omitempty"` // for tool_use
    Text    string          `json:"text,omitempty"`  // for text
    Subtype string          `json:"subtype,omitempty"` // for system
}

func parseStreamJSON(line []byte) string {
    var ev streamEvent
    if err := json.Unmarshal(line, &ev); err != nil {
        return ""
    }
    switch ev.Type {
    case "tool_use":
        switch ev.Name {
        case "Read":
            var in struct { FilePath string `json:"file_path"` }
            json.Unmarshal(ev.Input, &in)
            return "Reading " + filepath.Base(in.FilePath)
        case "Write":
            var in struct { FilePath string `json:"file_path"` }
            json.Unmarshal(ev.Input, &in)
            return "Writing " + filepath.Base(in.FilePath)
        case "Bash":
            var in struct { Command string `json:"command"` }
            json.Unmarshal(ev.Input, &in)
            if strings.Contains(in.Command, "generate-pdf") {
                return "Rendering PDF"
            }
            return "Running command"
        case "Grep", "Glob":
            return "Searching " + ev.Name
        }
    case "text":
        // Truncate to 60 chars, strip newlines
        t := strings.TrimSpace(strings.ReplaceAll(ev.Text, "\n", " "))
        if len(t) > 60 { t = t[:60] + "…" }
        return t
    case "system":
        if ev.Subtype == "init" { return "Starting Claude" }
    }
    return ""
}
```

---

## 5. Testing plan

### Smoke test sequence
1. `go build ./...` — compiles.
2. `go vet ./...` — no issues.
3. Launch dashboard. Idle state: status bar is absent (zero-height).
4. Select an evaluated row with a `ReportPath`. Press `p`.
5. Immediately verify: status bar appears with `⣯ #N CompanyName (0:00) Starting Claude`.
6. Navigate up/down to confirm TUI stays responsive.
7. Every ~3-5 seconds, label should update ("Reading cv.md", "Writing HTML", "Rendering PDF").
8. On success: chip turns green ✓, visible 5s, then disappears. Status bar collapses if no other jobs.
9. HasPDF for the row flips to ✅ (verify by visual scan of the row).

### Concurrency test
1. Press `p` on three different rows quickly.
2. Verify: three chips appear in status bar, each with independent elapsed.
3. All three complete independently. HasPDF flips for each.

### Cancellation test
1. Press `p` on a row. While it's running, press `x`.
2. Verify: chip turns to ⊘ (cancelled), visible 10s. No PDF in `output/`.
3. Navigate back to the row — HasPDF should remain ❌ (unchanged from before).

### Error test
1. Pick a row whose ReportPath doesn't exist on disk (edit applications.md manually to point at a bogus path).
2. Press `p`. Claude will fail to read the file.
3. Verify: chip turns red ✗ with the error visible briefly. Exit code shown.

### Integration with CV v2 prompt
1. Pick a real evaluated row. Press `p`. Wait for completion.
2. Open the generated PDF in `output/`. Verify it's the JD-aligned v2 output (not the old reorder-only output).
3. Verify the decision log appears in the report file (appended by Stage 8).

---

## 6. Risks & mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `stream-json` buffering is still too coarse (> 30s between labels) | Medium | Fall back to approach A (creack/pty) — adds one dependency but gives real streaming |
| `p.Send()` from many goroutines floods the message queue | Low | Bubble Tea's channel is buffered; 3 concurrent jobs at ~1 msg/sec each is fine |
| Goroutine leak if Update panics | Low | The `context.WithTimeout(5min)` ensures eventual cleanup |
| Dashboard quit while job running | Medium | For v1, `exec.CommandContext`'s context dies with the parent process → subprocess terminates. Acceptable. If the user wants detached jobs, v2 can use `syscall.Setsid` + log files |
| `claude` binary not on PATH | Medium | `exec.Command` returns `exec.ErrNotFound` → immediate `DoneMsg{Err}` → chip shows "claude not found." Document in README |
| stream-json format changes in future claude releases | Low | Our parser ignores unrecognized event types (returns ""), so unknown types just skip labeling. Label-less job still shows spinner + elapsed |
| Concurrent jobs exceed Anthropic API rate limits | Low (for typical use) | For v1, no cap. If rate limits hit, claude exits non-zero → chip shows failure. v2: add a worker-pool cap of 3 |

---

## 7. Rollback

Since `pre-cv-v2` git tag predates any dashboard changes, full rollback:

```bash
cd <faber-root>
git checkout pre-cv-v2 -- dashboard/
# Remove new file
rm -rf dashboard/internal/jobs/
cd dashboard && go build -o faber-dashboard .
```

---

## 8. Open questions for sign-off

**Q1 — Stream-json flush cadence — RESOLVED (empirically verified 2026-04-21).**

Empirical test:
```bash
claude -p "Read <faber-root>/cv.md and list section headings only. Brief." --output-format stream-json --verbose 2>&1 | (line-timestamped head)
```
Result (15s total run, 11 events):
- t=4s: first output (SessionStart hooks + system init)
- t=7s: assistant message + tool_use (Read cv.md) + tool_result
- t=15s: final assistant message + result event

First visible activity within **4 seconds** of spawn. Intermediate events every 3-8s. Good enough for progress UI — a 60-second CV generation will produce ~30-40 events, yielding multiple visible label updates. **Approach B (stream-json) confirmed; no PTY needed.**

**Q2 — Concurrent job cap: unlimited or 3?** Recommendation: unlimited for v1, add a cap later if rate limits become a problem.

**Q3 — Log file for power users?** Optional: tee every job's stream-json output to `dashboard/dashboard.log` (rotated) so power users can `tail -f` it alongside the TUI. Default off; toggle via `-log` flag. Low cost to add now.

**Q4 — Keybinding for cancel:** `x` or something else? Alternatives considered: `K` (kill — shift required, conflicting muscle memory), `Ctrl+c` (too close to SIGINT). Recommendation: `x`.

**Q5 — Should completed-chip duration be user-configurable?** Recommendation: hardcode 5s/10s for v1. Add a flag if requested.

---

## 9. Files to change

| File | Action |
|------|--------|
| `<faber-root>/dashboard/internal/jobs/pdf.go` | **NEW** (~90 LOC): `Spawn()`, `parseStreamJSON()`, `StartedMsg`/`ProgressMsg`/`DoneMsg` |
| `<faber-root>/dashboard/internal/ui/screens/pipeline.go` | MODIFY: add `pdfJob` struct, jobs map + order + spinner field to `PipelineModel`, methods (Start/UpdateLabel/Complete/Cancel/Prune/HasActive/AdvanceSpinner/CopyJobsState), `renderJobsBar()`, new `case "p"` refusal logic + `case "x"` handler, help bar `x cancel` |
| `<faber-root>/dashboard/main.go` | MODIFY: store `*tea.Program` on `*appModel`, switch to pointer receivers, **delete** existing `tea.ExecProcess` branch, add new case handlers (`PipelineStartPDFMsg`, `PipelineCancelPDFMsg`, `jobs.ProgressMsg`, `jobs.DoneMsg`, `PipelineSpinnerTickMsg`), extend `pipelineReloadMsg` to `CopyJobsState`, add `spinnerTickCmd()` helper |
| `<faber-root>/dashboard/go.mod` / `go.sum` | No new external dependencies (stdlib `encoding/json`, `bufio`, `context`, `os/exec`, `path/filepath`, `strings`, `time`) |

---

## 10. Decision

Recommend implementing this plan as specified, with stream-json as the streaming strategy. If question 1's smoke test shows stream-json isn't flushing often enough, upgrade to PTY-allocated execution (one additional dependency, one new file `pty.go` wrapping `creack/pty`) and keep everything else unchanged.
