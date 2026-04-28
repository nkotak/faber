package model

import "strconv"

// CareerApplication represents a single job application from the tracker.
//
// Two distinct numeric identities live on this struct:
//   - Number: the tracker row's `#` column. Monotonic counter over all rows.
//   - ReportNumber: the number baked into the report filename (e.g. "011"),
//     captured from the `[011](reports/...)` link in column 8.
//
// These can drift. If a SKIP row is inserted without a generated report, the
// row's Number advances but no ReportNumber is produced. Later rows then have
// Number > ReportNumber of their own report. PDFs on disk are named with the
// ReportNumber (see modes/pdf.md "Filename convention"), so any PDF-related
// lookup MUST key on ReportNumber, not Number.
type CareerApplication struct {
	Number       int
	Date         string
	Company      string
	Role         string
	Status       string
	Score        float64
	ScoreRaw     string
	HasPDF       bool
	ReportPath   string
	ReportNumber string
	Notes        string
	JobURL       string // URL of the original job posting
	// Enrichment (lazy loaded from report)
	Archetype    string
	TlDr         string
	Remote       string
	CompEstimate string
}

// ReportNum returns ReportNumber parsed as an integer. Leading zeros in the
// string form ("011") are dropped by Atoi, matching the numeric keys produced
// by data.ScanOutputPDFs. Returns 0 if ReportNumber is empty or unparseable
// (e.g. rows with no report link, such as some SKIP rows).
//
// Use this — not Number — for any lookup against a PDF-on-disk map or
// PDFPathForNumber. Number is the tracker row id; ReportNum is the artifact id.
func (a CareerApplication) ReportNum() int {
	n, _ := strconv.Atoi(a.ReportNumber)
	return n
}

// PipelineMetrics holds aggregate stats for the pipeline dashboard.
type PipelineMetrics struct {
	Total      int
	ByStatus   map[string]int
	AvgScore   float64
	TopScore   float64
	WithPDF    int
	Actionable int
}

// PendingJob represents a not-yet-evaluated URL from data/pipeline.md.
// Rows marked `- [ ]` in the Pending section become PendingJobs; `- [x]`
// (processed) and `- [!]` (blocked) are skipped by ParsePipelinePending.
type PendingJob struct {
	URL        string // the job posting URL
	Company    string // hint from "| Company |" (may be empty)
	Role       string // hint from "| Company | Role" (may be empty)
	Section    string // nearest preceding ## or ### header
	LineNumber int    // position in data/pipeline.md (1-indexed)
	RawLine    string // original markdown line for round-trip
}
