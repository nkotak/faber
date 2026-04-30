# Banned Phrases (Rule 19)

These 20 phrases are blocked verbatim in any user-facing prose. The validator catches them as case-insensitive substring matches.

## The list

1. through-line
2. convergence
3. intersection
4. unlock
5. form factor
6. next generation
7. transformative
8. mission-driven
9. practical developer features
10. cutting-edge AI advances
11. uniquely positioned
12. deeply resonates
13. at scale (unless paired with real numbers in the same clause)
14. founder muscle
15. rewired my workflow
16. the future of
17. not just X, but Y (any X / Y)
18. in a world where
19. the opportunity is clear
20. this is where I come in

## Why each is banned

| # | Phrase | Why |
|--|--|--|
| 1 | through-line | LLM-genre cliche. Means nothing concrete. |
| 2 | convergence | Abstract; "X and Y came together" works in plain English. |
| 3 | intersection | "At the intersection of..." is the canonical grand-synthesis opener. |
| 4 | unlock | Verb hijacked by SaaS marketing. Prefer "enable" or name what gets enabled. |
| 5 | form factor | Abstract category language. Name the actual artifact (CLI, API, UI). |
| 6 | next generation | Marketing filler. |
| 7 | transformative | Adjective inflation. |
| 8 | mission-driven | Empty signaling. Per Rule 9, name the specific reason. |
| 9 | practical developer features | Polished adjective phrase. Name the feature. |
| 10 | cutting-edge AI advances | All four words are filler. |
| 11 | uniquely positioned | Per Rule 7, no comparative claims. |
| 12 | deeply resonates | Per Rule 17, plain emotion beats cinematic. |
| 13 | at scale (without numbers) | Hand-waving. "At scale" without a number means nothing. |
| 14 | founder muscle | Per Rule 14, polished adjective. |
| 15 | rewired my workflow | Per Rule 17, cinematic. |
| 16 | the future of | Marketing filler. |
| 17 | not just X, but Y | Per Rule 1, contrast framing. |
| 18 | in a world where | Movie-trailer voice. |
| 19 | the opportunity is clear | Filler. State the opportunity. |
| 20 | this is where I come in | Self-mythology. |

## Exceptions

**Rule 13 ("at scale")**: Permitted when the same clause names a real number. "Disney APIs at scale (10B requests/year)" is fine. "developer platforms at scale" is not.

**Compound technical terms**: "form-factor" inside a literal hardware-spec discussion (e.g. "the M.2 form factor") is fine. The validator distinguishes by checking whether the phrase appears in a numbered/spec context. If the validator false-positives on legitimate technical use, the agent can override after confirming context.

## How the validator finds them

The validator does case-insensitive substring matching with word-boundary awareness. "intersection" matches "Intersection", "INTERSECTION", and "intersections" but not "interconnection".

For phrases with placeholders (rule 17: "not just X, but Y"), the validator uses regex to match the surrounding structure: `\bnot just \w[\w\s,]{1,40}\bbut\b`.

For "at scale" (rule 13), the validator flags only when no digit or unit appears within 5 words of the phrase.
