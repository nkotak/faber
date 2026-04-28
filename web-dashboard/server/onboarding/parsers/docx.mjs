// onboarding/parsers/docx.mjs - extract text from a DOCX buffer.
//
// Uses mammoth ^1.8.0 (https://www.npmjs.com/package/mammoth). We use
// extractRawText (not the HTML converter) because we want plain text
// for the LLM downstream; mammoth's raw extractor preserves paragraph
// breaks well enough for resume parsing.
//
// Sample input:  Buffer (raw .docx bytes)
// Expected output: { text: string }

import mammoth from 'mammoth';
import { validateAndNormalize } from './text.mjs';

const DOCX_TEXT_MIN_CHARS = 50;

export class DocxTextEmptyError extends Error {
  constructor(message, { charsExtracted }) {
    super(message);
    this.name = 'DocxTextEmptyError';
    this.code = 'DOCX_TEXT_EMPTY';
    this.charsExtracted = charsExtracted ?? 0;
  }
}

export class DocxParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DocxParseError';
    this.code = 'DOCX_PARSE_FAILED';
  }
}

/**
 * Extract raw text from a DOCX buffer.
 * @param {Buffer} buffer
 * @returns {Promise<{ text: string, warnings: string[] }>}
 * @throws {DocxTextEmptyError|DocxParseError|TextOutOfRangeError}
 */
export async function extractTextFromDocx(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new DocxParseError('extractTextFromDocx: expected Buffer input');
  }
  let result;
  try {
    result = await mammoth.extractRawText({ buffer });
  } catch (err) {
    throw new DocxParseError(`mammoth failed: ${err?.message ?? 'unknown'}`);
  }
  const rawText = String(result?.value ?? '');
  const stripped = rawText.trim();

  if (stripped.length < DOCX_TEXT_MIN_CHARS) {
    throw new DocxTextEmptyError(
      `DOCX yielded only ${stripped.length} chars`,
      { charsExtracted: stripped.length },
    );
  }

  const normalized = validateAndNormalize(stripped);
  const warnings = (result?.messages ?? []).map((m) => `${m.type}: ${m.message}`);
  return { text: normalized, warnings };
}

// ---------------------------------------------------------------------------
// Validation block
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = [];
  let totalTests = 0;

  // Test 1: non-buffer input throws.
  totalTests += 1;
  try {
    await extractTextFromDocx('not a buffer');
    failures.push('expected throw on string input');
  } catch (err) {
    if (err.code !== 'DOCX_PARSE_FAILED') failures.push(`expected DOCX_PARSE_FAILED, got ${err.code}`);
  }

  // Test 2: bogus buffer throws DocxParseError.
  totalTests += 1;
  try {
    await extractTextFromDocx(Buffer.from('not a docx'));
    failures.push('expected throw on garbage input');
  } catch (err) {
    if (!['DOCX_PARSE_FAILED', 'DOCX_TEXT_EMPTY'].includes(err.code)) {
      failures.push(`expected DOCX_PARSE_FAILED, got ${err.code}`);
    }
  }

  if (failures.length > 0) {
    console.error(`VALIDATION FAILED - ${failures.length} of ${totalTests} tests failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  } else {
    console.log(`VALIDATION PASSED - All ${totalTests} tests produced expected results`);
    process.exit(0);
  }
}
