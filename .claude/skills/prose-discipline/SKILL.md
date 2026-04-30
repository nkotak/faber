---
name: prose-discipline
description: Voice and prose rules for application answers, CV summaries, draft cover letters, LinkedIn DMs, and any user-facing prose. Catches the 19 LLM-genre failure modes (em-dashes, "at the intersection of...", contrast framing, engagement bait, grand-synthesis phrases, slogan endings, broad comparative claims, polished adjectives) plus a 20-phrase blacklist. Invoked automatically before drafting prose and as a validation step before saving. Reference the anti-pattern catalog in references/anti-patterns.md and the phrase blacklist in references/banned-phrases.md. Run scripts/validate-prose.mjs <file> for deterministic linting.
user_invocable: false
---

# prose-discipline

Voice rules for prose that goes in front of recruiters, hiring managers, or LinkedIn contacts. Use **before** drafting to set the constraints, **during** drafting to self-check, and **after** drafting to validate mechanically.

## When to invoke

| Surface | When |
|--|--|
| Draft application answers (Section G of reports, `modes/apply.md`) | Before generating each answer; validate after |
| CV PDF summary text | During Stage 4 (Validate) of `modes/pdf.md` |
| Cover letters | Before drafting; validate after |
| LinkedIn DMs / outreach | Before drafting |
| Cold emails | Before drafting |

Do **not** apply to internal evaluation reports — those are notes-to-self and benefit from candor over polish.

## How to use

1. **Read** `references/anti-patterns.md` for the 19 rules with examples.
2. **Read** `references/banned-phrases.md` for the 20-phrase blacklist (rule 19).
3. **Read** `references/learned.md` for any rules harvested from positive outcomes (interviews, offers).
4. **Draft** prose with the rules in mind.
5. **Validate** mechanically: `node .claude/skills/prose-discipline/scripts/validate-prose.mjs <file>`.
6. **Fix** every violation. If the validator flags a rule the agent disagrees with, the validator wins for mechanical rules (3, 12, 16, 19) and the agent's judgment wins for non-mechanical rules (5, 7, 8, 11, 13, 14, 17).

## The 19 rules (categorized)

### Anti-rhetoric

1. No contrast framing. Don't write "This isn't X, it's Y." Just say what it is.
2. No engagement bait. Don't write "but here's the thing", "here's what most people get wrong", "let me tell you why."
4. No grand-synthesis phrases. Don't write "At the intersection of...", "This maps directly to my experience.", "I keep ending up in the same kind of work."
5. No keynote-speaker self-summaries. Don't write "I've spent the last seven years building all three into the same person."
11. Use fewer "perfect bridge" sentences. The reader doesn't need an explicit transition between every paragraph.
15. Do not end with a slogan.
16. Prefer "because" over "as someone who". "Because I shipped X" beats "As someone who has shipped X".

### Punctuation and structure

3. No em-dashes. Use commas, full stops, or restructure the sentence. The validator catches `—` and `–`.
10. Vary sentence length aggressively. Short. Then medium. Then a longer one with a real clause that earns its length. Then short again.
13. One strong claim per paragraph. Don't write "I shipped X, founded Y, implemented Z, and now lead A."

### Anti-abstraction

6. Kill overly symmetrical lists. The rule of three reads as rehearsed.
8. Use specific product behavior, not abstract category language. "The form factor is unwritten" → "we haven't decided whether this is a CLI, a hosted API, or a UI yet."
12. No "I can X, Y, and Z" unless each verb is concrete. "I can read the papers, prototype the idea, understand the developer workflow, and turn it into something people actually use" is four abstractions; pick one and substantiate it.
14. Replace polished adjectives with operational specifics. Avoid: "practical developer features", "cutting-edge AI advances", "unusual but convergent path", "founder muscle", "developer platforms at scale".
17. Plain emotional claims, not cinematic. "I want to work here" beats "this work resonates at the deepest level of how I think about product."
18. Use product names like a user, not press release. "Claude Code rewrote my Tuesday afternoons" → "I use Claude Code daily for prototyping."

### Anti-grandiosity

7. No broad comparative claims about other candidates. "Most Principal PMs have one of those three. I have all three." Don't.
9. Mission language must be backed by a concrete reason. "I want Anthropic because the work is the mission" → name a specific paper, product behavior, or technical decision.

### Banned phrases (rule 19)

The 20 phrases listed in `references/banned-phrases.md` are blocked verbatim. The validator catches them as case-insensitive substring matches.

## Validation workflow

```bash
node .claude/skills/prose-discipline/scripts/validate-prose.mjs <file>
```

Output is JSON:

```json
{
  "violations": [
    { "rule": 3, "line": 12, "snippet": "ship—and learn", "fix": "Use comma or period." },
    { "rule": 19, "line": 14, "phrase": "intersection", "fix": "Remove and rephrase." }
  ],
  "summary": { "violations": 2, "rules_triggered": [3, 19] }
}
```

The agent must fix every violation before saving the prose. After fixing, re-run the validator. Iterate until the output shows `violations: 0`.

## Mechanical vs judgment-call rules

The validator catches rules **3, 12, 16, 19** mechanically (regex / substring / pattern match). Rules **1, 2, 4** are caught for known phrasings ("isn't X, it's Y", "but here's the thing", "at the intersection of") but not exhaustively — the agent applies them while drafting.

Rules **5, 7, 8, 11, 13, 14, 17, 18** require judgment. The agent applies them while drafting and re-checks before commit. The validator does not flag these.

Rules **6, 10, 15** are partly mechanical (the validator can detect overly symmetrical lists like "X, Y, and Z" patterns appearing 3+ times in a single document, and slogan-shaped final sentences) but the agent makes the call on whether the structure is genuinely needed.

## Self-improvement (`references/learned.md`)

This file is auto-populated by `modes/reflect.md` after Interview/Offer transitions. When prose patterns correlate with positive outcomes, they get appended as additional guidance. The agent should read it alongside `anti-patterns.md` when drafting.
