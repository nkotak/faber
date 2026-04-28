// onboarding/validation.mjs - zod schemas for every endpoint body and a
// markdown-injection-safe escape helper.
//
// Contract:
//   - Every onboarding POST body is parsed through one of the schemas below.
//   - Schemas are .strict() so unknown keys fail loudly (no silent drops).
//   - escapeForMarkdown() must be applied to every user-controlled string
//     that ends up inside modes/_profile.md. The renderer in
//     writers/profile-md.mjs is required to call this on every interpolation.
//
// Library: zod ^3.23.8 (https://zod.dev/)

import { z } from 'zod';

// -- Step 1: parse-resume payload ------------------------------------------
// Either a multipart upload (no body schema; multipart.mjs handles that)
// or this JSON body with raw text:
export const parseResumeJsonSchema = z
  .object({
    text: z
      .string()
      .min(200, 'text must be at least 200 chars')
      .max(200_000, 'text exceeds 200K chars'),
  })
  .strict();

// -- Step 1.5: commit-cv payload --------------------------------------------
// User can pass an editedContent override after reviewing the staged file.
export const commitCvSchema = z
  .object({
    editedContent: z.string().min(1).optional(),
  })
  .strict();

// -- Step 2: profile.yml payload --------------------------------------------
// Mirrors config/profile.example.yml lines 5-72. Lists are bounded to keep
// the YAML output readable; unknown keys are rejected.
const profileCandidate = z
  .object({
    full_name: z.string().min(1).max(200),
    email: z.string().email().max(200),
    phone: z.string().max(80).optional().default(''),
    location: z.string().min(1).max(200),
    linkedin: z.string().max(300).optional().default(''),
    portfolio_url: z.string().max(300).optional().default(''),
    github: z.string().max(300).optional().default(''),
    twitter: z.string().max(300).optional().default(''),
    canva_resume_design_id: z.string().max(80).optional(),
  })
  .strict();

const archetypeSchema = z
  .object({
    name: z.string().min(1).max(120),
    level: z.string().min(1).max(80),
    fit: z.enum(['primary', 'secondary', 'adjacent']),
  })
  .strict();

const profileTargetRoles = z
  .object({
    // Step 2's UI does not collect target roles — they're filled in step 3
    // (customize-profile-md) or later via Settings. Optional with default [].
    primary: z.array(z.string().min(1).max(160)).max(10).optional().default([]),
    // Archetypes get rich shape in modes/_profile.md (step 3). The slim
    // alias kept here for older modes is filled in step 3 too, so this
    // endpoint accepts an empty array on the initial step-2 write.
    archetypes: z.array(archetypeSchema).max(10).optional().default([]),
  })
  .strict();

const proofPointSchema = z
  .object({
    name: z.string().min(1).max(160),
    url: z.string().max(400).optional().default(''),
    hero_metric: z.string().max(280).optional().default(''),
  })
  .strict();

const dashboardDemoSchema = z
  .object({
    url: z.string().max(400).optional().default(''),
    password: z.string().max(120).optional().default(''),
  })
  .strict();

const profileNarrative = z
  .object({
    // Step 2 collects identity/comp/location; step 3 (customize-profile-md)
    // fills in the narrative bits that drive evaluation framing. All five
    // narrative fields are optional on this endpoint and gain content later.
    headline: z.string().max(240).optional().default(''),
    exit_story: z.string().max(1200).optional().default(''),
    superpowers: z.array(z.string().min(1).max(200)).max(10).optional().default([]),
    proof_points: z.array(proofPointSchema).max(20).optional().default([]),
    dashboard: dashboardDemoSchema.optional(),
  })
  .strict();

const profileCompensation = z
  .object({
    target_range: z.string().min(1).max(120),
    currency: z.string().min(2).max(8),
    minimum: z.string().min(1).max(80),
    location_flexibility: z.string().max(280).optional().default(''),
  })
  .strict();

const profileLocation = z
  .object({
    country: z.string().min(1).max(120),
    city: z.string().min(1).max(120),
    timezone: z.string().min(1).max(80),
    visa_status: z.string().max(280).optional().default(''),
    onsite_availability: z.string().max(280).optional(),
  })
  .strict();

export const profileYamlSchema = z
  .object({
    candidate: profileCandidate,
    target_roles: profileTargetRoles,
    narrative: profileNarrative,
    compensation: profileCompensation,
    location: profileLocation,
  })
  .strict();

// -- Step 3: customize-profile-md payload -----------------------------------
// Mirrors the structured shape used to render modes/_profile.template.md.
const profileMdArchetype = z
  .object({
    name: z.string().min(1).max(120),
    axes: z.array(z.string().min(1).max(80)).min(1).max(10),
    whatTheyBuy: z.string().min(1).max(280),
    fit: z.enum(['primary', 'secondary', 'adjacent']),
  })
  .strict();

const locationScoreShape = z
  .object({
    remote_within_country: z.number().int().min(1).max(5),
    remote_outside_country: z.number().int().min(1).max(5),
    hybrid_within_metro: z.number().int().min(1).max(5),
    onsite_within_metro: z.number().int().min(1).max(5),
    onsite_relocation: z.number().int().min(1).max(5),
  })
  .strict();

export const profileMdSchema = z
  .object({
    archetypes: z.array(profileMdArchetype).min(1).max(8),
    exit_narrative: z.string().min(1).max(2400),
    cross_cutting_advantage: z.string().min(1).max(1200),
    deal_breakers: z.array(z.string().min(1).max(240)).max(20),
    location_scoring: locationScoreShape,
    portfolio: z
      .object({
        url: z.string().max(300).optional().default(''),
        password: z.string().max(120).optional().default(''),
        when_to_share: z.string().max(280).optional().default(''),
      })
      .strict()
      .optional(),
    comp_notes: z.string().max(1200).optional().default(''),
  })
  .strict();

// -- Step 4: portals.yml payload --------------------------------------------
const portalsCompanyToggle = z
  .object({
    name: z.string().min(1).max(160),
    enabled: z.boolean(),
  })
  .strict();

export const portalsSchema = z
  .object({
    use_defaults: z.boolean(),
    title_filter: z
      .object({
        positive: z.array(z.string().min(1).max(80)).max(150).optional().default([]),
        negative: z.array(z.string().min(1).max(80)).max(150).optional().default([]),
      })
      .strict()
      .optional(),
    companies: z.array(portalsCompanyToggle).max(300).optional().default([]),
  })
  .strict();

// -- Step 5: init-tracker payload (empty body OK) ---------------------------
export const initTrackerSchema = z
  .object({
    force: z.boolean().optional().default(false),
  })
  .strict()
  .optional();

// ---------------------------------------------------------------------------
// escapeForMarkdown
// ---------------------------------------------------------------------------
// Apply this to every user-controlled string before it lands inside
// modes/_profile.md. Three behaviors:
//
//   1. Strip raw HTML tags (defeats embedded <script>/<style> noise).
//   2. Escape pipe characters (|) by backslash so the user can't break
//      out of a markdown table cell into the next column.
//   3. Neutralize fenced code blocks: if the user pastes ``` we replace
//      them with the visually-similar BACKTICK ZERO-WIDTH-SPACE BACKTICK
//      sequence so the markdown parser doesn't open a fenced block that
//      would swallow downstream sections.
//   4. Trim and clamp to a sane upper bound (defense-in-depth above zod).
//
// Important: this is NOT for HTML rendering - the markdown is rendered
// elsewhere through markdown-it + DOMPurify. This is purely about keeping
// the .md file syntactically intact so subsequent reads/parses don't break.
//
// @param {string} input
// @param {{ maxLen?: number }} [opts]
// @returns {string}
export function escapeForMarkdown(input, opts = {}) {
  const maxLen = opts.maxLen ?? 4000;
  if (input == null) return '';
  let s = String(input);

  // Strip raw HTML tags. Cheap and intentionally permissive: we don't try
  // to be a full sanitizer because rendering goes through DOMPurify on the
  // frontend; we just want the source markdown to not have angle-bracket
  // surprises.
  s = s.replace(/<\/?[a-z][\s\S]*?>/gi, '');

  // Escape pipe characters that could break out of table cells.
  s = s.replace(/\|/g, '\\|');

  // Neutralize triple-backtick fences so user content can never open a
  // code block that swallows the rest of the document.
  s = s.replace(/```/g, '`​`​`');

  // Strip carriage returns that can confuse line-based parsers downstream.
  s = s.replace(/\r/g, '');

  // Collapse runs of newlines longer than 2 (paragraph break) - user
  // narrative shouldn't have huge gaps.
  s = s.replace(/\n{3,}/g, '\n\n');

  s = s.trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

// ---------------------------------------------------------------------------
// Validation block
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = [];
  let totalTests = 0;

  // Test 1: profileYamlSchema accepts a well-formed payload.
  totalTests += 1;
  const goodProfile = {
    candidate: { full_name: 'Test', email: 'a@b.co', location: 'NYC' },
    target_roles: {
      primary: ['Senior PM'],
      archetypes: [{ name: 'Senior PM', level: 'Senior', fit: 'primary' }],
    },
    narrative: {
      headline: 'h',
      exit_story: 'e',
      superpowers: ['a', 'b', 'c'],
    },
    compensation: { target_range: '$1', currency: 'USD', minimum: '$1' },
    location: { country: 'US', city: 'NYC', timezone: 'EST' },
  };
  const r1 = profileYamlSchema.safeParse(goodProfile);
  if (!r1.success) failures.push(`profileYaml happy path failed: ${r1.error.message}`);

  // Test 2: profileYamlSchema rejects unknown keys.
  totalTests += 1;
  const r2 = profileYamlSchema.safeParse({ ...goodProfile, hacker: 'rm -rf /' });
  if (r2.success) failures.push('profileYaml should reject unknown top-level key');

  // Test 3: profileYamlSchema rejects bad email.
  totalTests += 1;
  const r3 = profileYamlSchema.safeParse({
    ...goodProfile,
    candidate: { ...goodProfile.candidate, email: 'not-an-email' },
  });
  if (r3.success) failures.push('profileYaml should reject bad email');

  // Test 4: escapeForMarkdown handles HTML, pipes, fences.
  totalTests += 1;
  const escaped = escapeForMarkdown('<script>alert(1)</script>|cell|cell\n```\nbad\n```');
  if (escaped.includes('<script>')) failures.push('escape did not strip <script>');
  // After escaping, pipes become \| so the substring "|cell" no longer
  // appears bare; instead "\\|cell" should appear.
  if (!escaped.includes('\\|cell')) failures.push(`escape did not escape pipe (got: ${escaped})`);
  if (/(?<!`)```(?!`)/.test(escaped)) failures.push('escape did not neutralize fence');

  // Test 5: escapeForMarkdown trims and clamps.
  totalTests += 1;
  const long = 'x'.repeat(5000);
  const trimmed = escapeForMarkdown(long, { maxLen: 100 });
  if (trimmed.length !== 100) failures.push(`escape clamp failed: got ${trimmed.length}`);

  // Test 6: profileMdSchema accepts good payload.
  totalTests += 1;
  const goodMd = {
    archetypes: [{ name: 'X', axes: ['a'], whatTheyBuy: 'b', fit: 'primary' }],
    exit_narrative: 'n',
    cross_cutting_advantage: 'c',
    deal_breakers: [],
    location_scoring: {
      remote_within_country: 5,
      remote_outside_country: 4,
      hybrid_within_metro: 2,
      onsite_within_metro: 1,
      onsite_relocation: 1,
    },
  };
  const r6 = profileMdSchema.safeParse(goodMd);
  if (!r6.success) failures.push(`profileMd happy path failed: ${r6.error.message}`);

  // Test 7: portalsSchema accepts use_defaults: true with no other config.
  totalTests += 1;
  const r7 = portalsSchema.safeParse({ use_defaults: true });
  if (!r7.success) failures.push(`portals happy path failed: ${r7.error.message}`);

  // Test 8: parseResumeJsonSchema rejects too-short text.
  totalTests += 1;
  const r8 = parseResumeJsonSchema.safeParse({ text: 'short' });
  if (r8.success) failures.push('parseResume should reject short text');

  if (failures.length > 0) {
    console.error(`VALIDATION FAILED - ${failures.length} of ${totalTests} tests failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  } else {
    console.log(`VALIDATION PASSED - All ${totalTests} tests produced expected results`);
    process.exit(0);
  }
}
