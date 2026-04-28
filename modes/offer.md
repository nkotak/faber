# Mode: offer — Full A-F Evaluation

When the candidate pastes an offer (text or URL), ALWAYS deliver all 6 blocks:

## Step 0 — Archetype detection

Classify the offer into one of the 6 archetypes (see `_shared.md`). If it's a hybrid, indicate the 2 closest ones. This determines:
- Which proof points to prioritize in Block B
- How to rewrite the summary in Block E
- Which STAR stories to prepare in Block F

## Block A — Role summary

Table with:
- Detected archetype
- Domain (platform/agentic/LLMOps/ML/enterprise)
- Function (build/consult/manage/deploy)
- Seniority
- Remote (full/hybrid/onsite)
- Team size (if mentioned)
- TL;DR in 1 sentence

## Block B — CV match

Read `cv.md`. Create a table mapping each JD requirement to exact lines from the CV.

**Adapted to the archetype:**
- If FDE → prioritize proof points of fast delivery and client-facing work
- If SA → prioritize system design and integrations
- If PM → prioritize product discovery and metrics
- If LLMOps → prioritize evals, observability, pipelines
- If Agentic → prioritize multi-agent, HITL, orchestration
- If Transformation → prioritize change management, adoption, scaling

**Gaps** section with a mitigation strategy for each. For each gap:
1. Is it a hard blocker or a nice-to-have?
2. Can the candidate demonstrate adjacent experience?
3. Is there a portfolio project that covers this gap?
4. Concrete mitigation plan (cover-letter sentence, quick project, etc.)

## Block C — Level and strategy

1. **Level detected** in the JD vs. **the candidate's natural level for that archetype**
2. **"Sell senior without lying" plan**: specific phrases adapted to the archetype, concrete wins to highlight, how to position founder experience as an advantage
3. **"If they downlevel me" plan**: accept if comp is fair, negotiate a 6-month review, clear promotion criteria

## Block D — Comp and demand

Use WebSearch to find:
- Current salaries for the role (Glassdoor, Levels.fyi, Blind)
- The company's compensation reputation
- Demand trend for the role

Table with data and cited sources. If there's no data, say so instead of inventing.

## Block E — Personalization plan

| # | Section | Current state | Proposed change | Why |
|---|---------|---------------|-----------------|-----|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

Top 5 CV changes + top 5 LinkedIn changes to maximize match.

## Block F — Interview plan

6-10 STAR+R stories mapped to JD requirements (STAR + **Reflection**):

| # | JD requirement | STAR+R story | S | T | A | R | Reflection |
|---|----------------|--------------|---|---|---|---|------------|

The **Reflection** column captures what was learned or what would be done differently. This signals seniority — junior candidates describe what happened, senior candidates extract lessons.

**Story Bank:** If `interview-prep/story-bank.md` exists, check whether any of these stories are already there. If not, append the new ones. Over time this builds a reusable bank of 5-10 master stories that can be adapted to any interview question.

**Selected and framed per archetype:**
- FDE → emphasize delivery speed and client-facing work
- SA → emphasize architecture decisions
- PM → emphasize discovery and trade-offs
- LLMOps → emphasize metrics, evals, production hardening
- Agentic → emphasize orchestration, error handling, HITL
- Transformation → emphasize adoption, organizational change

Also include:
- 1 recommended case study (which of the candidate's projects to present and how)
- Red-flag questions and how to answer them (e.g., "why did you sell your company?", "do you have direct reports?")

---

## Post-evaluation

**ALWAYS** after generating blocks A-F:

### 1. Save the report .md

Save the full evaluation to `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`.

- `{###}` = next sequential number (3 digits, zero-padded)
- `{company-slug}` = company name in lowercase, hyphenated (no spaces)
- `{YYYY-MM-DD}` = current date

**Report format:**

```markdown
# Evaluation: {Company} — {Role}

**Date:** {YYYY-MM-DD}
**Archetype:** {detected}
**Score:** {X/5}
**PDF:** {path or pending}

---

## A) Role Summary
(full contents of Block A)

## B) CV Match
(full contents of Block B)

## C) Level and Strategy
(full contents of Block C)

## D) Comp and Demand
(full contents of Block D)

## E) Personalization Plan
(full contents of Block E)

## F) Interview Plan
(full contents of Block F)

## G) Draft Application Answers
(only if score >= 4.5 — draft answers for the application form)

---

## Extracted Keywords
(list of 15-20 keywords from the JD for ATS optimization)
```

### 2. Register in the tracker

**ALWAYS** register in `data/applications.md`:
- Next sequential number
- Current date
- Company
- Role
- Score: match average (1-5)
- Status: `Evaluated`
- PDF: ❌ (or ✅ if auto-pipeline generated the PDF)
- Report: relative link to the report .md (e.g., `[001](reports/001-company-2026-01-01.md)`)

**Tracker format:**

```markdown
| # | Date | Company | Role | Score | Status | PDF | Report |
```
