package jobs

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// InterviewPrepStartedMsg fires once cmd.Start succeeds for an interview-prep
// generation job.
type InterviewPrepStartedMsg struct {
	ReportPath string
}

// InterviewPrepProgressMsg carries a parsed progress label.
type InterviewPrepProgressMsg struct {
	ReportPath string
	Label      string
}

// InterviewPrepDoneMsg fires when the subprocess exits.
type InterviewPrepDoneMsg struct {
	ReportPath string
	Err        error
	ExitCode   int
}

// reReportSlug parses the slug portion of a report filename.
// Kept as a small duplicate of data.reReportFilename — this package
// shouldn't depend on the data package.
var reReportSlug = regexp.MustCompile(`^\d+-(.+)-\d{4}-\d{2}-\d{2}\.md$`)

// slugFromReportPath returns the interview-prep slug for a given report path,
// or "" if the filename doesn't match the canonical pattern.
func slugFromReportPath(reportPath string) string {
	base := filepath.Base(reportPath)
	m := reReportSlug.FindStringSubmatch(base)
	if m == nil {
		return ""
	}
	return m[1]
}

// SpawnInterviewPrep starts an interview-prep research job for a company+role
// identified by a report path. Internally instructs Claude to follow
// modes/interview-prep.md end-to-end and save the full report to
// interview-prep/{slug}.md (convention shared with ScanInterviewPrep).
//
// Messages flow back via program.Send. Reuses parseStreamJSON from pdf.go.
func SpawnInterviewPrep(
	program *tea.Program,
	careerOpsPath, reportPath, company, role, logPath string,
) context.CancelFunc {
	ctx, cancel := context.WithTimeout(context.Background(), hardTimeout)

	slug := slugFromReportPath(reportPath)
	if slug == "" {
		go func() {
			program.Send(InterviewPrepDoneMsg{
				ReportPath: reportPath,
				Err:        fmt.Errorf("cannot derive slug from reportPath %q", reportPath),
				ExitCode:   -1,
			})
		}()
		return cancel
	}

	prompt := fmt.Sprintf(
		"Generate interview-prep intel for %s — %s.\n\n"+
			"Follow modes/interview-prep.md end-to-end (research Glassdoor + Blind + "+
			"LeetCode, round-by-round breakdown, story-bank mapping, tech prep "+
			"checklist, company signals). Read %s for archetype, gaps, and matched "+
			"proof points. Save the full report to interview-prep/%s.md using the "+
			"header format specified in modes/interview-prep.md. Do NOT re-run the "+
			"A-F evaluation — this is prep-only.",
		company, role, reportPath, slug,
	)

	go func() {
		defer cancel()

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
			program.Send(InterviewPrepDoneMsg{ReportPath: reportPath, Err: err, ExitCode: -1})
			return
		}
		cmd.Stderr = cmd.Stdout

		if err := cmd.Start(); err != nil {
			program.Send(InterviewPrepDoneMsg{ReportPath: reportPath, Err: err, ExitCode: -1})
			return
		}
		program.Send(InterviewPrepStartedMsg{ReportPath: reportPath})

		var logFile *os.File
		if logPath != "" {
			logFile, err = os.OpenFile(logPath,
				os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
			if err == nil {
				defer logFile.Close()
				fmt.Fprintf(logFile, "\n==== interview-prep %s started %s ====\n",
					slug, time.Now().Format(time.RFC3339))
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
				program.Send(InterviewPrepProgressMsg{
					ReportPath: reportPath,
					Label:      label,
				})
			}
		}
		_, _ = io.Copy(io.Discard, stdout)

		err = cmd.Wait()
		exitCode := 0
		if cmd.ProcessState != nil {
			exitCode = cmd.ProcessState.ExitCode()
		}

		if logFile != nil {
			fmt.Fprintf(logFile, "==== interview-prep %s done exit=%d err=%v ====\n",
				slug, exitCode, err)
		}

		program.Send(InterviewPrepDoneMsg{
			ReportPath: reportPath,
			Err:        err,
			ExitCode:   exitCode,
		})
	}()

	return cancel
}
