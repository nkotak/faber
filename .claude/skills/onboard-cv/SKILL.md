---
name: onboard-cv
description: Convert raw resume text (extracted from PDF/DOCX/paste) into the canonical faber cv.md format. Writes to cv-imported.md for user review before commit. Never writes to cv.md directly.
user_invocable: true
argument-hint: "/abs/path/to/extracted-text.txt"
---

# onboard-cv -- Resume Parser

You convert a raw, semi-structured resume text file into the canonical faber `cv.md` shape and write it to **`cv-imported.md`** at the project root. The user reviews and commits via the dashboard before it becomes `cv.md`.

## Inputs

The argument is an absolute path to a UTF-8 text file containing the extracted resume text (already pulled from PDF, DOCX, or pasted directly).

If `{{argument}}` is empty, exit with `[onboard-cv] error: no input path provided` on stderr and exit code 1.

## Output contract

You MUST produce a single file at `<project_root>/cv-imported.md` matching this exact structure:

```
# FULL NAME

City, State | email@example.com | (xxx) xxx-xxxx
[linkedin.com/in/handle](https://linkedin.com/in/handle) | [github.com/handle](https://github.com/handle)

---

## CORE SKILLS

**Category Name:** comma-separated skills, comma-separated skills

**Another Category:** more skills, more skills

---

## PROFESSIONAL EXPERIENCE

### Job Title | Company | Location
**Start Month YYYY – End Month YYYY**

- Bullet starting with action verb. Quantified metric where present.
- Another bullet. Preserve numbers, dates, and dollar figures EXACTLY as in source.

### Next Job Title | Next Company | Location
**Start – End**

- ...

---

## EDUCATION

**Degree** | School | YYYY

**Another Degree** | School | YYYY
```

Then emit the final JSON line on stdout described under "Final emit" below.

## Hard rules (do not violate)

1. **You may ONLY write to `<project_root>/cv-imported.md`.** Never write to `cv.md`. Never edit any other file.
2. **Preserve every metric verbatim.** "$300M+", "250M+ subscribers", "70+ engineers", "50% reduction" — copy them exactly as the source has them. Do not round, paraphrase, or convert units.
3. **Never invent dates, companies, titles, or numbers.** If the source is ambiguous, mark with a placeholder (see "Missing-field protocol").
4. **Reformat bullets to start with action verbs** (Led, Shipped, Designed, Built, Drove, Reduced, Owned, Engineered). If the source bullet is already verb-led, keep it.
5. **Tighten bloat.** "Was responsible for leading the team that..." -> "Led team that...". Never invent specificity that wasn't in the source.
6. **Preserve role chronology.** Most recent role first.
7. **Cluster CORE SKILLS into 3-5 categories.** Common categories: AI / ML, Product, Technical, Prototyping, Engineering, Leadership. Choose what fits the resume best. Each category gets ONE bolded label (`**Label:**`) followed by a comma-separated list on the same line.
8. **Education entries one per line**, format: `**Degree** | School | YYYY`. If the year is unknown, omit the year and add a placeholder warning.
9. **Markdown only.** No HTML, no code fences in the output (except the standard horizontal rules `---`).
10. **No emoji, no exclamation points** in the output.
11. **Use a horizontal rule (`---`) between the header block, CORE SKILLS, PROFESSIONAL EXPERIENCE, and EDUCATION sections.** Match the spacing in the example exactly.

## Missing-field protocol

When a required field cannot be extracted from the source, use these placeholders so the user sees them in the preview and can fill them in:

| Field | Placeholder |
|---|---|
| Email | `<email_missing>` |
| Phone | `<phone_missing>` |
| Location (header) | `<location_missing>` |
| LinkedIn | `<linkedin_missing>` |
| GitHub | `<github_missing>` (or omit the line if no GitHub at all) |
| Role end date for current job | `Present` |
| Role location | `<location_missing>` |

For each placeholder you emit, append a string to the `warnings` array in the final JSON line (see below).

If the resume genuinely lacks a section (e.g., no formal education), still emit the section heading but leave it empty. Add a warning: `"no education section found"`.

## Progress lines (stdout)

Emit progress lines on stdout as you work. The dashboard's job manager uses these to populate the live progress chip:

```
[onboard-cv] reading input
[onboard-cv] detecting structure
[onboard-cv] parsing N roles
[onboard-cv] parsing M skill categories
[onboard-cv] parsing K degrees
[onboard-cv] writing cv-imported.md
[onboard-cv] done: N roles, M skills categories, K degrees
```

Replace `N`, `M`, `K` with actual counts. Emit them in the order shown above. Each on its own line.

## Final emit (load-bearing)

After writing the file, emit ONE final line on stdout that is valid JSON:

```
{"event":"complete","roles":N,"skills_categories":M,"warnings":["..."],"profileSeed":{"full_name":"...","email":"...","location":"...","linkedin":"...","github":"...","suggested_archetypes":[{"name":"...","level":"...","fit":"primary|secondary|adjacent"}]}}
```

Field semantics:

- `event` is literally the string `"complete"`.
- `roles` is the integer count of roles you wrote under PROFESSIONAL EXPERIENCE.
- `skills_categories` is the integer count of bolded categories under CORE SKILLS.
- `warnings` is a string array with every missing-field warning you encountered. Empty array if no warnings.
- `profileSeed` is the structured payload the dashboard pre-fills the profile form with:
  - `full_name`, `email`, `location`, `linkedin`, `github` are strings extracted from the resume header. Use the empty string if not extractable (NOT the placeholder).
  - `suggested_archetypes` is an array of 1-3 archetype suggestions you derive from the role titles you parsed. Common archetypes:
    - "AI/ML Engineer" / "Senior" / "primary" — when ML/AI is dominant
    - "Senior Product Manager" / "Senior" / "primary" — when PM titles dominate
    - "Staff Engineer" / "Staff" / "primary" — when staff/principal IC titles dominate
    - "Solutions Architect" / "Senior" / "secondary" — when client-facing roles appear
    - "Forward Deployed Engineer" / "Senior" / "secondary" — when applied-engineering work appears
  - Choose 1 primary, optionally 1 secondary, optionally 1 adjacent based on the resume's clear strengths.

The JSON line must be on its own line, the LAST line of stdout, and parseable with `JSON.parse`. Do NOT wrap it in code fences.

## Worked example

If the input is a resume with these salient details:

- "Jane Doe — San Francisco, CA"
- "jane@example.com / (415) 555-1234"
- "linkedin.com/in/janedoe"
- "Senior ML Engineer at Acme, 2022 - present" — built an LLM eval platform reducing eval time 60%
- "Staff Engineer at Initech, 2018 - 2022" — designed Kafka pipeline at 100K msg/s
- "Skills: Python, PyTorch, TensorFlow, AWS, Kubernetes, MLOps, evaluation"
- "MS Computer Science, Stanford, 2018"
- "BS Math, MIT, 2016"

You produce `<project_root>/cv-imported.md`:

```
# JANE DOE

San Francisco, CA | jane@example.com | (415) 555-1234
[linkedin.com/in/janedoe](https://linkedin.com/in/janedoe)

---

## CORE SKILLS

**AI / ML:** Python, PyTorch, TensorFlow, MLOps, evaluation

**Infrastructure:** AWS, Kubernetes

---

## PROFESSIONAL EXPERIENCE

### Senior ML Engineer | Acme | <location_missing>
**2022 – Present**

- Built LLM evaluation platform reducing eval time 60%.

### Staff Engineer | Initech | <location_missing>
**2018 – 2022**

- Designed Kafka pipeline handling 100K msg/s.

---

## EDUCATION

**MS Computer Science** | Stanford | 2018

**BS Math** | MIT | 2016
```

And on stdout the final line:

```
{"event":"complete","roles":2,"skills_categories":2,"warnings":["role location missing for Senior ML Engineer at Acme","role location missing for Staff Engineer at Initech","no github found"],"profileSeed":{"full_name":"Jane Doe","email":"jane@example.com","location":"San Francisco, CA","linkedin":"linkedin.com/in/janedoe","github":"","suggested_archetypes":[{"name":"AI/ML Engineer","level":"Senior","fit":"primary"},{"name":"Staff Engineer","level":"Staff","fit":"secondary"}]}}
```

## Tools you should use

- `Read` to load the input text file from `{{argument}}`.
- `Write` to create `cv-imported.md` at the project root.
- Optionally `Bash` to read the file via `cat` if Read isn't sufficient (it should be).

Do NOT call any other tool. Do NOT invoke web search, WebFetch, Playwright, or other skills.

## Failure modes

- If the input text is shorter than 200 characters: emit `[onboard-cv] error: input text too short` on stderr and exit 1. The route handles this by failing the job.
- If you cannot identify ANY professional experience entries: still write `cv-imported.md` with whatever sections you can populate, add a warning `"no professional experience parsed"`, and emit the final JSON normally. The dashboard's preview lets the user fix this.
- If the file write fails: emit `[onboard-cv] error: write failed: <reason>` on stderr and exit 1.

## Your single job

Read the input text -> write `cv-imported.md` -> emit the JSON line. Nothing else.
