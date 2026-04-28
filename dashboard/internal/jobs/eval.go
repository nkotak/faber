package jobs

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// EvalStartedMsg is emitted once cmd.Start succeeds for an eval job.
type EvalStartedMsg struct {
	URL string
}

// EvalProgressMsg carries a parsed progress label for a running eval job.
type EvalProgressMsg struct {
	URL   string
	Label string
}

// EvalDoneMsg is emitted when the eval subprocess exits (success, failure,
// or killed).
type EvalDoneMsg struct {
	URL      string
	Err      error
	ExitCode int
}

// SpawnEval starts an auto-pipeline evaluation job for a single URL in a
// goroutine and returns a CancelFunc. It runs:
//
//	claude -p "/faber {url}"
//	       --output-format stream-json
//	       --verbose
//	       --permission-mode=bypassPermissions
//
// The --permission-mode flag is required: without it, claude -p silently
// refuses Write/Bash tools and the auto-pipeline cannot save the report or
// generate the PDF. See jobs/pdf.go for the same fix.
//
// Messages (EvalStartedMsg / EvalProgressMsg / EvalDoneMsg) flow back to
// the Tea Update loop via program.Send. If logPath is non-empty, every
// stream-json line is appended to that file for out-of-band debugging.
func SpawnEval(
	program *tea.Program,
	careerOpsPath, url, logPath string,
) context.CancelFunc {
	ctx, cancel := context.WithTimeout(context.Background(), hardTimeout)

	go func() {
		defer cancel()

		// Dashboard-eval mode: run the evaluation pipeline but skip both PDF
		// generation AND the full interview-prep research step. Those are
		// triggered separately from the dashboard with `p` (PDF) and `i`
		// (interview prep) — one key per artifact, each independently opt-in
		// per row after the user reviews the score.
		prompt := fmt.Sprintf(`/faber %s

DASHBOARD EVAL MODE — follow modes/auto-pipeline.md but with these overrides:

1. JD extraction priority (per modes/auto-pipeline.md Step 0):
   - First try `+"`"+`node fetch-jd.mjs "%s"`+"`"+` — if exit code 0, use its stdout as the JD
   - If exit 2 (non-API URL), fall through to agent-browser, then Playwright MCP, then WebFetch, then WebSearch
2. A-F evaluation + report .md: run normally
3. Story bank: append Block F STAR+R stories to interview-prep/story-bank.md (this is automatic per modes/offer.md)
4. Tracker TSV: write normally to batch/tracker-additions/
5. Flip pipeline.md line from - [ ] to - [x] with score and PDF ❌ (no PDF generated)
6. **SKIP PDF GENERATION.** Do not write /tmp/cv-candidate-*.html, do not invoke
   generate-pdf.mjs. Mark PDF as ❌ in the tracker.
7. **SKIP FULL INTERVIEW-PREP REPORT.** Do not run modes/interview-prep.md;
   do not write interview-prep/{slug}.md. The user will invoke that separately
   from the dashboard (i key) after reviewing the score.

The user will invoke /faber pdf separately (P key) and interview-prep
separately (i key) from the dashboard after reviewing the score.`, url, url)

		cmd := exec.CommandContext(
			ctx,
			"claude",
			"-p",
			prompt,
			"--output-format", "stream-json",
			"--verbose",
			"--permission-mode=bypassPermissions",
		)
		cmd.Dir = careerOpsPath

		stdout, err := cmd.StdoutPipe()
		if err != nil {
			program.Send(EvalDoneMsg{URL: url, Err: err, ExitCode: -1})
			return
		}
		cmd.Stderr = cmd.Stdout

		if err := cmd.Start(); err != nil {
			program.Send(EvalDoneMsg{URL: url, Err: err, ExitCode: -1})
			return
		}
		program.Send(EvalStartedMsg{URL: url})

		// Optional log tee
		var logFile *os.File
		if logPath != "" {
			logFile, err = os.OpenFile(
				logPath,
				os.O_APPEND|os.O_CREATE|os.O_WRONLY,
				0o644,
			)
			if err == nil {
				defer logFile.Close()
				fmt.Fprintf(logFile, "\n==== eval %s started %s ====\n",
					url, time.Now().Format(time.RFC3339))
			}
		}

		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)

		for scanner.Scan() {
			line := scanner.Bytes()
			if logFile != nil {
				logFile.Write(line)
				logFile.Write([]byte{'\n'})
			}
			if label := parseStreamJSON(line); label != "" {
				program.Send(EvalProgressMsg{URL: url, Label: label})
			}
		}
		_, _ = io.Copy(io.Discard, stdout)

		err = cmd.Wait()
		exitCode := 0
		if cmd.ProcessState != nil {
			exitCode = cmd.ProcessState.ExitCode()
		}

		if logFile != nil {
			fmt.Fprintf(logFile, "==== eval %s done exit=%d err=%v ====\n",
				url, exitCode, err)
		}

		program.Send(EvalDoneMsg{
			URL:      url,
			Err:      err,
			ExitCode: exitCode,
		})
	}()

	return cancel
}
