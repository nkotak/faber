// Package jobs owns background subprocess plumbing for the dashboard.
//
// Spawn starts `claude -p "/faber pdf <reportPath>" --output-format stream-json`
// as a goroutine, parses each JSON event into a human-readable progress label,
// and pushes messages back into the Bubble Tea Update loop via tea.Program.Send.
// The caller gets a context.CancelFunc it can invoke to kill the job early.
package jobs

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// StartedMsg is emitted once cmd.Start succeeds.
type StartedMsg struct {
	Number int
}

// ProgressMsg carries a parsed progress label for a running job.
type ProgressMsg struct {
	Number int
	Label  string
}

// DoneMsg is emitted when the subprocess exits (success, failure, or killed).
type DoneMsg struct {
	Number   int
	Err      error
	ExitCode int
}

// hardTimeout is the maximum wall-clock duration for a single job.
// Opus 8-stage CV generation (read cv.md + report, map bullets, rewrite,
// write HTML, run generate-pdf.mjs → Playwright) realistically takes
// 8-15 minutes. 35 gives generous headroom for slow API days, rate
// limits, and the extra render passes introduced by the auto-fit ladder
// in generate-pdf.mjs (up to 9 Playwright attempts per PDF).
const hardTimeout = 35 * time.Minute

// Spawn starts a CV generation job in a goroutine.
// Returns a context.CancelFunc the caller can invoke to kill the job.
// Messages (StartedMsg / ProgressMsg / DoneMsg) flow back to the Tea Update
// loop via program.Send.
//
// If logPath is non-empty, every stream-json line is appended to that file
// for out-of-band debugging (tail -f).
func Spawn(
	program *tea.Program,
	careerOpsPath, reportPath string,
	number int,
	logPath string,
) context.CancelFunc {
	ctx, cancel := context.WithTimeout(context.Background(), hardTimeout)

	go func() {
		defer cancel()

		cmd := exec.CommandContext(
			ctx,
			"claude",
			"-p",
			fmt.Sprintf("/faber pdf %s", reportPath),
			"--output-format", "stream-json",
			"--verbose",
			// Without this, claude -p runs in restricted mode: Write and
			// Bash tool calls are silently denied. Claude reads files and
			// generates HTML in memory, then cannot write /tmp/cv-candidate-
			// *.html or invoke `node generate-pdf.mjs`, so no PDF is ever
			// produced. The skill invocation is trusted (user-authored),
			// so bypass is safe here.
			"--permission-mode=bypassPermissions",
		)
		cmd.Dir = careerOpsPath

		stdout, err := cmd.StdoutPipe()
		if err != nil {
			program.Send(DoneMsg{Number: number, Err: err, ExitCode: -1})
			return
		}
		// Merge stderr into stdout so any claude diagnostics come through the
		// same channel the parser reads.
		cmd.Stderr = cmd.Stdout

		if err := cmd.Start(); err != nil {
			program.Send(DoneMsg{Number: number, Err: err, ExitCode: -1})
			return
		}
		program.Send(StartedMsg{Number: number})

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
				fmt.Fprintf(logFile, "\n==== job #%d started %s ====\n",
					number, time.Now().Format(time.RFC3339))
			}
		}

		// Scan line-by-line. stream-json lines can be large (tool inputs,
		// long assistant messages), so allocate a generous buffer.
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)

		for scanner.Scan() {
			line := scanner.Bytes()
			if logFile != nil {
				logFile.Write(line)
				logFile.Write([]byte{'\n'})
			}
			if label := parseStreamJSON(line); label != "" {
				program.Send(ProgressMsg{Number: number, Label: label})
			}
		}
		// Drain any remaining stderr (shouldn't happen since we merged, but
		// defensive in case cmd.Stderr assignment didn't land).
		_, _ = io.Copy(io.Discard, stdout)

		err = cmd.Wait()
		exitCode := 0
		if cmd.ProcessState != nil {
			exitCode = cmd.ProcessState.ExitCode()
		}

		if logFile != nil {
			fmt.Fprintf(logFile, "==== job #%d done exit=%d err=%v ====\n",
				number, exitCode, err)
		}

		program.Send(DoneMsg{
			Number:   number,
			Err:      err,
			ExitCode: exitCode,
		})
	}()

	return cancel
}

// streamEvent is a partial schema for claude stream-json events. We only care
// about the fields that give us a human-readable progress label.
type streamEvent struct {
	Type    string          `json:"type"`
	Subtype string          `json:"subtype,omitempty"`
	Name    string          `json:"name,omitempty"`
	Input   json.RawMessage `json:"input,omitempty"`
	Message json.RawMessage `json:"message,omitempty"`
}

// parseStreamJSON turns a single stream-json line into a short progress label
// ("Reading cv.md", "Writing HTML", "Rendering PDF", ...). Returns "" when the
// line has no meaningful signal for the progress UI.
func parseStreamJSON(line []byte) string {
	// Fast reject for non-JSON lines.
	if len(line) == 0 || line[0] != '{' {
		return ""
	}
	var ev streamEvent
	if err := json.Unmarshal(line, &ev); err != nil {
		return ""
	}

	switch ev.Type {
	case "system":
		switch ev.Subtype {
		case "init":
			return "Starting Claude"
		case "hook_started", "hook_response":
			return "" // ignore hook chatter
		}
	case "assistant":
		// Inspect nested message.content[].type for tool_use / text
		if label := labelFromAssistantMessage(ev.Message); label != "" {
			return label
		}
	case "tool_use":
		return labelFromToolUse(ev.Name, ev.Input)
	case "result":
		// Final result event — let DoneMsg handle the UI flip, don't relabel
		return ""
	}
	return ""
}

// labelFromAssistantMessage inspects a nested assistant message payload and
// returns a label derived from the first tool_use or text block it finds.
func labelFromAssistantMessage(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var msg struct {
		Content []struct {
			Type  string          `json:"type"`
			Name  string          `json:"name,omitempty"`
			Input json.RawMessage `json:"input,omitempty"`
			Text  string          `json:"text,omitempty"`
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &msg); err != nil {
		return ""
	}
	for _, c := range msg.Content {
		switch c.Type {
		case "tool_use":
			if label := labelFromToolUse(c.Name, c.Input); label != "" {
				return label
			}
		case "text":
			if t := strings.TrimSpace(strings.ReplaceAll(c.Text, "\n", " ")); t != "" {
				if len(t) > 60 {
					t = t[:60] + "…"
				}
				return t
			}
		}
	}
	return ""
}

// labelFromToolUse maps a (tool_name, input) pair to a short operator label.
func labelFromToolUse(name string, input json.RawMessage) string {
	switch name {
	case "Read":
		var in struct {
			FilePath string `json:"file_path"`
		}
		_ = json.Unmarshal(input, &in)
		if in.FilePath != "" {
			return "Reading " + filepath.Base(in.FilePath)
		}
		return "Reading file"
	case "Write":
		var in struct {
			FilePath string `json:"file_path"`
		}
		_ = json.Unmarshal(input, &in)
		if in.FilePath != "" {
			return "Writing " + filepath.Base(in.FilePath)
		}
		return "Writing file"
	case "Edit":
		var in struct {
			FilePath string `json:"file_path"`
		}
		_ = json.Unmarshal(input, &in)
		if in.FilePath != "" {
			return "Editing " + filepath.Base(in.FilePath)
		}
		return "Editing file"
	case "Bash":
		var in struct {
			Command     string `json:"command"`
			Description string `json:"description"`
		}
		_ = json.Unmarshal(input, &in)
		switch {
		case strings.Contains(in.Command, "generate-pdf"):
			return "Rendering PDF"
		case strings.Contains(in.Command, "playwright"):
			return "Running Playwright"
		case in.Description != "":
			if len(in.Description) > 30 {
				return in.Description[:30] + "…"
			}
			return in.Description
		}
		return "Running command"
	case "Grep":
		return "Searching"
	case "Glob":
		return "Finding files"
	case "WebFetch":
		return "Fetching URL"
	case "WebSearch":
		return "Web search"
	}
	if name != "" {
		return "Using " + name
	}
	return ""
}
