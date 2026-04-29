package screens

import (
	"context"
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"faber/dashboard/internal/data"
	"faber/dashboard/internal/model"
	"faber/dashboard/internal/theme"
)

// PipelineClosedMsg is emitted when the pipeline screen is dismissed.
type PipelineClosedMsg struct{}

// PipelineOpenReportMsg is emitted when a report should be opened in FileViewer.
type PipelineOpenReportMsg struct {
	Path   string
	Title  string
	JobURL string
}

// PipelineOpenURLMsg is emitted when a job URL should be opened in browser.
type PipelineOpenURLMsg struct {
	URL string
}

// PipelineOpenPDFMsg is emitted when a local PDF file should be opened in
// the OS default viewer. Path is an absolute path (Preview on macOS, etc.).
type PipelineOpenPDFMsg struct {
	Path string
}

// PipelineLoadReportMsg requests lazy loading of a report summary.
type PipelineLoadReportMsg struct {
	CareerOpsPath string
	ReportPath    string
}

// PipelineUpdateStatusMsg requests a status update for an application.
type PipelineUpdateStatusMsg struct {
	CareerOpsPath string
	App           model.CareerApplication
	NewStatus     string
}

// PipelineStartPDFMsg requests CV/PDF generation for a selected application.
// The dashboard main.go handler spawns `claude -p "/faber pdf <ReportPath>"`
// as a background goroutine; messages flow back via tea.Program.Send.
type PipelineStartPDFMsg struct {
	CareerOpsPath string
	ReportPath    string
	Company       string
	Role          string
	Number        int
}

// PipelineCancelPDFMsg requests cancellation of a running PDF job.
type PipelineCancelPDFMsg struct {
	Number int
}

// PipelineSpinnerTickMsg advances the spinner animation. Emitted on a
// 250ms tea.Tick loop while any job is active.
type PipelineSpinnerTickMsg struct{}

// PipelineStartEvalMsg requests evaluation of a single pending URL via
// `claude -p "/faber <URL>"`. The main.go handler spawns the
// subprocess via jobs.SpawnEval.
type PipelineStartEvalMsg struct {
	CareerOpsPath string
	URL           string
	Company       string
	Role          string
}

// PipelineCancelEvalMsg requests cancellation of a running eval job.
type PipelineCancelEvalMsg struct {
	URL string
}

// PipelineStartInterviewPrepMsg requests interview-prep intel generation for
// an app. Keyed by ReportPath (slug derived server-side for file naming).
type PipelineStartInterviewPrepMsg struct {
	CareerOpsPath string
	ReportPath    string
	Company       string
	Role          string
}

// PipelineCancelInterviewPrepMsg requests cancellation of a running
// interview-prep job.
type PipelineCancelInterviewPrepMsg struct {
	ReportPath string
}

// PipelineOpenInterviewPrepMsg is emitted when an existing interview-prep
// file should be opened in the report viewer (same as Enter for eval reports).
type PipelineOpenInterviewPrepMsg struct {
	Path  string // absolute path to the interview-prep md
	Title string // "Interview prep: {company} — {role}"
}

// PipelineRefreshMsg requests a manual reload of all on-disk state:
// applications.md, pipeline.md, output/*.pdf, interview-prep/*.md.
// Emitted by the `r` keybind so the user can pick up changes made by
// external processes (batch runs, scans, manual file edits) without
// having to quit and relaunch.
type PipelineRefreshMsg struct{}

// PdfJobStatus is the lifecycle state of a background PDF generation job.
type PdfJobStatus int

const (
	JobRunning PdfJobStatus = iota
	JobSucceeded
	JobFailed
	JobCancelled
)

// PdfJob is the dashboard's view of one background CV generation.
// All fields are owned by PipelineModel and must only be mutated inside
// the Bubble Tea Update loop.
type PdfJob struct {
	Number     int
	Company    string
	Role       string
	ReportPath string

	Status     PdfJobStatus
	StartedAt  time.Time
	FinishedAt time.Time // zero if running
	LastLabel  string
	Err        error
	ExitCode   int

	// Cancel kills the underlying goroutine's exec.CommandContext.
	Cancel context.CancelFunc

	// ToastUntil is when a terminal-state chip should be pruned.
	// Only set when Status != JobRunning.
	ToastUntil time.Time
}

// EvalJob is the dashboard's view of one background evaluation (a single
// pending URL being processed by `claude -p "/faber <URL>"`). Keyed
// by URL in the owning PipelineModel's evalJobs map. Same lifecycle as
// PdfJob; status enum reused.
type EvalJob struct {
	URL     string
	Company string
	Role    string

	Status     PdfJobStatus
	StartedAt  time.Time
	FinishedAt time.Time
	LastLabel  string
	Err        error
	ExitCode   int

	Cancel     context.CancelFunc
	ToastUntil time.Time
}

// InterviewPrepJob is the dashboard's view of one background interview-prep
// research run (modes/interview-prep.md). Keyed by ReportPath in the owning
// PipelineModel's prepJobs map. Reuses PdfJobStatus.
type InterviewPrepJob struct {
	ReportPath string
	Company    string
	Role       string

	Status     PdfJobStatus
	StartedAt  time.Time
	FinishedAt time.Time
	LastLabel  string
	Err        error
	ExitCode   int

	Cancel     context.CancelFunc
	ToastUntil time.Time
}

type reportSummary struct {
	archetype string
	tldr      string
	remote    string
	comp      string
}

// Sort modes
const (
	sortScore   = "score"
	sortDate    = "date"
	sortCompany = "company"
	sortStatus  = "status"
)

// Filter modes
const (
	filterAll       = "all"
	filterEvaluated = "evaluated"
	filterApplied   = "applied"
	filterInterview = "interview"
	filterSkip      = "skip"
	filterTop       = "top"
	filterPending   = "pending" // QUEUE tab — data/pipeline.md unchecked items
)

type pipelineTab struct {
	filter string
	label  string
}

var pipelineTabs = []pipelineTab{
	{filterAll, "ALL"},
	{filterEvaluated, "EVALUATED"},
	{filterApplied, "APPLIED"},
	{filterInterview, "INTERVIEW"},
	{filterTop, "TOP ≥4"},
	{filterSkip, "SKIP"},
	{filterPending, "QUEUE"},
}

var sortCycle = []string{sortScore, sortDate, sortCompany, sortStatus}

var statusOptions = []string{"Evaluated", "Applied", "Responded", "Interview", "Offer", "Rejected", "Discarded", "SKIP"}

// statusGroupOrder defines display order for grouped view.
var statusGroupOrder = []string{"interview", "offer", "responded", "applied", "evaluated", "skip", "rejected", "discarded"}

// PipelineModel implements the career pipeline dashboard screen.
type PipelineModel struct {
	apps          []model.CareerApplication
	filtered      []model.CareerApplication
	metrics       model.PipelineMetrics
	cursor        int
	scrollOffset  int
	sortMode      string
	activeTab     int
	viewMode      string // "grouped" or "flat"
	width, height int
	theme         theme.Theme
	careerOpsPath string
	reportCache   map[string]reportSummary
	// Status picker sub-state
	statusPicker bool
	statusCursor int

	// PDF generation jobs — keyed by app.Number for O(1) lookup.
	// jobOrder preserves insertion order for stable left-to-right chip display.
	jobs         map[int]*PdfJob
	jobOrder     []int
	spinnerFrame int // advances every 250ms via PipelineSpinnerTickMsg

	// pdfOnDisk is the set of REPORT numbers whose PDF file exists in
	// output/ (keyed by the number in cv-{num}-*.pdf, which is the
	// report id — NOT the tracker row `#`). Populated by
	// data.ScanOutputPDFs at startup and refreshed after every job
	// completion. Used by the 3-state PDF indicator column and the
	// conditional "P open PDF" keybinding. Look up with app.ReportNum().
	pdfOnDisk map[int]bool

	// Pending queue — rows from data/pipeline.md that haven't been evaluated.
	// pendingCursor tracks selection on the QUEUE tab (separate from cursor
	// which tracks selection on all applications-based tabs).
	pending       []model.PendingJob
	pendingCursor int

	// Eval jobs, keyed by URL. Lifecycle mirrors jobs (jobOrder preserves
	// display order in the bottom status bar).
	evalJobs     map[string]*EvalJob
	evalJobOrder []string

	// Interview-prep jobs, keyed by ReportPath. Same lifecycle as PDF / eval
	// jobs; chips appear in the bottom status bar alongside the others.
	prepJobs     map[string]*InterviewPrepJob
	prepJobOrder []string

	// Set of interview-prep slugs that have an existing file on disk. Used
	// by the 3-state-ish help bar logic: `i prep` when missing, `I open prep`
	// when present. Populated by data.ScanInterviewPrep at startup and
	// refreshed after every job completion.
	interviewPrepOnDisk map[string]bool
}

// NewPipelineModel creates a new pipeline screen.
// pdfOnDisk is the set of report numbers (from cv-{num}-*.pdf) with a
// generated PDF on disk; may be nil. Keyed by report id, not row id.
// pending is the unprocessed URL list from data/pipeline.md; may be nil.
// prepOnDisk is the set of interview-prep slugs with a file on disk; may be nil.
func NewPipelineModel(t theme.Theme, apps []model.CareerApplication, pending []model.PendingJob, metrics model.PipelineMetrics, careerOpsPath string, pdfOnDisk map[int]bool, prepOnDisk map[string]bool, width, height int) PipelineModel {
	if pdfOnDisk == nil {
		pdfOnDisk = make(map[int]bool)
	}
	if prepOnDisk == nil {
		prepOnDisk = make(map[string]bool)
	}
	m := PipelineModel{
		apps:                apps,
		metrics:             metrics,
		sortMode:            sortScore,
		activeTab:           0,
		viewMode:            "grouped",
		width:               width,
		height:              height,
		theme:               t,
		careerOpsPath:       careerOpsPath,
		reportCache:         make(map[string]reportSummary),
		jobs:                make(map[int]*PdfJob),
		pdfOnDisk:           pdfOnDisk,
		pending:             pending,
		evalJobs:            make(map[string]*EvalJob),
		prepJobs:            make(map[string]*InterviewPrepJob),
		interviewPrepOnDisk: prepOnDisk,
	}
	m.applyFilterAndSort()
	return m
}

// Init implements tea.Model.
func (m PipelineModel) Init() tea.Cmd {
	return nil
}

// Resize updates dimensions.
func (m *PipelineModel) Resize(width, height int) {
	m.width = width
	m.height = height
}

// Width returns the current width.
func (m PipelineModel) Width() int { return m.width }

// Height returns the current height.
func (m PipelineModel) Height() int { return m.height }

// CopyReportCache copies the report cache from another pipeline model.
func (m *PipelineModel) CopyReportCache(other *PipelineModel) {
	for k, v := range other.reportCache {
		m.reportCache[k] = v
	}
}

// EnrichReport caches report summary data for preview.
func (m *PipelineModel) EnrichReport(reportPath, archetype, tldr, remote, comp string) {
	m.reportCache[reportPath] = reportSummary{
		archetype: archetype,
		tldr:      tldr,
		remote:    remote,
		comp:      comp,
	}
}

// CopyJobsState copies in-flight and recently-completed PDF jobs from another
// PipelineModel. Used after pipelineReloadMsg rebuilds the model so jobs
// survive an applications.md re-parse triggered by status updates or PDF
// completion.
func (m *PipelineModel) CopyJobsState(other *PipelineModel) {
	if other == nil {
		return
	}
	if m.jobs == nil {
		m.jobs = make(map[int]*PdfJob)
	}
	for k, v := range other.jobs {
		m.jobs[k] = v
	}
	m.jobOrder = append(m.jobOrder[:0], other.jobOrder...)
	m.spinnerFrame = other.spinnerFrame
}

// SetPDFOnDisk replaces the disk-presence map. Called after a job completes
// to refresh the set without a full PipelineModel rebuild (the main Update
// handler already rebuilds via pipelineReloadMsg, but this helper is useful
// if the caller wants to refresh the set without a full re-parse).
func (m *PipelineModel) SetPDFOnDisk(pdfOnDisk map[int]bool) {
	if pdfOnDisk == nil {
		pdfOnDisk = make(map[int]bool)
	}
	m.pdfOnDisk = pdfOnDisk
}

// CopyEvalJobsState mirrors CopyJobsState but for eval jobs.
func (m *PipelineModel) CopyEvalJobsState(other *PipelineModel) {
	if other == nil {
		return
	}
	if m.evalJobs == nil {
		m.evalJobs = make(map[string]*EvalJob)
	}
	for k, v := range other.evalJobs {
		m.evalJobs[k] = v
	}
	m.evalJobOrder = append(m.evalJobOrder[:0], other.evalJobOrder...)
}

// StartEvalJob registers a new running eval job keyed by URL.
func (m *PipelineModel) StartEvalJob(j *EvalJob) {
	if m.evalJobs == nil {
		m.evalJobs = make(map[string]*EvalJob)
	}
	if _, exists := m.evalJobs[j.URL]; !exists {
		m.evalJobOrder = append(m.evalJobOrder, j.URL)
	}
	m.evalJobs[j.URL] = j
}

// UpdateEvalJobLabel sets the latest progress label for a running eval job.
func (m *PipelineModel) UpdateEvalJobLabel(url, label string) {
	j, ok := m.evalJobs[url]
	if !ok || j.Status != JobRunning {
		return
	}
	j.LastLabel = label
}

// CompleteEvalJob transitions an eval job to terminal state + toast.
// Durations match PDF jobs: 5s success / 60s failure / 10s cancelled.
func (m *PipelineModel) CompleteEvalJob(url string, err error, exitCode int) {
	j, ok := m.evalJobs[url]
	if !ok {
		return
	}
	j.FinishedAt = time.Now()
	j.Err = err
	j.ExitCode = exitCode
	switch {
	case j.Status == JobCancelled:
		j.ToastUntil = j.FinishedAt.Add(10 * time.Second)
	case err != nil || exitCode != 0:
		j.Status = JobFailed
		j.ToastUntil = j.FinishedAt.Add(60 * time.Second)
	default:
		j.Status = JobSucceeded
		j.ToastUntil = j.FinishedAt.Add(5 * time.Second)
	}
}

// CancelEvalJob flips a running eval job to Cancelled and invokes its
// CancelFunc. Completion via cmd.Wait still fires DoneMsg normally.
func (m *PipelineModel) CancelEvalJob(url string) {
	j, ok := m.evalJobs[url]
	if !ok || j.Status != JobRunning {
		return
	}
	j.Status = JobCancelled
	if j.Cancel != nil {
		j.Cancel()
	}
}

// PruneEvalJobs drops terminal-state eval jobs whose ToastUntil has passed.
func (m *PipelineModel) PruneEvalJobs() {
	if len(m.evalJobs) == 0 {
		return
	}
	now := time.Now()
	keep := m.evalJobOrder[:0]
	for _, url := range m.evalJobOrder {
		j, ok := m.evalJobs[url]
		if !ok {
			continue
		}
		if j.Status != JobRunning && !j.ToastUntil.IsZero() && now.After(j.ToastUntil) {
			delete(m.evalJobs, url)
			continue
		}
		keep = append(keep, url)
	}
	m.evalJobOrder = keep
}

// ---- Interview-prep job methods (mirror the PdfJob/EvalJob pattern) ----

func (m *PipelineModel) CopyPrepJobsState(other *PipelineModel) {
	if other == nil {
		return
	}
	if m.prepJobs == nil {
		m.prepJobs = make(map[string]*InterviewPrepJob)
	}
	for k, v := range other.prepJobs {
		m.prepJobs[k] = v
	}
	m.prepJobOrder = append(m.prepJobOrder[:0], other.prepJobOrder...)
}

func (m *PipelineModel) StartPrepJob(j *InterviewPrepJob) {
	if m.prepJobs == nil {
		m.prepJobs = make(map[string]*InterviewPrepJob)
	}
	if _, exists := m.prepJobs[j.ReportPath]; !exists {
		m.prepJobOrder = append(m.prepJobOrder, j.ReportPath)
	}
	m.prepJobs[j.ReportPath] = j
}

func (m *PipelineModel) UpdatePrepJobLabel(reportPath, label string) {
	j, ok := m.prepJobs[reportPath]
	if !ok || j.Status != JobRunning {
		return
	}
	j.LastLabel = label
}

func (m *PipelineModel) CompletePrepJob(reportPath string, err error, exitCode int) {
	j, ok := m.prepJobs[reportPath]
	if !ok {
		return
	}
	j.FinishedAt = time.Now()
	j.Err = err
	j.ExitCode = exitCode
	switch {
	case j.Status == JobCancelled:
		j.ToastUntil = j.FinishedAt.Add(10 * time.Second)
	case err != nil || exitCode != 0:
		j.Status = JobFailed
		j.ToastUntil = j.FinishedAt.Add(60 * time.Second)
	default:
		j.Status = JobSucceeded
		j.ToastUntil = j.FinishedAt.Add(5 * time.Second)
	}
}

func (m *PipelineModel) CancelPrepJob(reportPath string) {
	j, ok := m.prepJobs[reportPath]
	if !ok || j.Status != JobRunning {
		return
	}
	j.Status = JobCancelled
	if j.Cancel != nil {
		j.Cancel()
	}
}

func (m *PipelineModel) PrunePrepJobs() {
	if len(m.prepJobs) == 0 {
		return
	}
	now := time.Now()
	keep := m.prepJobOrder[:0]
	for _, k := range m.prepJobOrder {
		j, ok := m.prepJobs[k]
		if !ok {
			continue
		}
		if j.Status != JobRunning && !j.ToastUntil.IsZero() && now.After(j.ToastUntil) {
			delete(m.prepJobs, k)
			continue
		}
		keep = append(keep, k)
	}
	m.prepJobOrder = keep
}

// SetInterviewPrepOnDisk replaces the prep-file-presence set. Called after a
// prep job completes to refresh visibility of the `I open prep` keybind.
func (m *PipelineModel) SetInterviewPrepOnDisk(prepOnDisk map[string]bool) {
	if prepOnDisk == nil {
		prepOnDisk = make(map[string]bool)
	}
	m.interviewPrepOnDisk = prepOnDisk
}

// CopyUIState carries cursor/scroll/tab/view-mode preferences across a
// PipelineModel rebuild (pipelineReloadMsg). Without this, every reload
// would dump the user back at row 0 of the ALL tab — too jarring for a
// 30s auto-refresh or even an explicit `r` press.
//
// Cursor is clamped to the new collection size to avoid out-of-range.
func (m *PipelineModel) CopyUIState(other *PipelineModel) {
	if other == nil {
		return
	}
	m.activeTab = other.activeTab
	m.sortMode = other.sortMode
	m.viewMode = other.viewMode
	m.scrollOffset = other.scrollOffset

	// Re-apply filter/sort with the carried-over tab + sort BEFORE clamping
	// the cursor so we know the new collection sizes.
	m.applyFilterAndSort()

	// Clamp cursors against the rebuilt collections.
	if m.currentFilter() == filterPending {
		if other.pendingCursor < len(m.pending) {
			m.pendingCursor = other.pendingCursor
		} else if len(m.pending) > 0 {
			m.pendingCursor = len(m.pending) - 1
		}
	} else {
		if other.cursor < len(m.filtered) {
			m.cursor = other.cursor
		} else if len(m.filtered) > 0 {
			m.cursor = len(m.filtered) - 1
		}
	}
}

// HasInterviewPrep reports whether an interview-prep file exists on disk for
// the given report path. Used by the help-bar conditional logic.
func (m PipelineModel) HasInterviewPrep(reportPath string) bool {
	slug := interviewPrepSlugLocal(reportPath)
	if slug == "" {
		return false
	}
	return m.interviewPrepOnDisk[slug]
}

// interviewPrepSlugLocal is a package-local copy of the slug extractor in
// data/career.go — keeps screens free of the data-package dependency that
// would otherwise cause an import cycle.
var reReportFilenameLocal = regexp.MustCompile(`^\d+-(.+)-\d{4}-\d{2}-\d{2}\.md$`)

func interviewPrepSlugLocal(reportPath string) string {
	base := filepath.Base(reportPath)
	m := reReportFilenameLocal.FindStringSubmatch(base)
	if m == nil {
		return ""
	}
	return m[1]
}

// SetPending replaces the pending queue without rebuilding the model.
// Used after reload (pipelineReloadMsg) so the QUEUE tab refreshes.
func (m *PipelineModel) SetPending(pending []model.PendingJob) {
	m.pending = pending
	// Keep cursor in range
	if m.pendingCursor >= len(m.pending) {
		m.pendingCursor = len(m.pending) - 1
	}
	if m.pendingCursor < 0 {
		m.pendingCursor = 0
	}
}

// CurrentPending returns the selected pending job on the QUEUE tab, if any.
func (m PipelineModel) CurrentPending() (model.PendingJob, bool) {
	if m.pendingCursor < 0 || m.pendingCursor >= len(m.pending) {
		return model.PendingJob{}, false
	}
	return m.pending[m.pendingCursor], true
}

// currentFilter returns the filter key for the currently active tab.
func (m PipelineModel) currentFilter() string {
	if m.activeTab < 0 || m.activeTab >= len(pipelineTabs) {
		return filterAll
	}
	return pipelineTabs[m.activeTab].filter
}

// HasActiveJobs returns true if any PDF, eval, or prep job is running or
// still in its toast window. Used to decide whether the spinner ticker
// should keep firing.
func (m PipelineModel) HasActiveJobs() bool {
	return len(m.jobs) > 0 || len(m.evalJobs) > 0 || len(m.prepJobs) > 0
}

// StartPDFJob registers a new running job and adds it to the display order.
func (m *PipelineModel) StartPDFJob(j *PdfJob) {
	if m.jobs == nil {
		m.jobs = make(map[int]*PdfJob)
	}
	// Replace any terminal-state chip for this number — a fresh run supersedes.
	if _, exists := m.jobs[j.Number]; !exists {
		m.jobOrder = append(m.jobOrder, j.Number)
	}
	m.jobs[j.Number] = j
}

// UpdatePDFJobLabel sets the latest progress label for a running job.
// No-op if the job is no longer running (race with DoneMsg arriving first).
func (m *PipelineModel) UpdatePDFJobLabel(number int, label string) {
	j, ok := m.jobs[number]
	if !ok || j.Status != JobRunning {
		return
	}
	j.LastLabel = label
}

// CompletePDFJob transitions a job to a terminal state and sets ToastUntil.
// Toast durations:
//   - JobSucceeded:  5s  (routine, user notices via PDF column flip)
//   - JobCancelled:  10s (user-initiated; they already know)
//   - JobFailed:     60s (user may have looked away during 8-15 min run;
//                         long enough they can still see what broke)
func (m *PipelineModel) CompletePDFJob(number int, err error, exitCode int) {
	j, ok := m.jobs[number]
	if !ok {
		return
	}
	j.FinishedAt = time.Now()
	j.Err = err
	j.ExitCode = exitCode
	switch {
	case j.Status == JobCancelled:
		j.ToastUntil = j.FinishedAt.Add(10 * time.Second)
	case err != nil || exitCode != 0:
		j.Status = JobFailed
		j.ToastUntil = j.FinishedAt.Add(60 * time.Second)
	default:
		j.Status = JobSucceeded
		j.ToastUntil = j.FinishedAt.Add(5 * time.Second)
	}
}

// CancelPDFJob flips a running job to Cancelled and invokes its CancelFunc.
// The subprocess's exit will still trigger DoneMsg → CompletePDFJob; we just
// pre-stamp the Cancelled status so CompletePDFJob doesn't overwrite it.
func (m *PipelineModel) CancelPDFJob(number int) {
	j, ok := m.jobs[number]
	if !ok || j.Status != JobRunning {
		return
	}
	j.Status = JobCancelled
	if j.Cancel != nil {
		j.Cancel()
	}
}

// PrunePDFJobs removes terminal-state jobs whose ToastUntil has passed.
// Safe to call every tick.
func (m *PipelineModel) PrunePDFJobs() {
	if len(m.jobs) == 0 {
		return
	}
	now := time.Now()
	keep := m.jobOrder[:0]
	for _, num := range m.jobOrder {
		j, ok := m.jobs[num]
		if !ok {
			continue
		}
		if j.Status != JobRunning && !j.ToastUntil.IsZero() && now.After(j.ToastUntil) {
			delete(m.jobs, num)
			continue
		}
		keep = append(keep, num)
	}
	m.jobOrder = keep
}

// HasActivePDFJobs returns true if any job is running or a chip is still in
// its toast window. Used to decide whether the spinner ticker should keep
// firing.
func (m PipelineModel) HasActivePDFJobs() bool {
	return len(m.jobs) > 0
}

// AdvanceSpinner bumps the spinner frame counter.
func (m *PipelineModel) AdvanceSpinner() {
	m.spinnerFrame = (m.spinnerFrame + 1) % len(spinnerFrames)
}

// spinnerFrames is the brail-dots animation used in the jobs bar.
var spinnerFrames = []string{"⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"}

// CurrentApp returns the currently selected application, if any.
func (m PipelineModel) CurrentApp() (model.CareerApplication, bool) {
	if m.cursor < 0 || m.cursor >= len(m.filtered) {
		return model.CareerApplication{}, false
	}
	return m.filtered[m.cursor], true
}

// Update handles input for the pipeline screen.
func (m PipelineModel) Update(msg tea.Msg) (PipelineModel, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if m.statusPicker {
			return m.handleStatusPicker(msg)
		}
		return m.handleKey(msg)
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	}
	return m, nil
}

func (m PipelineModel) handleKey(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "q", "esc":
		return m, func() tea.Msg { return PipelineClosedMsg{} }

	case "down":
		if m.currentFilter() == filterPending {
			if len(m.pending) > 0 {
				m.pendingCursor++
				if m.pendingCursor >= len(m.pending) {
					m.pendingCursor = len(m.pending) - 1
				}
				m.adjustScroll()
			}
		} else if len(m.filtered) > 0 {
			m.cursor++
			if m.cursor >= len(m.filtered) {
				m.cursor = len(m.filtered) - 1
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "up":
		if m.currentFilter() == filterPending {
			if len(m.pending) > 0 {
				m.pendingCursor--
				if m.pendingCursor < 0 {
					m.pendingCursor = 0
				}
				m.adjustScroll()
			}
		} else if len(m.filtered) > 0 {
			m.cursor--
			if m.cursor < 0 {
				m.cursor = 0
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "s":
		// Cycle sort mode
		for i, s := range sortCycle {
			if s == m.sortMode {
				m.sortMode = sortCycle[(i+1)%len(sortCycle)]
				break
			}
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "f", "right":
		m.activeTab++
		if m.activeTab >= len(pipelineTabs) {
			m.activeTab = 0
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "left":
		m.activeTab--
		if m.activeTab < 0 {
			m.activeTab = len(pipelineTabs) - 1
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "v":
		if m.viewMode == "grouped" {
			m.viewMode = "flat"
		} else {
			m.viewMode = "grouped"
		}

	case "enter":
		if app, ok := m.CurrentApp(); ok && app.ReportPath != "" {
			fullPath := filepath.Join(m.careerOpsPath, app.ReportPath)
			title := fmt.Sprintf("%s — %s", app.Company, app.Role)
			jobURL := app.JobURL
			return m, func() tea.Msg {
				return PipelineOpenReportMsg{Path: fullPath, Title: title, JobURL: jobURL}
			}
		}

	case "o":
		if app, ok := m.CurrentApp(); ok && app.JobURL != "" {
			return m, func() tea.Msg {
				return PipelineOpenURLMsg{URL: app.JobURL}
			}
		}

	case "c":
		if len(m.filtered) > 0 {
			m.statusPicker = true
			m.statusCursor = 0
		}

	case "p":
		if app, ok := m.CurrentApp(); ok && app.ReportPath != "" {
			// Refuse duplicate: if a job for this row is already running,
			// do nothing. The user can press `x` to cancel first.
			if j, exists := m.jobs[app.Number]; exists && j.Status == JobRunning {
				return m, nil
			}
			return m, func() tea.Msg {
				return PipelineStartPDFMsg{
					CareerOpsPath: m.careerOpsPath,
					ReportPath:    app.ReportPath,
					Company:       app.Company,
					Role:          app.Role,
					Number:        app.Number,
				}
			}
		}

	case "x":
		// On QUEUE tab: cancel running eval for selected pending URL
		if m.currentFilter() == filterPending {
			if pj, ok := m.CurrentPending(); ok {
				if j, exists := m.evalJobs[pj.URL]; exists && j.Status == JobRunning {
					return m, func() tea.Msg {
						return PipelineCancelEvalMsg{URL: pj.URL}
					}
				}
			}
			return m, nil
		}
		// On applications tabs: cancel whichever kind of job is running for
		// the selected row. Priority: prep > pdf (either is the user's most
		// likely intent if both happen to be active).
		if app, ok := m.CurrentApp(); ok {
			if j, exists := m.prepJobs[app.ReportPath]; exists && j.Status == JobRunning {
				return m, func() tea.Msg {
					return PipelineCancelInterviewPrepMsg{ReportPath: app.ReportPath}
				}
			}
			if j, exists := m.jobs[app.Number]; exists && j.Status == JobRunning {
				return m, func() tea.Msg {
					return PipelineCancelPDFMsg{Number: app.Number}
				}
			}
		}

	case "e":
		// Evaluate a single pending URL — only on QUEUE tab.
		if m.currentFilter() == filterPending {
			if pj, ok := m.CurrentPending(); ok && pj.URL != "" {
				if j, exists := m.evalJobs[pj.URL]; exists && j.Status == JobRunning {
					return m, nil // refuse duplicate
				}
				return m, func() tea.Msg {
					return PipelineStartEvalMsg{
						CareerOpsPath: m.careerOpsPath,
						URL:           pj.URL,
						Company:       pj.Company,
						Role:          pj.Role,
					}
				}
			}
		}

	case "P":
		if app, ok := m.CurrentApp(); ok && m.pdfOnDisk[app.ReportNum()] {
			path := data.PDFPathForNumber(m.careerOpsPath, app.ReportNum())
			if path != "" {
				return m, func() tea.Msg {
					return PipelineOpenPDFMsg{Path: path}
				}
			}
		}

	case "i":
		// Generate interview-prep (only when no prep file exists AND app
		// has a report to anchor research off of).
		if app, ok := m.CurrentApp(); ok && app.ReportPath != "" && !m.HasInterviewPrep(app.ReportPath) {
			// Refuse if already running
			if j, exists := m.prepJobs[app.ReportPath]; exists && j.Status == JobRunning {
				return m, nil
			}
			return m, func() tea.Msg {
				return PipelineStartInterviewPrepMsg{
					CareerOpsPath: m.careerOpsPath,
					ReportPath:    app.ReportPath,
					Company:       app.Company,
					Role:          app.Role,
				}
			}
		}

	case "I":
		// Open an existing interview-prep file in the viewer.
		if app, ok := m.CurrentApp(); ok && m.HasInterviewPrep(app.ReportPath) {
			path := data.InterviewPrepPathForReport(m.careerOpsPath, app.ReportPath)
			if path != "" {
				title := fmt.Sprintf("Interview prep: %s — %s", app.Company, app.Role)
				return m, func() tea.Msg {
					return PipelineOpenInterviewPrepMsg{Path: path, Title: title}
				}
			}
		}

	case "r":
		// Manual refresh — re-scan applications.md, pipeline.md, output/,
		// interview-prep/. Useful when external processes (batch runs,
		// scans) have changed state since the dashboard was launched.
		return m, func() tea.Msg {
			return PipelineRefreshMsg{}
		}

	case "pgdown", "ctrl+d":
		m.scrollOffset += m.height / 2
		return m, nil

	case "pgup", "ctrl+u":
		m.scrollOffset -= m.height / 2
		if m.scrollOffset < 0 {
			m.scrollOffset = 0
		}
		return m, nil
	}

	return m, nil
}

func (m PipelineModel) handleStatusPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q":
		m.statusPicker = false
		return m, nil

	case "down":
		m.statusCursor++
		if m.statusCursor >= len(statusOptions) {
			m.statusCursor = len(statusOptions) - 1
		}

	case "up":
		m.statusCursor--
		if m.statusCursor < 0 {
			m.statusCursor = 0
		}

	case "enter":
		m.statusPicker = false
		if app, ok := m.CurrentApp(); ok {
			newStatus := statusOptions[m.statusCursor]
			return m, func() tea.Msg {
				return PipelineUpdateStatusMsg{
					CareerOpsPath: m.careerOpsPath,
					App:           app,
					NewStatus:     newStatus,
				}
			}
		}
	}
	return m, nil
}

func (m PipelineModel) loadCurrentReport() tea.Cmd {
	app, ok := m.CurrentApp()
	if !ok || app.ReportPath == "" {
		return nil
	}
	if _, cached := m.reportCache[app.ReportPath]; cached {
		return nil
	}
	path := m.careerOpsPath
	report := app.ReportPath
	return func() tea.Msg {
		return PipelineLoadReportMsg{CareerOpsPath: path, ReportPath: report}
	}
}

// applyFilterAndSort rebuilds the filtered list from apps.
func (m *PipelineModel) applyFilterAndSort() {
	var filtered []model.CareerApplication

	currentFilter := pipelineTabs[m.activeTab].filter
	for _, app := range m.apps {
		norm := data.NormalizeStatus(app.Status)
		switch currentFilter {
		case filterAll:
			filtered = append(filtered, app)
		case filterTop:
			if app.Score >= 4.0 && norm != "skip" {
				filtered = append(filtered, app)
			}
		default:
			if norm == currentFilter {
				filtered = append(filtered, app)
			}
		}
	}

	// Sort
	switch m.sortMode {
	case sortScore:
		sort.SliceStable(filtered, func(i, j int) bool {
			return filtered[i].Score > filtered[j].Score
		})
	case sortDate:
		sort.SliceStable(filtered, func(i, j int) bool {
			return filtered[i].Date > filtered[j].Date
		})
	case sortCompany:
		sort.SliceStable(filtered, func(i, j int) bool {
			return strings.ToLower(filtered[i].Company) < strings.ToLower(filtered[j].Company)
		})
	case sortStatus:
		sort.SliceStable(filtered, func(i, j int) bool {
			return data.StatusPriority(filtered[i].Status) < data.StatusPriority(filtered[j].Status)
		})
	}

	// In grouped mode, always sort by status priority first, then by selected sort within groups
	if m.viewMode == "grouped" {
		sort.SliceStable(filtered, func(i, j int) bool {
			pi := data.StatusPriority(filtered[i].Status)
			pj := data.StatusPriority(filtered[j].Status)
			if pi != pj {
				return pi < pj
			}
			// Within same group, use selected sort
			switch m.sortMode {
			case sortScore:
				return filtered[i].Score > filtered[j].Score
			case sortDate:
				return filtered[i].Date > filtered[j].Date
			case sortCompany:
				return strings.ToLower(filtered[i].Company) < strings.ToLower(filtered[j].Company)
			default:
				return filtered[i].Score > filtered[j].Score
			}
		})
	}

	m.filtered = filtered
}

// adjustScroll updates scrollOffset so the cursor stays visible.
func (m *PipelineModel) adjustScroll() {
	availHeight := m.height - 12 // header + tabs(2) + metrics + sortbar + footer + preview
	if availHeight < 5 {
		availHeight = 5
	}
	line := m.cursorLineEstimate()
	margin := 3

	if line >= m.scrollOffset+availHeight-margin {
		m.scrollOffset = line - availHeight + margin + 1
	}
	if line < m.scrollOffset+margin {
		m.scrollOffset = line - margin
	}
	if m.scrollOffset < 0 {
		m.scrollOffset = 0
	}
}

func (m PipelineModel) cursorLineEstimate() int {
	if m.viewMode != "grouped" {
		return m.cursor
	}
	// Account for group headers
	line := 0
	prevStatus := ""
	for i, app := range m.filtered {
		norm := data.NormalizeStatus(app.Status)
		if norm != prevStatus {
			line++ // group header
			prevStatus = norm
		}
		if i == m.cursor {
			return line
		}
		line++
	}
	return line
}

// -- View --

// View renders the pipeline screen.
func (m PipelineModel) View() string {
	header := m.renderHeader()
	tabs := m.renderTabs()
	metricsBar := m.renderMetrics()
	sortBar := m.renderSortBar()
	body := m.renderBody()
	preview := m.renderPreview()
	jobsBar := m.renderJobsBar()
	help := m.renderHelp()

	// Apply scroll to body
	bodyLines := strings.Split(body, "\n")
	if m.scrollOffset > 0 && m.scrollOffset < len(bodyLines) {
		bodyLines = bodyLines[m.scrollOffset:]
	}

	// Calculate available height for body
	previewLines := strings.Count(preview, "\n") + 1
	jobsBarLines := 0
	if jobsBar != "" {
		jobsBarLines = strings.Count(jobsBar, "\n") + 1
	}
	availHeight := m.height - 7 - previewLines - jobsBarLines // header + tabs(2) + metrics + sortbar + help + preview + jobsBar
	if availHeight < 3 {
		availHeight = 3
	}
	if len(bodyLines) > availHeight {
		bodyLines = bodyLines[:availHeight]
	}
	body = strings.Join(bodyLines, "\n")

	// Status picker overlay
	if m.statusPicker {
		body = m.overlayStatusPicker(body)
	}

	parts := []string{header, tabs, metricsBar, sortBar, body, preview}
	if jobsBar != "" {
		parts = append(parts, jobsBar)
	}
	parts = append(parts, help)
	return lipgloss.JoinVertical(lipgloss.Left, parts...)
}

func (m PipelineModel) renderHeader() string {
	style := lipgloss.NewStyle().
		Bold(true).
		Foreground(m.theme.Text).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 2)

	right := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	avg := fmt.Sprintf("%.1f", m.metrics.AvgScore)
	info := right.Render(fmt.Sprintf("%d offers | Avg %s/5", m.metrics.Total, avg))

	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Render("FABER")
	gap := m.width - lipgloss.Width(title) - lipgloss.Width(info) - 4
	if gap < 1 {
		gap = 1
	}

	return style.Render(title + strings.Repeat(" ", gap) + info)
}

func (m PipelineModel) renderTabs() string {
	var tabs []string
	var underParts []string

	for i, tab := range pipelineTabs {
		// Count items for this tab
		count := m.countForFilter(tab.filter)
		label := fmt.Sprintf(" %s (%d) ", tab.label, count)

		if i == m.activeTab {
			style := lipgloss.NewStyle().
				Bold(true).
				Foreground(m.theme.Blue).
				Padding(0, 0)
			tabs = append(tabs, style.Render(label))
			underParts = append(underParts, strings.Repeat("━", lipgloss.Width(label)))
		} else {
			style := lipgloss.NewStyle().
				Foreground(m.theme.Subtext).
				Padding(0, 0)
			tabs = append(tabs, style.Render(label))
			underParts = append(underParts, strings.Repeat("─", lipgloss.Width(label)))
		}
	}

	row := lipgloss.JoinHorizontal(lipgloss.Top, tabs...)
	underline := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render(strings.Join(underParts, ""))

	padStyle := lipgloss.NewStyle().Padding(0, 1)
	return padStyle.Render(row) + "\n" + padStyle.Render(underline)
}

func (m PipelineModel) countForFilter(filter string) int {
	// QUEUE (pending) uses a different data source than the applications list
	if filter == filterPending {
		return len(m.pending)
	}
	count := 0
	for _, app := range m.apps {
		norm := data.NormalizeStatus(app.Status)
		switch filter {
		case filterAll:
			count++
		case filterTop:
			if app.Score >= 4.0 && norm != "skip" {
				count++
			}
		default:
			if norm == filter {
				count++
			}
		}
	}
	return count
}

func (m PipelineModel) renderMetrics() string {
	style := lipgloss.NewStyle().
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 2)

	var parts []string
	statusColors := m.statusColorMap()

	for _, status := range statusGroupOrder {
		count, ok := m.metrics.ByStatus[status]
		if !ok || count == 0 {
			continue
		}
		color := statusColors[status]
		s := lipgloss.NewStyle().Foreground(color)
		parts = append(parts, s.Render(fmt.Sprintf("%s:%d", statusLabel(status), count)))
	}

	return style.Render(strings.Join(parts, "  "))
}

func (m PipelineModel) renderSortBar() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Width(m.width).
		Padding(0, 2)

	sortLabel := fmt.Sprintf("[Sort: %s]", m.sortMode)
	viewLabel := fmt.Sprintf("[View: %s]", m.viewMode)
	count := fmt.Sprintf("%d shown", len(m.filtered))

	return style.Render(fmt.Sprintf("%s  %s  %s", sortLabel, viewLabel, count))
}

func (m PipelineModel) renderBody() string {
	// QUEUE tab uses a different data source and row format
	if m.currentFilter() == filterPending {
		return m.renderPendingBody()
	}

	if len(m.filtered) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(m.theme.Subtext).
			Padding(1, 2)
		return emptyStyle.Render("No offers match this filter")
	}

	var lines []string
	prevStatus := ""
	padStyle := lipgloss.NewStyle().Padding(0, 2)

	for i, app := range m.filtered {
		norm := data.NormalizeStatus(app.Status)

		// Group header in grouped mode
		if m.viewMode == "grouped" && norm != prevStatus {
			count := m.countByNormStatus(norm)
			headerStyle := lipgloss.NewStyle().
				Bold(true).
				Foreground(m.theme.Subtext)
			lines = append(lines, padStyle.Render(
				headerStyle.Render(fmt.Sprintf("── %s (%d) %s",
					strings.ToUpper(statusLabel(norm)), count,
					strings.Repeat("─", max(0, m.width-30-len(statusLabel(norm)))))),
			))
			prevStatus = norm
		}

		selected := i == m.cursor
		line := m.renderAppLine(app, selected)
		lines = append(lines, line)
	}

	return strings.Join(lines, "\n")
}

// renderPendingBody renders the QUEUE tab — unchecked rows from
// data/pipeline.md, grouped by section header when in grouped view mode.
func (m PipelineModel) renderPendingBody() string {
	if len(m.pending) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(m.theme.Subtext).
			Padding(1, 2)
		return emptyStyle.Render("No pending URLs. Run /faber scan to discover more.")
	}

	var lines []string
	prevSection := ""
	padStyle := lipgloss.NewStyle().Padding(0, 2)

	for i, pj := range m.pending {
		if m.viewMode == "grouped" && pj.Section != prevSection {
			section := pj.Section
			if section == "" {
				section = "Uncategorized"
			}
			headerStyle := lipgloss.NewStyle().
				Bold(true).
				Foreground(m.theme.Subtext)
			lines = append(lines, padStyle.Render(
				headerStyle.Render(fmt.Sprintf("── %s %s",
					strings.ToUpper(section),
					strings.Repeat("─", max(0, m.width-30-len(section))))),
			))
			prevSection = pj.Section
		}
		selected := i == m.pendingCursor
		lines = append(lines, m.renderPendingRow(pj, selected))
	}
	return strings.Join(lines, "\n")
}

// renderPendingRow formats one QUEUE row: { job-status-glyph  host  company  role }.
// job-status-glyph shows the spinner if an eval job is running for this URL,
// "✓" if just completed and still in toast window, "✗" on failure, blank otherwise.
func (m PipelineModel) renderPendingRow(pj model.PendingJob, selected bool) string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)

	hostW := 22
	companyW := 16
	statusGlyphW := 2
	// Location takes a fixed column when present, else 0. Allocating it
	// up-front keeps role width stable regardless of which rows have it.
	locationW := 0
	if pj.Location != "" {
		locationW = 14
	}
	roleW := m.width - hostW - companyW - statusGlyphW - locationW - 10
	if roleW < 15 {
		roleW = 15
		locationW = 0 // give up location if width is too constrained
	}

	// Eval status glyph (2 chars)
	var statusGlyph string
	if j, ok := m.evalJobs[pj.URL]; ok {
		switch j.Status {
		case JobRunning:
			statusGlyph = lipgloss.NewStyle().Foreground(m.theme.Blue).Bold(true).Render(spinnerFrames[m.spinnerFrame]) + " "
		case JobSucceeded:
			statusGlyph = lipgloss.NewStyle().Foreground(m.theme.Green).Bold(true).Render("✓") + " "
		case JobFailed:
			statusGlyph = lipgloss.NewStyle().Foreground(m.theme.Red).Bold(true).Render("✗") + " "
		case JobCancelled:
			statusGlyph = lipgloss.NewStyle().Foreground(m.theme.Yellow).Bold(true).Render("⊘") + " "
		}
	}
	if statusGlyph == "" {
		statusGlyph = "  "
	}

	// Host — parsed from URL
	host := hostFromURL(pj.URL)
	if len(host) > hostW {
		host = host[:hostW-3] + "..."
	}
	hostStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(hostW)

	// Company (may be empty)
	company := pj.Company
	if len(company) > companyW {
		company = company[:companyW-3] + "..."
	}
	companyStyle := lipgloss.NewStyle().Foreground(m.theme.Text).Width(companyW)

	// Role (may be empty)
	role := pj.Role
	if role == "" {
		role = lipgloss.NewStyle().Foreground(m.theme.Overlay).Italic(true).Render("(no role hint)")
	} else if len(role) > roleW {
		role = role[:roleW-3] + "..."
	}
	roleStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(roleW)

	// Location column (rendered only when allocated). Remote-tagged locations
	// get a subtle blue tint; everything else uses the muted subtext color so
	// the role still leads visually.
	var locationCell string
	if locationW > 0 {
		loc := pj.Location
		if len(loc) > locationW {
			loc = loc[:locationW-1] + "…"
		}
		lower := strings.ToLower(pj.Location)
		isRemote := strings.Contains(lower, "remote") || strings.Contains(lower, "anywhere")
		var locStyle lipgloss.Style
		if isRemote {
			locStyle = lipgloss.NewStyle().Foreground(m.theme.Blue).Width(locationW)
		} else {
			locStyle = lipgloss.NewStyle().Foreground(m.theme.Overlay).Width(locationW)
		}
		locationCell = " " + locStyle.Render(loc)
	}

	line := fmt.Sprintf(" %s%s %s %s%s",
		statusGlyph,
		hostStyle.Render(host),
		companyStyle.Render(company),
		roleStyle.Render(role),
		locationCell,
	)

	if selected {
		selStyle := lipgloss.NewStyle().
			Background(m.theme.Overlay).
			Width(m.width - 4)
		return padStyle.Render(selStyle.Render(line))
	}
	return padStyle.Render(line)
}

// hostFromURL extracts a compact hostname from a URL, stripping "www.".
// Returns a fallback if the URL doesn't parse (e.g. "local:" prefix).
func hostFromURL(raw string) string {
	if strings.HasPrefix(raw, "local:") {
		return "local"
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		// Defensive fallback: take chars up to first "/"
		if i := strings.Index(raw, "://"); i >= 0 {
			rest := raw[i+3:]
			if j := strings.Index(rest, "/"); j >= 0 {
				return rest[:j]
			}
			return rest
		}
		return raw
	}
	return strings.TrimPrefix(u.Host, "www.")
}

func (m PipelineModel) renderAppLine(app model.CareerApplication, selected bool) string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)

	// Column widths
	scoreW := 5   // "4.5  "
	pdfW := 2     // "✓ " / "? " / "  "
	companyW := 20
	statusW := 12
	compW := 14
	// Role gets remaining space
	roleW := m.width - scoreW - pdfW - companyW - statusW - compW - 10
	if roleW < 15 {
		roleW = 15
	}

	// Score with color
	scoreStyle := m.scoreStyle(app.Score)
	score := scoreStyle.Render(fmt.Sprintf("%.1f", app.Score))

	// PDF 3-state indicator:
	//   "  " — tracker says no PDF (HasPDF=false)
	//   "✓ " — tracker ✅ AND file on disk
	//   "? " — tracker ✅ but file missing from disk
	// Lookup keys on ReportNum (artifact id), not Number (row id) — see
	// model.CareerApplication doc for why these can drift.
	var pdfIndicator string
	switch {
	case !app.HasPDF:
		pdfIndicator = "  "
	case m.pdfOnDisk[app.ReportNum()]:
		pdfIndicator = lipgloss.NewStyle().Foreground(m.theme.Green).Render("✓") + " "
	default:
		pdfIndicator = lipgloss.NewStyle().Foreground(m.theme.Yellow).Render("?") + " "
	}

	// Company (truncate)
	company := app.Company
	if len(company) > companyW {
		company = company[:companyW-3] + "..."
	}
	companyStyle := lipgloss.NewStyle().Foreground(m.theme.Text).Width(companyW)

	// Role (truncate)
	role := app.Role
	if len(role) > roleW {
		role = role[:roleW-3] + "..."
	}
	roleStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(roleW)

	// Status with color -- fixed column
	norm := data.NormalizeStatus(app.Status)
	statusColor := m.statusColorMap()[norm]
	statusStyle := lipgloss.NewStyle().Foreground(statusColor).Width(statusW)
	statusText := statusStyle.Render(statusLabel(norm))

	// Comp from report cache -- fixed column
	compText := ""
	if summary, ok := m.reportCache[app.ReportPath]; ok && summary.comp != "" {
		comp := summary.comp
		if len(comp) > compW-1 {
			comp = comp[:compW-4] + "..."
		}
		compStyle := lipgloss.NewStyle().Foreground(m.theme.Yellow)
		compText = compStyle.Render(comp)
	}

	line := fmt.Sprintf(" %s %s%s %s %s %s",
		score,
		pdfIndicator,
		companyStyle.Render(company),
		roleStyle.Render(role),
		statusText,
		compText,
	)

	if selected {
		selStyle := lipgloss.NewStyle().
			Background(m.theme.Overlay).
			Width(m.width - 4)
		return padStyle.Render(selStyle.Render(line))
	}
	return padStyle.Render(line)
}

func (m PipelineModel) renderPreview() string {
	app, ok := m.CurrentApp()
	if !ok {
		return ""
	}

	padStyle := lipgloss.NewStyle().Padding(0, 2)
	divider := lipgloss.NewStyle().Foreground(m.theme.Overlay)

	var lines []string
	lines = append(lines, padStyle.Render(divider.Render(strings.Repeat("─", m.width-4))))

	labelStyle := lipgloss.NewStyle().Foreground(m.theme.Sky).Bold(true)
	valueStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	// Check report cache
	if summary, ok := m.reportCache[app.ReportPath]; ok {
		if summary.archetype != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("Arquetipo: ")+valueStyle.Render(summary.archetype)))
		}
		if summary.tldr != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("TL;DR: ")+valueStyle.Render(summary.tldr)))
		}
		if summary.comp != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("Comp: ")+valueStyle.Render(summary.comp)))
		}
		if summary.remote != "" {
			lines = append(lines, padStyle.Render(
				labelStyle.Render("Remote: ")+valueStyle.Render(summary.remote)))
		}
	} else if app.Notes != "" {
		// Fallback: show notes
		notes := app.Notes
		if len(notes) > m.width-10 {
			notes = notes[:m.width-13] + "..."
		}
		lines = append(lines, padStyle.Render(dimStyle.Render(notes)))
	} else {
		lines = append(lines, padStyle.Render(dimStyle.Render("Loading preview...")))
	}

	return strings.Join(lines, "\n")
}

// renderJobsBar renders the active PDF job status bar. Empty string when
// no jobs are active (collapses to zero height in the View composition).
func (m PipelineModel) renderJobsBar() string {
	if len(m.jobOrder) == 0 && len(m.evalJobOrder) == 0 && len(m.prepJobOrder) == 0 {
		return ""
	}

	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 1)

	spinnerStyle := lipgloss.NewStyle().Foreground(m.theme.Blue).Bold(true)
	successStyle := lipgloss.NewStyle().Foreground(m.theme.Green).Bold(true)
	failStyle := lipgloss.NewStyle().Foreground(m.theme.Red).Bold(true)
	cancelStyle := lipgloss.NewStyle().Foreground(m.theme.Yellow).Bold(true)
	chipStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	labelStyle := lipgloss.NewStyle().Foreground(m.theme.Overlay)
	kindStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	statusGlyph := func(s PdfJobStatus) string {
		switch s {
		case JobRunning:
			return spinnerStyle.Render(spinnerFrames[m.spinnerFrame])
		case JobSucceeded:
			return successStyle.Render("✓")
		case JobFailed:
			return failStyle.Render("✗")
		case JobCancelled:
			return cancelStyle.Render("⊘")
		}
		return ""
	}

	var chips []string
	now := time.Now()

	// PDF job chips
	for _, num := range m.jobOrder {
		j, ok := m.jobs[num]
		if !ok {
			continue
		}

		company := j.Company
		if len(company) > 14 {
			company = company[:13] + "…"
		}

		var elapsed time.Duration
		if j.FinishedAt.IsZero() {
			elapsed = now.Sub(j.StartedAt)
		} else {
			elapsed = j.FinishedAt.Sub(j.StartedAt)
		}

		chip := fmt.Sprintf("%s %s #%d %s (%s)",
			statusGlyph(j.Status),
			kindStyle.Render("PDF"),
			j.Number,
			chipStyle.Render(company),
			formatElapsed(elapsed),
		)

		if j.Status == JobRunning && j.LastLabel != "" {
			label := j.LastLabel
			if len(label) > 24 {
				label = label[:23] + "…"
			}
			chip += " " + labelStyle.Render(label)
		} else if j.Status == JobFailed && j.Err != nil {
			errStr := j.Err.Error()
			if len(errStr) > 30 {
				errStr = errStr[:29] + "…"
			}
			chip += " " + failStyle.Render(errStr)
		}
		chips = append(chips, chip)
	}

	// Eval job chips
	for _, u := range m.evalJobOrder {
		j, ok := m.evalJobs[u]
		if !ok {
			continue
		}

		// Prefer company hint if we have one, otherwise show URL host
		ident := j.Company
		if ident == "" {
			ident = hostFromURL(u)
		}
		if len(ident) > 16 {
			ident = ident[:15] + "…"
		}

		var elapsed time.Duration
		if j.FinishedAt.IsZero() {
			elapsed = now.Sub(j.StartedAt)
		} else {
			elapsed = j.FinishedAt.Sub(j.StartedAt)
		}

		chip := fmt.Sprintf("%s %s %s (%s)",
			statusGlyph(j.Status),
			kindStyle.Render("EVAL"),
			chipStyle.Render(ident),
			formatElapsed(elapsed),
		)

		if j.Status == JobRunning && j.LastLabel != "" {
			label := j.LastLabel
			if len(label) > 24 {
				label = label[:23] + "…"
			}
			chip += " " + labelStyle.Render(label)
		} else if j.Status == JobFailed && j.Err != nil {
			errStr := j.Err.Error()
			if len(errStr) > 30 {
				errStr = errStr[:29] + "…"
			}
			chip += " " + failStyle.Render(errStr)
		}
		chips = append(chips, chip)
	}

	// Interview-prep job chips
	for _, rp := range m.prepJobOrder {
		j, ok := m.prepJobs[rp]
		if !ok {
			continue
		}
		ident := j.Company
		if ident == "" {
			ident = interviewPrepSlugLocal(rp)
		}
		if len(ident) > 16 {
			ident = ident[:15] + "…"
		}
		var elapsed time.Duration
		if j.FinishedAt.IsZero() {
			elapsed = now.Sub(j.StartedAt)
		} else {
			elapsed = j.FinishedAt.Sub(j.StartedAt)
		}
		chip := fmt.Sprintf("%s %s %s (%s)",
			statusGlyph(j.Status),
			kindStyle.Render("PREP"),
			chipStyle.Render(ident),
			formatElapsed(elapsed),
		)
		if j.Status == JobRunning && j.LastLabel != "" {
			label := j.LastLabel
			if len(label) > 24 {
				label = label[:23] + "…"
			}
			chip += " " + labelStyle.Render(label)
		} else if j.Status == JobFailed && j.Err != nil {
			errStr := j.Err.Error()
			if len(errStr) > 30 {
				errStr = errStr[:29] + "…"
			}
			chip += " " + failStyle.Render(errStr)
		}
		chips = append(chips, chip)
	}

	return style.Render(strings.Join(chips, "  │  "))
}

func formatElapsed(d time.Duration) string {
	total := int(d.Seconds())
	m := total / 60
	s := total % 60
	return fmt.Sprintf("%d:%02d", m, s)
}

func (m PipelineModel) renderHelp() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 1)

	keyStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text)
	descStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	if m.statusPicker {
		return style.Render(
			keyStyle.Render("↑↓") + descStyle.Render(" navigate  ") +
				keyStyle.Render("Enter") + descStyle.Render(" confirm  ") +
				keyStyle.Render("Esc") + descStyle.Render(" cancel"))
	}

	brand := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render("faber")

	// Conditional keybindings based on active tab + selected row state
	var cancelChunk, openPDFChunk, evalChunk string

	if m.currentFilter() == filterPending {
		// QUEUE tab: show e/eval and x/cancel only when relevant
		if pj, ok := m.CurrentPending(); ok {
			if pj.URL != "" {
				if j, exists := m.evalJobs[pj.URL]; !exists || j.Status != JobRunning {
					evalChunk = keyStyle.Render("e") + descStyle.Render(" eval  ")
				}
				if j, exists := m.evalJobs[pj.URL]; exists && j.Status == JobRunning {
					cancelChunk = keyStyle.Render("x") + descStyle.Render(" cancel  ")
				}
			}
		}

		keys := keyStyle.Render("↑↓") + descStyle.Render(" nav  ") +
			keyStyle.Render("←→") + descStyle.Render(" tabs  ") +
			evalChunk +
			cancelChunk +
			keyStyle.Render("v") + descStyle.Render(" view  ") +
			keyStyle.Render("Esc") + descStyle.Render(" quit")

		brand := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render("faber")
		gap := m.width - lipgloss.Width(keys) - lipgloss.Width(brand) - 2
		if gap < 1 {
			gap = 1
		}
		return style.Render(keys + strings.Repeat(" ", gap) + brand)
	}

	// Applications tabs: show x/cancel, P/open PDF, i/I interview prep
	var prepChunk, openPrepChunk string
	if app, ok := m.CurrentApp(); ok {
		// Cancel applies to whichever job kind is running for this row
		pdfRunning := false
		if j, exists := m.jobs[app.Number]; exists && j.Status == JobRunning {
			pdfRunning = true
		}
		prepRunning := false
		if j, exists := m.prepJobs[app.ReportPath]; exists && j.Status == JobRunning {
			prepRunning = true
		}
		if pdfRunning || prepRunning {
			cancelChunk = keyStyle.Render("x") + descStyle.Render(" cancel  ")
		}
		if m.pdfOnDisk[app.Number] {
			openPDFChunk = keyStyle.Render("P") + descStyle.Render(" open PDF  ")
		}
		// Interview prep keys — only show when an app has a report to work from
		if app.ReportPath != "" {
			if m.HasInterviewPrep(app.ReportPath) {
				openPrepChunk = keyStyle.Render("I") + descStyle.Render(" open prep  ")
			} else {
				prepChunk = keyStyle.Render("i") + descStyle.Render(" prep  ")
			}
		}
	}

	keys := keyStyle.Render("↑↓") + descStyle.Render(" nav  ") +
		keyStyle.Render("←→") + descStyle.Render(" tabs  ") +
		keyStyle.Render("s") + descStyle.Render(" sort  ") +
		keyStyle.Render("Enter") + descStyle.Render(" report  ") +
		keyStyle.Render("o") + descStyle.Render(" open URL  ") +
		keyStyle.Render("p") + descStyle.Render(" pdf  ") +
		openPDFChunk +
		prepChunk +
		openPrepChunk +
		cancelChunk +
		keyStyle.Render("r") + descStyle.Render(" refresh  ") +
		keyStyle.Render("c") + descStyle.Render(" change  ") +
		keyStyle.Render("v") + descStyle.Render(" view  ") +
		keyStyle.Render("Esc") + descStyle.Render(" quit")

	gap := m.width - lipgloss.Width(keys) - lipgloss.Width(brand) - 2
	if gap < 1 {
		gap = 1
	}

	return style.Render(keys + strings.Repeat(" ", gap) + brand)
}

func (m PipelineModel) overlayStatusPicker(body string) string {
	// Render status picker inline at bottom of body
	bodyLines := strings.Split(body, "\n")

	pickerWidth := 30
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	borderStyle := lipgloss.NewStyle().
		Foreground(m.theme.Blue).
		Bold(true)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render("Change status:")))

	for i, opt := range statusOptions {
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.statusCursor {
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		prefix := "  "
		if i == m.statusCursor {
			prefix = "> "
		}
		picker = append(picker, padStyle.Render(style.Render(prefix+opt)))
	}

	// Append picker to body
	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}

// -- Helpers --

func (m PipelineModel) scoreStyle(score float64) lipgloss.Style {
	switch {
	case score >= 4.2:
		return lipgloss.NewStyle().Foreground(m.theme.Green).Bold(true)
	case score >= 3.8:
		return lipgloss.NewStyle().Foreground(m.theme.Yellow)
	case score >= 3.0:
		return lipgloss.NewStyle().Foreground(m.theme.Text)
	default:
		return lipgloss.NewStyle().Foreground(m.theme.Red)
	}
}

func (m PipelineModel) statusColorMap() map[string]lipgloss.Color {
	return map[string]lipgloss.Color{
		"interview": m.theme.Green,
		"offer":     m.theme.Green,
		"applied":   m.theme.Sky,
		"responded": m.theme.Blue,
		"evaluated": m.theme.Text,
		"skip":      m.theme.Red,
		"rejected":  m.theme.Subtext,
		"discarded": m.theme.Subtext,
	}
}

func (m PipelineModel) countByNormStatus(status string) int {
	count := 0
	for _, app := range m.filtered {
		if data.NormalizeStatus(app.Status) == status {
			count++
		}
	}
	return count
}

func statusLabel(norm string) string {
	switch norm {
	case "interview":
		return "Interview"
	case "offer":
		return "Offer"
	case "responded":
		return "Responded"
	case "applied":
		return "Applied"
	case "evaluated":
		return "Evaluated"
	case "skip":
		return "Skip"
	case "rejected":
		return "Rejected"
	case "discarded":
		return "Discarded"
	default:
		return norm
	}
}
