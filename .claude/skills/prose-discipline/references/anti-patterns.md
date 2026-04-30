# The 19 Anti-Patterns

Each rule shows a real example of the failure mode and a corrected version.

---

## Rule 1 — No contrast framing

**Pattern:** "This isn't X, it's Y." / "Not X but Y."

The reader doesn't need to be told what something isn't. State what it is.

✗ "This isn't a roadmap exercise, it's a discovery exercise."
✓ "This is a discovery exercise."

✗ "I'm not just a PM, I'm a builder."
✓ "I prototype, ship, and own the rollout."

---

## Rule 2 — No engagement bait

**Pattern:** "but here's the thing", "here's what most people get wrong", "let me tell you why"

These phrases are filler that signals a high-school essay or LinkedIn-influencer voice. They never improve the message.

✗ "Most PMs underestimate observability. But here's the thing — I shipped it for 250M subscribers."
✓ "I shipped observability for 250M subscribers."

---

## Rule 3 — No em-dashes

**Pattern:** Em-dash (—) or en-dash (–) used in prose. Hyphens (-) inside compound words are fine.

Use commas, full stops, or restructure.

✗ "I shipped agentic systems — the kind most teams talk about but never deploy."
✓ "I shipped agentic systems. Most teams talk about them; few deploy them."

The validator catches `—` (U+2014) and `–` (U+2013). `generate-pdf.mjs` will normalize them at render time, but the prose should not contain them at draft time either, because they show up in chat output and PDFs that bypass normalization.

---

## Rule 4 — No grand-synthesis phrases

**Pattern:** "At the intersection of X and Y...", "This maps directly to my experience.", "I keep ending up in the same kind of work: turning messy technical capability into something teams can actually use."

These read as rehearsed and are usually a sign the writer is summarizing rather than describing.

✗ "At the intersection of platform thinking and AI-native product, my work has always been about..."
✓ "I shipped Disney's API consolidation across 8 teams. I founded Roominary. I run AI product at OneSignal."

---

## Rule 5 — No keynote-speaker self-summaries

**Pattern:** "I've spent the last seven years building all three into the same person." / "I've had to build all three muscles because the products I've worked on demanded it."

Self-mythology. Replace with the concrete work.

✗ "I've spent the last seven years building all three into the same person."
✓ "I led platform consolidation at Disney, founded Roominary, and now run AI at OneSignal."

---

## Rule 6 — Kill overly symmetrical lists

**Pattern:** Rule of three. "Three things map this role to the next ten years of my work: research, developer platforms, and zero-to-one shipping."

The rhetorical symmetry signals rehearsal. Use one strong example, not three abstract bullets.

✗ "The role sits close to the work I already gravitate toward: research-heavy product thinking, developer workflows, and early product definition."
✓ "I gravitate toward early product definition for developer-facing products."

---

## Rule 7 — No broad comparative claims about other candidates

**Pattern:** "Most Principal PMs have one of those three. I have all three." / "That combination is rare."

Confidence by comparison reads as insecurity. The work speaks. Make the work specific.

✗ "Most Principal PMs have one of those three. I have all three."
✓ "I founded Roominary, ran AI for 250M Disney subscribers, and now own SDK strategy for OneSignal's 1M+ developers."

---

## Rule 8 — Use specific product behavior, not abstract category language

**Pattern:** "The form factor is unwritten." / "We're rethinking the developer experience."

Categories are placeholders for not-yet-decided thinking. Name what changes.

✗ "The form factor is unwritten."
✓ "We haven't decided whether the SDK is a thin client, a hosted API, or a CLI."

---

## Rule 9 — Mission language must be backed by a concrete reason

**Pattern:** "I want Anthropic because the work is the mission." / "Mission-driven."

If the mission claim doesn't cite a specific paper, product behavior, or decision, it's filler.

✗ "I want Anthropic because the work is the mission."
✓ "I want Anthropic because Constitutional AI is the first plausible alignment story I can ship product around."

---

## Rule 10 — Vary sentence length aggressively

**Pattern:** Three or more sentences in a row at similar length, especially long ones.

✗ "I founded Roominary.ai, a Next.js-plus-serverless-GPU AI virtual staging product, and shipped it to $1K MRR in 30 days, solo. I built the infra, the product, and the GTM motion. I learned what early traction actually feels like, and how to read paying customers."

✓ "I founded Roominary.ai. Shipped to $1K MRR in 30 days. Solo on infra, product, and GTM. The thing I learned: paying customers send signals long before $1K, and reading them is the whole job."

---

## Rule 11 — Use fewer "perfect bridge" sentences

The reader doesn't need an explicit transition between every paragraph. Sometimes paragraph breaks alone do the work.

✗ "...which brings me to the second reason this role fits. Beyond the technical depth, I bring..."
✓ Just start the next paragraph with the second reason.

---

## Rule 12 — No "I can X, Y, and Z" unless each verb is concrete

**Pattern:** "I can read the papers, prototype the idea, understand the developer workflow, and turn it into something people actually use."

Four abstractions in a row. Pick one and substantiate it. The validator flags the "I can [verb], [verb], and [verb]" pattern.

✗ "I can read the papers, prototype the idea, understand the developer workflow, and turn it into something people actually use."
✓ "I read the YOCO paper, prototyped the kv-cache reduction in PyTorch, and got a working repo to 70+ stars."

---

## Rule 13 — Keep one strong claim per paragraph

**Pattern:** "I shipped X, founded Y, implemented Z, and now lead A."

One paragraph, one idea. Splitting is usually free.

✗ "I shipped Disney's Unified Messaging Platform, founded Roominary, implemented YOCO-BitNet, and now lead AI at OneSignal."

✓ "I shipped Disney's Unified Messaging Platform — 250M subscribers, $300M operating income.

Then I founded Roominary, an AI virtual staging product. $1K MRR in 30 days, solo.

Now I lead AI product at OneSignal."

(Note: the example uses em-dashes for readability of the rule itself. In actual prose, restructure per Rule 3.)

---

## Rule 14 — Replace polished adjectives with operational specifics

**Banned adjective phrases (subset of Rule 19):**
- "practical developer features"
- "cutting-edge AI advances"
- "unusual but convergent path"
- "founder muscle"
- "developer platforms at scale"

✗ "I bring founder muscle to enterprise scale."
✓ "I shipped Roominary alone in 30 days, then ran a 70-person org at Disney for four years."

---

## Rule 15 — Do not end with a slogan

The closing sentence is the one the reader remembers. Don't waste it on a slogan.

✗ "And that's why I'd be a great fit. The future of AI product is the work, and the work is the mission."
✓ "Specific question I'd want to ask early: how do you measure whether a developer SDK is succeeding before usage data is meaningful?"

---

## Rule 16 — Prefer "because" over "as someone who"

**Pattern:** "As someone who has built developer platforms..."

"Because" is shorter, less self-introducing, and lands the claim.

✗ "As someone who has built developer platforms at scale, I think..."
✓ "Because I shipped OneSignal's SDK to 1M+ developers, I think..."

The validator catches "as someone who" and "as a person who".

---

## Rule 17 — Plain emotional claims, not cinematic

**Pattern:** "Claude Code rewired my workflow." / "This work resonates at the deepest level of how I think about product."

Emotional language reads as performed when it's adjective-heavy.

✗ "Claude Code rewired my workflow."
✓ "I use Claude Code daily for prototyping. It cut my time-to-first-PR from a day to an hour."

---

## Rule 18 — Use company/product names like a user, not press release

**Pattern:** "Claude Code has rewired a mid-career technical PM's workflow." / "Anthropic's Constitutional AI represents a paradigm shift."

Talk about the product the way a user does — what it does for you, in plain language.

✗ "Claude Code has rewired a mid-career technical PM's workflow."
✓ "I open Claude Code three or four times a day. Mostly to prototype things faster than I'd write them."

---

## Rule 19 — Banned phrases

See `banned-phrases.md` for the complete list (20 phrases). The validator catches them as case-insensitive substring matches.
