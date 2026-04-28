package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"faber/dashboard/internal/data"
	"faber/dashboard/internal/jobs"
	"faber/dashboard/internal/model"
	"faber/dashboard/internal/theme"
	"faber/dashboard/internal/ui/screens"
)

type viewState int

const (
	viewPipeline viewState = iota
	viewReport
)

type appModel struct {
	pipeline      screens.PipelineModel
	viewer        screens.ViewerModel
	state         viewState
	careerOpsPath string
	logPath       string       // optional path to tee stream-json output
	program       *tea.Program // captured after tea.NewProgram() for goroutine.Send
}

// pipelineReloadMsg is emitted after any job (PDF or eval) finishes so the
// pipeline screen can refresh:
//   - HasPDF flag (parse applications.md + scan output/)
//   - QUEUE tab contents (parse data/pipeline.md)
type pipelineReloadMsg struct {
	apps    []model.CareerApplication
	pending []model.PendingJob
}

func (m *appModel) Init() tea.Cmd {
	return nil
}

func (m *appModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.pipeline.Resize(msg.Width, msg.Height)
		if m.state == viewReport {
			m.viewer.Resize(msg.Width, msg.Height)
		}
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd

	case screens.PipelineClosedMsg:
		return m, tea.Quit

	case screens.PipelineLoadReportMsg:
		archetype, tldr, remote, comp := data.LoadReportSummary(msg.CareerOpsPath, msg.ReportPath)
		m.pipeline.EnrichReport(msg.ReportPath, archetype, tldr, remote, comp)
		return m, nil

	case screens.PipelineUpdateStatusMsg:
		err := data.UpdateApplicationStatus(msg.CareerOpsPath, msg.App, msg.NewStatus)
		if err != nil {
			return m, nil
		}
		apps := data.ParseApplications(m.careerOpsPath)
		metrics := data.ComputeMetrics(apps)
		pdfOnDisk := data.ScanOutputPDFs(m.careerOpsPath)
		prepOnDisk := data.ScanInterviewPrep(m.careerOpsPath)
		pending := data.ParsePipelinePending(m.careerOpsPath)
		old := m.pipeline
		m.pipeline = screens.NewPipelineModel(
			theme.NewTheme("catppuccin-mocha"),
			apps, pending, metrics, m.careerOpsPath, pdfOnDisk, prepOnDisk,
			old.Width(), old.Height(),
		)
		m.pipeline.CopyReportCache(&old)
		m.pipeline.CopyJobsState(&old)
		m.pipeline.CopyEvalJobsState(&old)
		m.pipeline.CopyPrepJobsState(&old)
		m.pipeline.CopyUIState(&old)
		return m, nil

	case screens.PipelineOpenReportMsg:
		m.viewer = screens.NewViewerModel(
			theme.NewTheme("catppuccin-mocha"),
			msg.Path, msg.Title,
			m.pipeline.Width(), m.pipeline.Height(),
		)
		m.state = viewReport
		return m, nil

	case screens.ViewerClosedMsg:
		m.state = viewPipeline
		return m, nil

	case screens.PipelineRefreshMsg:
		// Full re-scan of all on-disk state, then emit pipelineReloadMsg
		// to rebuild the model with the fresh data. Cursor / tab / sort
		// are preserved by CopyUIState in the reload handler.
		careerOpsPath := m.careerOpsPath
		return m, func() tea.Msg {
			// Run merge first in case there are stale TSVs
			mergeCmd := exec.Command("node", "merge-tracker.mjs")
			mergeCmd.Dir = careerOpsPath
			_ = mergeCmd.Run()

			apps := data.ParseApplications(careerOpsPath)
			pending := data.ParsePipelinePending(careerOpsPath)
			if apps == nil {
				return nil
			}
			return pipelineReloadMsg{apps: apps, pending: pending}
		}

	case screens.PipelineOpenURLMsg:
		url := msg.URL
		return m, func() tea.Msg {
			var cmd *exec.Cmd
			switch runtime.GOOS {
			case "darwin":
				cmd = exec.Command("open", url)
			case "linux":
				cmd = exec.Command("xdg-open", url)
			case "windows":
				cmd = exec.Command("cmd", "/c", "start", "", url)
			default:
				cmd = exec.Command("xdg-open", url)
			}
			_ = cmd.Start()
			return nil
		}

	case screens.PipelineOpenPDFMsg:
		path := msg.Path
		return m, func() tea.Msg {
			var cmd *exec.Cmd
			switch runtime.GOOS {
			case "darwin":
				cmd = exec.Command("open", path)
			case "linux":
				cmd = exec.Command("xdg-open", path)
			case "windows":
				cmd = exec.Command("cmd", "/c", "start", "", path)
			default:
				cmd = exec.Command("xdg-open", path)
			}
			_ = cmd.Start()
			return nil
		}

	case screens.PipelineStartPDFMsg:
		cancel := jobs.Spawn(
			m.program,
			msg.CareerOpsPath,
			msg.ReportPath,
			msg.Number,
			m.logPath,
		)
		m.pipeline.StartPDFJob(&screens.PdfJob{
			Number:     msg.Number,
			Company:    msg.Company,
			Role:       msg.Role,
			ReportPath: msg.ReportPath,
			Status:     screens.JobRunning,
			StartedAt:  time.Now(),
			Cancel:     cancel,
		})
		return m, spinnerTickCmd()

	case screens.PipelineCancelPDFMsg:
		m.pipeline.CancelPDFJob(msg.Number)
		return m, nil

	case screens.PipelineStartEvalMsg:
		cancel := jobs.SpawnEval(
			m.program,
			msg.CareerOpsPath,
			msg.URL,
			m.logPath,
		)
		m.pipeline.StartEvalJob(&screens.EvalJob{
			URL:       msg.URL,
			Company:   msg.Company,
			Role:      msg.Role,
			Status:    screens.JobRunning,
			StartedAt: time.Now(),
			Cancel:    cancel,
		})
		return m, spinnerTickCmd()

	case screens.PipelineCancelEvalMsg:
		m.pipeline.CancelEvalJob(msg.URL)
		return m, nil

	case screens.PipelineStartInterviewPrepMsg:
		cancel := jobs.SpawnInterviewPrep(
			m.program,
			msg.CareerOpsPath,
			msg.ReportPath,
			msg.Company,
			msg.Role,
			m.logPath,
		)
		m.pipeline.StartPrepJob(&screens.InterviewPrepJob{
			ReportPath: msg.ReportPath,
			Company:    msg.Company,
			Role:       msg.Role,
			Status:     screens.JobRunning,
			StartedAt:  time.Now(),
			Cancel:     cancel,
		})
		return m, spinnerTickCmd()

	case screens.PipelineCancelInterviewPrepMsg:
		m.pipeline.CancelPrepJob(msg.ReportPath)
		return m, nil

	case screens.PipelineOpenInterviewPrepMsg:
		// Reuse the existing viewer by swapping state — same pattern as the
		// Enter key's report-viewer flow. We can't ride on PipelineOpenReportMsg
		// directly because it carries a JobURL field we don't have; instead
		// open a fresh ViewerModel inline here.
		m.viewer = screens.NewViewerModel(
			theme.NewTheme("catppuccin-mocha"),
			msg.Path, msg.Title,
			m.pipeline.Width(), m.pipeline.Height(),
		)
		m.state = viewReport
		return m, nil

	case jobs.InterviewPrepStartedMsg:
		return m, nil

	case jobs.InterviewPrepProgressMsg:
		m.pipeline.UpdatePrepJobLabel(msg.ReportPath, msg.Label)
		return m, nil

	case jobs.InterviewPrepDoneMsg:
		m.pipeline.CompletePrepJob(msg.ReportPath, msg.Err, msg.ExitCode)
		careerOpsPath := m.careerOpsPath
		return m, func() tea.Msg {
			// Merge any pending tracker TSVs (story-bank may have been
			// appended by the prep job) before reloading.
			mergeCmd := exec.Command("node", "merge-tracker.mjs")
			mergeCmd.Dir = careerOpsPath
			_ = mergeCmd.Run()
			apps := data.ParseApplications(careerOpsPath)
			pending := data.ParsePipelinePending(careerOpsPath)
			if apps == nil {
				return nil
			}
			return pipelineReloadMsg{apps: apps, pending: pending}
		}

	case jobs.EvalStartedMsg:
		return m, nil

	case jobs.EvalProgressMsg:
		m.pipeline.UpdateEvalJobLabel(msg.URL, msg.Label)
		return m, nil

	case jobs.EvalDoneMsg:
		m.pipeline.CompleteEvalJob(msg.URL, msg.Err, msg.ExitCode)
		careerOpsPath := m.careerOpsPath
		return m, func() tea.Msg {
			// Merge any pending tracker-additions TSVs into applications.md
			// BEFORE re-parsing. Without this, rows that just landed as
			// TSVs stay invisible in the dashboard until the user manually
			// runs `node merge-tracker.mjs`.
			mergeCmd := exec.Command("node", "merge-tracker.mjs")
			mergeCmd.Dir = careerOpsPath
			_ = mergeCmd.Run()

			apps := data.ParseApplications(careerOpsPath)
			pending := data.ParsePipelinePending(careerOpsPath)
			if apps == nil {
				return nil
			}
			return pipelineReloadMsg{apps: apps, pending: pending}
		}

	case jobs.StartedMsg:
		// No-op: StartPDFJob already marked jobRunning at spawn time.
		return m, nil

	case jobs.ProgressMsg:
		m.pipeline.UpdatePDFJobLabel(msg.Number, msg.Label)
		return m, nil

	case jobs.DoneMsg:
		m.pipeline.CompletePDFJob(msg.Number, msg.Err, msg.ExitCode)
		careerOpsPath := m.careerOpsPath
		return m, func() tea.Msg {
			// Merge any pending tracker-additions TSVs into applications.md
			// BEFORE re-parsing. Without this, rows that just landed as
			// TSVs stay invisible in the dashboard until the user manually
			// runs `node merge-tracker.mjs`.
			mergeCmd := exec.Command("node", "merge-tracker.mjs")
			mergeCmd.Dir = careerOpsPath
			_ = mergeCmd.Run()

			apps := data.ParseApplications(careerOpsPath)
			pending := data.ParsePipelinePending(careerOpsPath)
			if apps == nil {
				return nil
			}
			return pipelineReloadMsg{apps: apps, pending: pending}
		}

	case screens.PipelineSpinnerTickMsg:
		m.pipeline.AdvanceSpinner()
		m.pipeline.PrunePDFJobs()
		m.pipeline.PruneEvalJobs()
		m.pipeline.PrunePrepJobs()
		if m.pipeline.HasActiveJobs() {
			return m, spinnerTickCmd()
		}
		return m, nil

	case pipelineReloadMsg:
		metrics := data.ComputeMetrics(msg.apps)
		pdfOnDisk := data.ScanOutputPDFs(m.careerOpsPath)
		prepOnDisk := data.ScanInterviewPrep(m.careerOpsPath)
		old := m.pipeline
		m.pipeline = screens.NewPipelineModel(
			theme.NewTheme("catppuccin-mocha"),
			msg.apps, msg.pending, metrics, m.careerOpsPath, pdfOnDisk, prepOnDisk,
			old.Width(), old.Height(),
		)
		m.pipeline.CopyReportCache(&old)
		m.pipeline.CopyJobsState(&old)
		m.pipeline.CopyEvalJobsState(&old)
		m.pipeline.CopyPrepJobsState(&old)
		m.pipeline.CopyUIState(&old)
		return m, nil

	default:
		if m.state == viewReport {
			vm, cmd := m.viewer.Update(msg)
			m.viewer = vm
			return m, cmd
		}
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd
	}
}

func (m *appModel) View() string {
	if m.state == viewReport {
		return m.viewer.View()
	}
	return m.pipeline.View()
}

func spinnerTickCmd() tea.Cmd {
	return tea.Tick(250*time.Millisecond, func(t time.Time) tea.Msg {
		return screens.PipelineSpinnerTickMsg{}
	})
}

func main() {
	pathFlag := flag.String("path", ".", "Path to faber directory")
	logFlag := flag.String("log", "", "Optional path to tee claude stream-json events for debugging (e.g. -log dashboard.log)")
	flag.Parse()

	careerOpsPath := *pathFlag

	// Load applications
	apps := data.ParseApplications(careerOpsPath)
	if apps == nil {
		fmt.Fprintf(os.Stderr, "Error: could not find applications.md in %s or %s/data/\n", careerOpsPath, careerOpsPath)
		os.Exit(1)
	}

	// Compute metrics
	metrics := data.ComputeMetrics(apps)

	// Scan output/ for existing PDFs so the TUI can show the 3-state PDF column
	// immediately (✓ on-disk, ? tracker-only, "" none).
	pdfOnDisk := data.ScanOutputPDFs(careerOpsPath)

	// Scan interview-prep/ so the help bar can toggle between `i prep` and
	// `I open prep` per selected row at startup.
	prepOnDisk := data.ScanInterviewPrep(careerOpsPath)

	// Parse data/pipeline.md for the QUEUE tab
	pending := data.ParsePipelinePending(careerOpsPath)

	// Batch-load all report summaries
	t := theme.NewTheme("catppuccin-mocha")
	pm := screens.NewPipelineModel(t, apps, pending, metrics, careerOpsPath, pdfOnDisk, prepOnDisk, 120, 40)

	for _, app := range apps {
		if app.ReportPath == "" {
			continue
		}
		archetype, tldr, remote, comp := data.LoadReportSummary(careerOpsPath, app.ReportPath)
		if archetype != "" || tldr != "" || remote != "" || comp != "" {
			pm.EnrichReport(app.ReportPath, archetype, tldr, remote, comp)
		}
	}

	m := &appModel{
		pipeline:      pm,
		careerOpsPath: careerOpsPath,
		logPath:       *logFlag,
	}

	p := tea.NewProgram(m, tea.WithAltScreen())
	m.program = p

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
