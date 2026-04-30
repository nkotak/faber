#!/usr/bin/env node
// validate-prose.mjs
// Deterministic linter for the prose-discipline skill.
// Catches the mechanical rules (3, 12, 16, 19) and well-known phrasings of rules 1, 2, 4.
// Output: JSON with violations array. Exit 0 = clean, exit 1 = violations.
//
// Usage:
//   node validate-prose.mjs <file>
//   echo "text" | node validate-prose.mjs -

import { readFileSync } from 'node:fs';
import { argv, stdin } from 'node:process';

// ---------- Banned phrases (Rule 19) ----------
// Stored as { needle, regex (built lazily), special } where special = "at-scale" | "not-just"
const BANNED = [
  { needle: 'through-line' },
  { needle: 'convergence' },
  { needle: 'intersection' },
  { needle: 'unlock' },
  { needle: 'form factor' },
  { needle: 'next generation' },
  { needle: 'transformative' },
  { needle: 'mission-driven' },
  { needle: 'practical developer features' },
  { needle: 'cutting-edge AI advances' },
  { needle: 'uniquely positioned' },
  { needle: 'deeply resonates' },
  { needle: 'at scale', special: 'at-scale' },
  { needle: 'founder muscle' },
  { needle: 'rewired my workflow' },
  { needle: 'the future of' },
  { needle: 'not just', special: 'not-just' },
  { needle: 'in a world where' },
  { needle: 'the opportunity is clear' },
  { needle: 'this is where I come in' },
];

// ---------- Rules ----------

function checkEmDashes(line, lineNum, violations) {
  // Rule 3: em-dash (U+2014) or en-dash (U+2013)
  const matches = [...line.matchAll(/[—–]/g)];
  for (const m of matches) {
    violations.push({
      rule: 3,
      line: lineNum,
      column: m.index + 1,
      snippet: snippet(line, m.index, 30),
      fix: 'Replace em/en-dash with comma, period, or restructure.',
    });
  }
}

function checkBannedPhrases(line, lineNum, violations) {
  // Rule 19: banned phrases
  const lower = line.toLowerCase();
  for (const { needle, special } of BANNED) {
    let idx = 0;
    while (idx < lower.length) {
      const found = lower.indexOf(needle.toLowerCase(), idx);
      if (found === -1) break;
      // Word-boundary check (rough): char before/after should not be a word char,
      // unless the needle itself starts/ends with non-word char.
      const before = found > 0 ? lower[found - 1] : ' ';
      const afterIdx = found + needle.length;
      const after = afterIdx < lower.length ? lower[afterIdx] : ' ';
      const needleStartsWord = /\w/.test(needle[0]);
      const needleEndsWord = /\w/.test(needle[needle.length - 1]);
      const okBefore = !needleStartsWord || !/\w/.test(before);
      const okAfter = !needleEndsWord || !/\w/.test(after);
      if (okBefore && okAfter) {
        // Special handling
        if (special === 'at-scale') {
          // Permitted if a digit or unit appears within 5 words on either side.
          const window = lower.slice(Math.max(0, found - 60), Math.min(lower.length, afterIdx + 60));
          if (!/\d/.test(window)) {
            violations.push({
              rule: 19,
              phrase: needle,
              line: lineNum,
              column: found + 1,
              snippet: snippet(line, found, 50),
              fix: '"at scale" needs a real number in the same clause, or remove.',
            });
          }
        } else if (special === 'not-just') {
          // Match "not just X, but Y" up to ~40 chars
          const tail = lower.slice(afterIdx, Math.min(lower.length, afterIdx + 80));
          if (/^[\s\w,'.;:-]{1,40}\bbut\b/.test(tail)) {
            violations.push({
              rule: 19,
              phrase: 'not just X, but Y',
              line: lineNum,
              column: found + 1,
              snippet: snippet(line, found, 60),
              fix: 'Per Rule 1, drop the contrast framing. State Y directly.',
            });
          }
        } else {
          violations.push({
            rule: 19,
            phrase: needle,
            line: lineNum,
            column: found + 1,
            snippet: snippet(line, found, 50),
            fix: `Remove "${needle}" and rephrase per references/banned-phrases.md.`,
          });
        }
      }
      idx = found + 1;
    }
  }
}

function checkICanXYZ(line, lineNum, violations) {
  // Rule 12: "I can [verb], [verb], and [verb]" pattern (3+ verbs).
  // Heuristic: I + (can|could) + word + comma + word + comma + ... + and + word
  const re = /\bI\s+(can|could)\s+([\w-]+(?:\s+[\w-]+)?)\s*,\s*([\w-]+(?:\s+[\w-]+)?)\s*,\s*(?:and\s+)?([\w-]+(?:\s+[\w-]+)?)/i;
  const m = line.match(re);
  if (m) {
    violations.push({
      rule: 12,
      line: lineNum,
      column: (m.index ?? 0) + 1,
      snippet: snippet(line, m.index ?? 0, 80),
      fix: 'Pick one verb and substantiate. Three+ abstract verbs in a row read as filler.',
    });
  }
}

function checkAsSomeoneWho(line, lineNum, violations) {
  // Rule 16: "as someone who" / "as a person who"
  const re = /\bas\s+(someone|a\s+person)\s+who\b/i;
  const m = line.match(re);
  if (m) {
    violations.push({
      rule: 16,
      line: lineNum,
      column: (m.index ?? 0) + 1,
      snippet: snippet(line, m.index ?? 0, 50),
      fix: 'Replace with "Because [I did X], ...".',
    });
  }
}

function checkContrastFraming(line, lineNum, violations) {
  // Rule 1: "isn't X, it's Y" / "is not X, it's Y" / "not X but Y"
  // The "not X but Y" case is partially covered in BANNED via 'not just', but standalone
  // "not X, but Y" pattern is also a violation.
  const patterns = [
    /\b(it|this|that)\s+(isn'?t|is\s+not)\s+\w[\w\s,'-]{0,40}\bit'?s\b/i,
    /\b(I|we)\s+(am|'m)\s+not\s+\w[\w\s,'-]{0,40}\bI'?m\b/i,
  ];
  for (const re of patterns) {
    const m = line.match(re);
    if (m) {
      violations.push({
        rule: 1,
        line: lineNum,
        column: (m.index ?? 0) + 1,
        snippet: snippet(line, m.index ?? 0, 80),
        fix: 'Drop contrast framing. State what it IS.',
      });
      break;
    }
  }
}

function checkEngagementBait(line, lineNum, violations) {
  // Rule 2: "but here's the thing", "here's what most people get wrong", "let me tell you"
  const phrases = [
    "but here's the thing",
    "here's the thing",
    "here's what most people get wrong",
    "let me tell you",
    "but here is the thing",
  ];
  const lower = line.toLowerCase();
  for (const p of phrases) {
    const idx = lower.indexOf(p);
    if (idx !== -1) {
      violations.push({
        rule: 2,
        line: lineNum,
        column: idx + 1,
        snippet: snippet(line, idx, 50),
        fix: 'Drop the engagement bait. State the point directly.',
      });
    }
  }
}

function checkGrandSynthesis(line, lineNum, violations) {
  // Rule 4: "at the intersection of", "this maps directly to", "I keep ending up"
  // ("intersection" is also caught by Rule 19 banned-phrases; the rule-4 flag adds context.)
  const phrases = [
    'at the intersection of',
    'this maps directly to',
    'i keep ending up',
    'at the heart of',
  ];
  const lower = line.toLowerCase();
  for (const p of phrases) {
    const idx = lower.indexOf(p);
    if (idx !== -1) {
      violations.push({
        rule: 4,
        line: lineNum,
        column: idx + 1,
        snippet: snippet(line, idx, 60),
        fix: 'Replace with the concrete work. Grand-synthesis phrases read as rehearsed.',
      });
    }
  }
}

// ---------- Helpers ----------

function snippet(line, start, len) {
  const end = Math.min(line.length, start + len);
  const s = line.slice(start, end);
  return s.trim();
}

// ---------- Main ----------

async function readInput(arg) {
  if (arg === '-' || !arg) {
    let buf = '';
    for await (const chunk of stdin) buf += chunk;
    return buf;
  }
  return readFileSync(arg, 'utf-8');
}

async function main() {
  const file = argv[2];
  if (!file) {
    console.error('Usage: validate-prose.mjs <file>  (or "-" for stdin)');
    process.exit(2);
  }

  const text = await readInput(file);
  const lines = text.split('\n');
  const violations = [];

  lines.forEach((line, i) => {
    const lineNum = i + 1;
    checkEmDashes(line, lineNum, violations);
    checkBannedPhrases(line, lineNum, violations);
    checkICanXYZ(line, lineNum, violations);
    checkAsSomeoneWho(line, lineNum, violations);
    checkContrastFraming(line, lineNum, violations);
    checkEngagementBait(line, lineNum, violations);
    checkGrandSynthesis(line, lineNum, violations);
  });

  const rulesTriggered = [...new Set(violations.map(v => v.rule))].sort((a, b) => a - b);

  const output = {
    file: file === '-' ? '<stdin>' : file,
    violations,
    summary: {
      violations: violations.length,
      rules_triggered: rulesTriggered,
    },
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(violations.length === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('validate-prose error:', err.message);
  process.exit(2);
});
