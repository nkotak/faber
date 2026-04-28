// onboarding/parsers/text.mjs - validate raw text resumes.
//
// The contract: input must be UTF-8 text in the 200..200_000 char range
// after normalization. Anything outside throws TextOutOfRangeError so the
// route handler can return a precise 422 with a useful message.

const MIN_TEXT_LEN = 200;
const MAX_TEXT_LEN = 200_000;

export class TextOutOfRangeError extends Error {
  constructor(message, { code }) {
    super(message);
    this.name = 'TextOutOfRangeError';
    this.code = code;
  }
}

/**
 * Normalize and validate a raw text resume.
 * - Strips BOM if present.
 * - Trims whitespace.
 * - Bounds the length to [200, 200_000] chars.
 *
 * @param {string} text
 * @returns {string} normalized text
 * @throws {TextOutOfRangeError}
 */
export function validateAndNormalize(text) {
  if (typeof text !== 'string') {
    throw new TextOutOfRangeError('text must be a string', { code: 'TEXT_INVALID_TYPE' });
  }
  let s = text;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.trim();
  if (s.length < MIN_TEXT_LEN) {
    throw new TextOutOfRangeError(
      `text too short: ${s.length} chars (minimum ${MIN_TEXT_LEN})`,
      { code: 'TEXT_TOO_SHORT' },
    );
  }
  if (s.length > MAX_TEXT_LEN) {
    throw new TextOutOfRangeError(
      `text too long: ${s.length} chars (maximum ${MAX_TEXT_LEN})`,
      { code: 'TEXT_TOO_LONG' },
    );
  }
  return s;
}

// ---------------------------------------------------------------------------
// Validation block
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = [];
  let totalTests = 0;

  // Test 1: validateAndNormalize accepts a 250-char string.
  totalTests += 1;
  try {
    const out = validateAndNormalize('x'.repeat(250));
    if (out.length !== 250) failures.push(`expected 250 chars, got ${out.length}`);
  } catch (err) {
    failures.push(`happy path threw: ${err.message}`);
  }

  // Test 2: too-short input throws TEXT_TOO_SHORT.
  totalTests += 1;
  try {
    validateAndNormalize('short text');
    failures.push('expected TEXT_TOO_SHORT throw');
  } catch (err) {
    if (err.code !== 'TEXT_TOO_SHORT') failures.push(`expected TEXT_TOO_SHORT, got ${err.code}`);
  }

  // Test 3: too-long input throws TEXT_TOO_LONG.
  totalTests += 1;
  try {
    validateAndNormalize('x'.repeat(200_001));
    failures.push('expected TEXT_TOO_LONG throw');
  } catch (err) {
    if (err.code !== 'TEXT_TOO_LONG') failures.push(`expected TEXT_TOO_LONG, got ${err.code}`);
  }

  // Test 4: BOM is stripped.
  totalTests += 1;
  const out4 = validateAndNormalize('﻿' + 'x'.repeat(250));
  if (out4.charCodeAt(0) === 0xfeff) failures.push('BOM not stripped');

  // Test 5: CRLF normalized to LF.
  totalTests += 1;
  const out5 = validateAndNormalize('a\r\nb'.repeat(100));
  if (out5.includes('\r')) failures.push('CR not normalized');

  if (failures.length > 0) {
    console.error(`VALIDATION FAILED - ${failures.length} of ${totalTests} tests failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  } else {
    console.log(`VALIDATION PASSED - All ${totalTests} tests produced expected results`);
    process.exit(0);
  }
}
