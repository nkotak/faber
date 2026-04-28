---
name: faber
description: AI job search command center -- evaluate offers, generate CVs, scan portals, track applications
user_invocable: true
args: mode
argument-hint: "[scan | deep | pdf | offer | offers | apply | batch | tracker | pipeline | contact | training | project | interview-prep | update]"
---

# faber -- Router

## Mode Routing

Determine the mode from `{{mode}}`:

| Input | Mode |
|-------|------|
| (empty / no args) | `discovery` -- Show command menu |
| JD text or URL (no sub-command) | **`auto-pipeline`** |
| `offer` | `offer` |
| `offers` | `offers` |
| `contact` | `contact` |
| `deep` | `deep` |
| `pdf` | `pdf` |
| `training` | `training` |
| `project` | `project` |
| `tracker` | `tracker` |
| `pipeline` | `pipeline` |
| `apply` | `apply` |
| `scan` | `scan` |
| `batch` | `batch` |
| `patterns` | `patterns` |

**Auto-pipeline detection:** If `{{mode}}` is not a known sub-command AND contains JD text (keywords: "responsibilities", "requirements", "qualifications", "about the role", "we're looking for", company name + role) or a URL to a JD, execute `auto-pipeline`.

If `{{mode}}` is not a sub-command AND doesn't look like a JD, show discovery.

---

## Discovery Mode (no arguments)

Show this menu:

```
faber -- Command Center

Available commands:
  /faber {JD}      → AUTO-PIPELINE: evaluate + report + PDF + tracker (paste text or URL)
  /faber pipeline  → Process pending URLs from inbox (data/pipeline.md)
  /faber offer     → Evaluation only A-F (no auto PDF)
  /faber offers    → Compare and rank multiple offers
  /faber contact   → LinkedIn power move: find contacts + draft message
  /faber deep      → Deep research prompt about company
  /faber pdf       → PDF only, ATS-optimized CV
  /faber training  → Evaluate course/cert against North Star
  /faber project   → Evaluate portfolio project idea
  /faber tracker   → Application status overview
  /faber apply     → Live application assistant (reads form + generates answers)
  /faber scan      → Scan portals and discover new offers
  /faber batch     → Batch processing with parallel workers
  /faber patterns  → Analyze rejection patterns and improve targeting

Inbox: add URLs to data/pipeline.md → /faber pipeline
Or paste a JD directly to run the full pipeline.
```

---

## Context Loading by Mode

After determining the mode, load the necessary files before executing:

### Modes that require `_shared.md` + their mode file:
Read `modes/_shared.md` + `modes/{mode}.md`

Applies to: `auto-pipeline`, `offer`, `offers`, `pdf`, `contact`, `apply`, `pipeline`, `scan`, `batch`

### Standalone modes (only their mode file):
Read `modes/{mode}.md`

Applies to: `tracker`, `deep`, `training`, `project`, `patterns`

### Modes delegated to subagent:
For `scan`, `apply` (with Playwright), and `pipeline` (3+ URLs): launch as Agent with the content of `_shared.md` + `modes/{mode}.md` injected into the subagent prompt.

```
Agent(
  subagent_type="general-purpose",
  prompt="[content of modes/_shared.md]\n\n[content of modes/{mode}.md]\n\n[invocation-specific data]",
  description="faber {mode}"
)
```

Execute the instructions from the loaded mode file.
