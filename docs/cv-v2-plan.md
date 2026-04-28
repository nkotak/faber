# CV Generation v2

**Status:** Implemented 2026-04-21.
**Origin:** Neal noticed generated PDFs "just adjust bullet points and highlight keywords" — confirmed by forensic analysis of 3 sample CVs.

---

## 1. The problem (evidence)

Forensic diff of 3 generated PDFs (Clay #156, Anthropic Claude Code #002, Disney #064) against `cv.md`:

| Change category | Count across 3 PDFs |
|---|---|
| Identical to cv.md | ~105 bullets |
| Reordered within section | 0 |
| Keyword substitution | 1 global ("OneSignal" → "notification", applied identically in all 3 — not JD-specific) |
| Substantive rewrite | 0 |
| New | 0 |
| Dropped | 0 |
| Skills section reordered | 3/3 |

The only real tailoring was reordering the 4 Skills categories so the JD-relevant one came first.

**Root cause:** Batch mode invoked `generate-cv.mjs` whose `assertNoFabrication()` (line 578) forced every `<li>` to match `cv.md` verbatim — rewriting was mechanically impossible. Interactive mode's `modes/pdf.md` described rewriting but wasn't what batch ran. All 128 historical CVs went through the batch path.

---

## 2. Target behavior

For each bullet in `cv.md` Experience and Projects, a 3-question test decides keep / reorder / rewrite / drop:

1. **Does it prove anything the JD asks for?** No → drop. Yes → Q2.
2. **Does the bullet's language already match the JD's vocabulary?** Yes → keep verbatim (reorder only). No → Q3.
3. **Can I rewrite this to use the JD's vocabulary without changing what happened, without adding metrics / tools not in cv.md, and without claiming a skill not in cv.md Core Skills?** Yes → rewrite. No → keep verbatim (truth wins).

**Worked example — Disney PPO bullet, two JDs:**

Original (cv.md:45):
> Designed and deployed PPO-based reinforcement learning agent for autonomous message orchestration across 250M+ subscribers, defining reward architecture balancing engagement, delivery, and fatigue signals to replace rule-based targeting with learned policies.

For Anthropic PM Claude Code (JD vocab: "agentic systems", "reward models", "autonomous"):
> Shipped PPO-based agentic system for autonomous message orchestration to 250M+ subscribers — designed the reward architecture balancing engagement, delivery, and fatigue signals, replacing rule-based targeting with a learned policy.

For Hightouch Product Lead Agentic Ads (JD vocab: "campaign orchestration", "agentic ads"):
> Shipped PPO-based agent for autonomous campaign orchestration across 250M+ subscribers — designed the reward architecture balancing engagement, delivery, and fatigue to replace rule-based targeting with a learned policy.

"Message" → "campaign" is truthful (Payment Retry, Winback, Price Increase are campaigns). Kept "agent" singular. Did NOT stretch to "agentic ads" — Disney messages aren't ads. Every number preserved, every tool preserved, length within ±15%.

---

## 3. cv.md stays unchanged

**Decision:** cv.md is the canonical source of truth. No restructuring. Claude does Projects vs Experience categorization at generation time inside the prompt, per-JD.

Rationale:
- One source of truth, no schema migration, no parallel structures.
- Categorization is JD-dependent (Roominary as Project for a Disney PM role; Roominary as Experience for a Series A startup role). Static restructuring can't express this.
- LinkedIn lists Roominary under Experience (since LinkedIn has no Projects section). Keeping cv.md flat matches that upstream convention; the CV generator is the place where adaptation happens.

**Entry inference in the prompt (Stage 2):**
- W2 marker: named employer + location + employment dates + manager-style role title → Professional Experience.
- Project marker: solo / founder / open source / "Independent Researcher" / no hierarchy → Projects (default).

---

## 4. How it works now

`modes/pdf.md` contains an 8-stage prompt (replaced the old 15-step pipeline):

- **Stage 0** — Load cv.md + _profile.md + article-digest.md (optional) + profile.yml as sources of truth
- **Stage 1** — JD ingestion → scratchpad with vocabulary, seniority cues, top 5 competencies, archetype, domain context, language
- **Stage 2** — Map each cv.md bullet → JD competencies (relevance 0-3); classify entries W2 vs Project
- **Stage 3** — 3-question test per bullet
- **Stage 4** — Rewriting rules (preserve numbers/tools, one idea per bullet, ±15% length parity, no upgraded verbs)
- **Stage 5** — Section assembly:
  - Professional Experience: W2 only, reverse chronological, 3-bullet minimum per job
  - Projects: select 1-3 of {Roominary, YOCO-BitNet, Multi-Layer GRPO}. Roominary promotes to Experience when JD values founder credibility.
  - YOCO-BitNet and Multi-Layer GRPO are **separate entries** when both are shown (no longer fused under "Independent Researcher")
- **Stage 6** — Guardrails (anti-hallucination, banned phrases, Unicode normalization)
- **Stage 7** — Emit HTML via `templates/cv-template.html` → render with `generate-pdf.mjs`
- **Stage 8** — Decision log **every time** (per-bullet kept/reordered/rewritten/dropped + one-line diffs), collapsible `<details>` block

`batch/batch-prompt.md` Step 4 now invokes the same 8-stage inline rather than `generate-cv.mjs`. Batch is the critical fix — without it, 100% of future batched CVs would still get flat output.

---

## 5. User decisions (all resolved)

| Question | Decision | Implementation |
|---|---|---|
| Roominary placement | Default to Projects; **promote to Experience when JD values founder credibility** (Series A / startup / 0→1 requirement) | Stage 5 step 5 in `modes/pdf.md` |
| Split YOCO-BitNet + Multi-Layer GRPO | **Yes, split**. YOCO-BitNet has its own GitHub (github.com/kotak-ai/1.58BitNet). Each selectable independently by archetype. | Stage 5 step 5 |
| Minimum bullets per job | **3 minimum**. Fill with relevance-1 if relevance-2+ count < 3. Never pad with relevance-0. | Stage 5 step 4 |
| Decision log visibility | **Every time**, in collapsible `<details>` block | Stage 8 |
| cv.md restructuring | **Do NOT restructure.** cv.md stays canonical; Claude categorizes at generation time. | Stage 2 entry inference rule |

---

## 6. Files

| File | Change |
|------|--------|
| `modes/pdf.md` | **Replaced** lines 1-92 with 8-stage prompt; Canva + post-gen sections preserved |
| `batch/batch-prompt.md` | **Replaced** Step 4 (lines 214-256) with inline 8-stage invocation |
| `archive/generate-cv.mjs` | **Moved** from project root (reorder-only; incompatible with rewriting) |
| `archive/cv-template-classic.html` | **Moved** from `templates/` (no Summary/Projects/Competencies placeholders) |
| `cv.md` | **No change** — canonical source |
| `generate-pdf.mjs` | **No change** — Playwright renderer only |
| `templates/cv-template.html` | **No change** — already has 7 sections |
| `modes/_shared.md`, `modes/_profile.md` | **No change** — Stage 6 cites their rules |
| `modes/auto-pipeline.md` | **No change** — already invokes `modes/pdf.md` |

---

## 7. Dashboard integration (Part C of the implementation)

A new `p` keybinding in the pipeline screen triggers CV generation for the selected application:

- Select a row with a populated `ReportPath`, press `p`
- Dashboard emits `PipelineGeneratePDFMsg{CareerOpsPath, ReportPath, Company, Role, Number}`
- `main.go` handler runs `tea.ExecProcess(exec.Command("claude", "-p", "/faber pdf <reportPath>"))` with `cmd.Dir = careerOpsPath`
- Bubble Tea suspends the TUI alt-screen, hands the terminal to `claude -p`, user sees the full streaming output and decision log
- On `claude` exit, `tea.ExecProcess` callback re-parses `applications.md` so the `HasPDF` flag updates to ✅ and the TUI resumes at the same cursor/filter state

Files changed:
- `dashboard/internal/ui/screens/pipeline.go` — add `PipelineGeneratePDFMsg`, `case "p"` handler, help text
- `dashboard/main.go` — add case for `PipelineGeneratePDFMsg` using `tea.ExecProcess`
- Binary rebuild: `go build -o faber-dashboard .`

Launch: `<faber-root>/dashboard/faber-dashboard -path <faber-root>`

---

## 8. Testing

1. **CV v2 dry run** — `/faber pdf {report-path}` on 3 reports across archetypes. For each:
   - Decision log shows ≥40% bullets rewritten
   - Every metric in the PDF exists in cv.md or article-digest.md
   - Every named tool exists in cv.md
   - Roominary categorized correctly per JD
   - YOCO-BitNet and Multi-Layer GRPO as separate entries when shown
   - 3-bullet minimum per W2 job
   - PDF opens cleanly, 1 page, single column, ATS-clean
2. **Hallucination spot-check** — per rewritten bullet, verify cv.md source + no new metric/tool/skill.
3. **Batch smoke test** — `bash batch/batch-runner.sh --parallel 1` against a single report; confirm it produces a v2-quality PDF, not the old reorder-only output.
4. **Dashboard keybinding** — select app with report, press `p`; TUI suspends, `claude -p` streams, TUI resumes, PDF exists, HasPDF flag updates.

---

## 9. Rollback

`git tag pre-cv-v2` was created before any edits. To roll back:

```bash
cd <faber-root>
git checkout pre-cv-v2 -- modes/pdf.md batch/batch-prompt.md
git mv archive/generate-cv.mjs generate-cv.mjs
git mv archive/cv-template-classic.html templates/cv-template-classic.html
```

Dashboard changes are compile-time checked; if they break, `git checkout pre-cv-v2 -- dashboard/`.
