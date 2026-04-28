# Faber

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
</p>

---

## What Is This

Faber turns any AI coding CLI into a full job search command center. Instead of manually tracking applications in a spreadsheet, you get an AI-powered pipeline that:

- **Evaluates offers** with a structured A-F scoring system (10 weighted dimensions)
- **Generates tailored PDFs** -- ATS-optimized CVs customized per job description
- **Scans portals** automatically (Greenhouse, Ashby, Lever, company pages)
- **Processes in batch** -- evaluate 10+ offers in parallel with sub-agents
- **Tracks everything** in a single source of truth with integrity checks

> **Important: This is NOT a spray-and-pray tool.** Faber is a filter -- it helps you find the few offers worth your time out of hundreds. The system strongly recommends against applying to anything scoring below 4.0/5. Your time is valuable, and so is the recruiter's. Always review before submitting.

Faber is agentic: Claude Code navigates career pages with Playwright, evaluates fit by reasoning about your CV vs the job description (not keyword matching), and adapts your resume per listing.

> **Heads up: the first evaluations won't be great.** The system doesn't know you yet. Feed it context -- your CV, your career story, your proof points, your preferences, what you're good at, what you want to avoid. The more you nurture it, the better it gets. Think of it as onboarding a new recruiter: the first week they need to learn about you, then they become invaluable.

## Features

| Feature | Description |
|---------|-------------|
| **Auto-Pipeline** | Paste a URL, get a full evaluation + PDF + tracker entry |
| **6-Block Evaluation** | Role summary, CV match, level strategy, comp research, personalization, interview prep (STAR+R) |
| **Interview Story Bank** | Accumulates STAR+Reflection stories across evaluations -- 5-10 master stories that answer any behavioral question |
| **Negotiation Scripts** | Salary negotiation frameworks, geographic discount pushback, competing offer leverage |
| **ATS PDF Generation** | Keyword-injected CVs with Space Grotesk + DM Sans design |
| **Portal Scanner** | 45+ companies pre-configured (Anthropic, OpenAI, ElevenLabs, Retool, n8n...) + custom queries across Ashby, Greenhouse, Lever, Wellfound |
| **Batch Processing** | Parallel evaluation with `claude -p` workers |
| **Dashboard TUI** | Terminal UI to browse, filter, and sort your pipeline |
| **Human-in-the-Loop** | AI evaluates and recommends, you decide and act. The system never submits an application -- you always have the final call |
| **Pipeline Integrity** | Automated merge, dedup, status normalization, health checks |

## How Discovery Works — 3-Stage Cascade

Faber finds new job postings using three additive levels. Each one fills gaps the previous level misses:

| Level | Source | Speed | What it's good at |
|---|---|---|---|
| **1** | **ATS APIs** (Greenhouse, Ashby, Lever JSON endpoints) | ~5 sec for 30+ companies in parallel | Real-time, structured data including comp ranges. The fastest, most reliable layer. |
| **2** | **agent-browser CLI** (headless Chrome scraping custom careers pages) | Sequential, ~20-40 sec/company | Companies on Workable, Oracle HCM, or custom platforms with no public API. |
| **3** | **WebSearch** with `site:` filters | Variable | Broad discovery. Surfaces companies you don't track yet. Results need liveness verification because Google caches stale URLs. |

All three run on every `/faber scan`. Results are deduplicated against `scan-history.tsv`, your active pipeline, and your applications tracker. Level 3 URLs additionally get an `agent-browser` liveness check before reaching the pipeline — dead postings get filtered out at scan time, not at evaluation time.

Edit `portals.yml` to control who gets scanned at Level 1/2 and which queries run at Level 3.

## Quick Start — Two Paths

Choose the setup style that fits you. Both end up in the same place.

### Path A — Terminal-only (Claude Code)

```bash
# 1. Clone and install
git clone https://github.com/<your-username>/faber.git
cd faber && npm install
npx playwright install chromium   # Required for PDF generation
npm install -g agent-browser && agent-browser install   # For Level 2 scraping

# 2. Validate the install
npm run doctor

# 3. Set up your profile
cp config/profile.example.yml config/profile.yml
# Edit config/profile.yml with your name, email, target roles, salary range

# 4. Set up your CV
cp examples/cv-example.md cv.md
# Edit cv.md with your real experience, projects, education, skills

# 5. Customize the portals you want scanned
# Open portals.yml and review tracked_companies + title_filter
# Add companies you care about, remove ones you don't, tune positive/negative keywords

# 6. Open Claude Code and run your first scan
claude
# In the Claude session:
/faber scan              # Discovers new postings into data/pipeline.md
/faber pipeline          # OR: /faber batch — evaluates everything in the queue
```

### Path B — Web dashboard onboarding (PDF upload, GUI config)

```bash
# 1. Clone and install
git clone https://github.com/<your-username>/faber.git
cd faber && npm install
npx playwright install chromium

# 2. Install and launch the web dashboard
cd web-dashboard && npm install && cd ..
npx --prefix web-dashboard faber-web   # Opens http://127.0.0.1:7433

# 3. In the browser onboarding flow:
#    - Upload your existing resume PDF — gets parsed into cv.md
#    - Fill in your profile (name, target roles, salary) → saves config/profile.yml
#    - Customize portals (which companies to track) via the settings UI
#
# 4. Then drop into Claude Code for the actual scanning:
claude
/faber scan
```

> **You can always switch.** The web dashboard and the terminal flow read/write the same files (`cv.md`, `config/profile.yml`, `portals.yml`, `data/*`). Onboard via dashboard one day, edit YAML by hand the next.

### Don't have a CV yet?

`examples/cv-example.md` is a fully fleshed-out fictional CV (Alex Chen, ML engineer) that you can copy and rewrite as your own. Or upload your existing resume PDF to the web dashboard — the onboarding flow extracts text and converts it to the canonical `cv.md` format.

### Customize before you scan

Two files shape what Faber surfaces. Edit them before running `/faber scan` for the first time:

- **`portals.yml`** — which companies to track (Level 1 + 2) and which `site:` queries to run (Level 3). The `title_filter.positive` / `negative` keywords decide what counts as a relevant title.
- **`config/profile.yml`** — your target roles, salary band, location policy. Drives evaluation scoring.

Both have sane defaults. You can also just ask Claude to tune them: *"Add Stripe and Notion to portals.yml"* or *"Change my target roles to backend engineering."*

## Browsing Your Pipeline

Once you've scanned and evaluated, you have two ways to navigate hundreds of applications:

### Option 1 — Terminal TUI (Go + Bubble Tea)

```bash
cd dashboard
go build -o faber-dashboard .
./faber-dashboard --path ..
```

Six filter tabs, four sort modes, grouped/flat view, lazy-loaded report previews, inline status changes. Vim motions. Catppuccin theme.

### Option 2 — Web dashboard (React + Vite, editorial typography)

```bash
npx --prefix web-dashboard faber-web
# Opens http://127.0.0.1:7433
```

A reader's view of reports with editorial typography, inline PDF previews, command palette, live ticker via Server-Sent Events. Built with React + TanStack Query + TanStack Virtual. Runs on the same files the TUI reads — neither touches the other, you can run both simultaneously.

> **The system is designed to be customized by Claude itself.** Modes, archetypes, scoring weights, negotiation scripts — just ask Claude to change them. It reads the same files it uses, so it knows exactly what to edit.

See [docs/SETUP.md](docs/SETUP.md) for the full setup guide.

## Usage

Faber is a single slash command with multiple modes:

```
/faber                → Show all available commands
/faber {paste a JD}   → Full auto-pipeline (evaluate + PDF + tracker)
/faber scan           → Scan portals for new offers
/faber pdf            → Generate ATS-optimized CV
/faber batch          → Batch evaluate multiple offers
/faber tracker        → View application status
/faber apply          → Fill application forms with AI
/faber pipeline       → Process pending URLs
/faber contact        → LinkedIn outreach message
/faber deep           → Deep company research
/faber training       → Evaluate a course/cert
/faber project        → Evaluate a portfolio project
```

Or just paste a job URL or description directly -- faber auto-detects it and runs the full pipeline.

## How It Works

```
You paste a job URL or description
        │
        ▼
┌──────────────────┐
│  Archetype       │  Classifies: LLMOps / Agentic / PM / SA / FDE / Transformation
│  Detection       │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  A-F Evaluation  │  Match, gaps, comp research, STAR stories
│  (reads cv.md)   │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 Report  PDF  Tracker
  .md   .pdf   .tsv
```

## Pre-configured Portals

The scanner comes with **45+ companies** ready to scan and **19 search queries** across major job boards. Copy `templates/portals.example.yml` to `portals.yml` and add your own:

**AI Labs:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Voice AI:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**AI Platforms:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**Contact Center:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Enterprise:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Automation:** n8n, Zapier, Make.com
**European:** Factorial, Attio, Tinybird, Clarity AI, Travelperk

**Job boards searched:** Ashby, Greenhouse, Lever, Wellfound, Workable, RemoteFront

## Project Structure

```
faber/
├── CLAUDE.md                    # Agent instructions for Claude Code
├── cv.md                        # Your CV (gitignored — create from examples/cv-example.md or upload PDF)
├── article-digest.md            # Your proof points (optional, gitignored)
├── portals.yml                  # Scanner configuration (companies + queries + filters)
├── config/
│   ├── profile.example.yml      # Template for your profile (committed)
│   └── profile.yml              # Your actual profile (gitignored — copy from example)
├── modes/                       # Skill modes (English default; de/, fr/, pt/ available)
│   ├── _shared.md               # Shared system context
│   ├── _profile.template.md     # Template for user customization
│   ├── _profile.md              # Your archetypes/narrative (gitignored)
│   ├── offer.md                 # Single evaluation
│   ├── pdf.md                   # PDF generation
│   ├── scan.md                  # Portal scanner (3-stage cascade)
│   ├── batch.md                 # Batch processing
│   └── ...
├── templates/
│   ├── cv-template.html         # ATS-optimized CV template
│   ├── portals.example.yml      # Scanner config example
│   └── states.yml               # Canonical pipeline statuses
├── batch/
│   ├── batch-prompt.md          # Self-contained worker prompt
│   └── batch-runner.sh          # Parallel-worker orchestrator
├── dashboard/                   # Go + Bubble Tea TUI (terminal pipeline viewer)
├── web-dashboard/               # React + Vite web dashboard (PDF onboarding, editorial reports)
├── data/                        # Your tracking data (gitignored, .gitkeep preserves folder)
├── reports/                     # Evaluation reports (gitignored)
├── output/                      # Generated PDFs (gitignored)
├── interview-prep/              # Interview prep notes per company (gitignored)
├── jds/                         # Saved JDs from private/non-public URLs (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # Setup, customization, architecture
└── examples/                    # Sample CV (`cv-example.md`), report, proof points
```

## Tech Stack

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **Agent**: Claude Code with custom skills and modes
- **PDF**: Playwright/Puppeteer + HTML template
- **Scanner**: ATS JSON APIs + agent-browser (headless Chrome) + WebSearch
- **TUI Dashboard**: Go + Bubble Tea + Lipgloss (Catppuccin theme, vim motions)
- **Web Dashboard**: React + Vite + Fastify + TanStack Query/Virtual + Server-Sent Events
- **Data**: Markdown tables + YAML config + TSV batch files

## Disclaimer

**faber is a local, open-source tool — NOT a hosted service.** By using this software, you acknowledge:

1. **You control your data.** Your CV, contact info, and personal data stay on your machine and are sent directly to the AI provider you choose (Anthropic, OpenAI, etc.). We do not collect, store, or have access to any of your data.
2. **You control the AI.** The default prompts instruct the AI not to auto-submit applications, but AI models can behave unpredictably. If you modify the prompts or use different models, you do so at your own risk. **Always review AI-generated content for accuracy before submitting.**
3. **You comply with third-party ToS.** You must use this tool in accordance with the Terms of Service of the career portals you interact with (Greenhouse, Lever, Workday, LinkedIn, etc.). Do not use this tool to spam employers or overwhelm ATS systems.
4. **No guarantees.** Evaluations are recommendations, not truth. AI models may hallucinate skills or experience. The authors are not liable for employment outcomes, rejected applications, account restrictions, or any other consequences.

See [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md) for full details. This software is provided under the [MIT License](LICENSE) "as is", without warranty of any kind.

## License

MIT
