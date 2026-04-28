// onboarding/parsers/pdf.mjs - extract text from a PDF buffer.
//
// Uses pdf-parse ^1.1.1 (https://www.npmjs.com/package/pdf-parse) which
// wraps Mozilla's pdfjs-dist. The library is purely Node-side and does
// no rendering, so it cannot read text from image-only PDFs (scans).
// We surface that case explicitly with PdfTextEmptyError so the route
// can return 422 with a "paste the text yourself" hint.
//
// Sample input:  Buffer (raw .pdf bytes)
// Expected output: { text: string, numpages: number }

import pdfParse from 'pdf-parse';
import { validateAndNormalize, TextOutOfRangeError } from './text.mjs';

/** Anything below this many characters is treated as an image-only PDF. */
const PDF_TEXT_MIN_CHARS = 50;

export class PdfTextEmptyError extends Error {
  constructor(message, { numpages, charsExtracted }) {
    super(message);
    this.name = 'PdfTextEmptyError';
    this.code = 'PDF_TEXT_EMPTY';
    this.numpages = numpages ?? 0;
    this.charsExtracted = charsExtracted ?? 0;
  }
}

export class PdfParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PdfParseError';
    this.code = 'PDF_PARSE_FAILED';
  }
}

/**
 * Extract text from a PDF buffer.
 * @param {Buffer} buffer
 * @returns {Promise<{ text: string, numpages: number }>}
 * @throws {PdfTextEmptyError} when extracted text is below the threshold
 *                              (typically: image-only PDF / scan).
 * @throws {PdfParseError} when pdf-parse fails outright.
 * @throws {TextOutOfRangeError} when extracted text exceeds 200_000 chars
 *                                (we hard-cap to avoid runaway prompts).
 */
export async function extractTextFromPdf(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new PdfParseError('extractTextFromPdf: expected Buffer input');
  }
  let result;
  try {
    result = await pdfParse(buffer);
  } catch (err) {
    throw new PdfParseError(`pdf-parse failed: ${err?.message ?? 'unknown'}`);
  }

  const rawText = String(result?.text ?? '');
  const numpages = Number(result?.numpages ?? 0);
  const stripped = rawText.trim();

  if (stripped.length < PDF_TEXT_MIN_CHARS) {
    throw new PdfTextEmptyError(
      `PDF yielded only ${stripped.length} chars; likely an image-only scan`,
      { numpages, charsExtracted: stripped.length },
    );
  }

  // Pass through the same normalizer as the textarea path.
  // If the PDF has way too much text, validateAndNormalize throws TEXT_TOO_LONG.
  const normalized = validateAndNormalize(stripped);
  return { text: normalized, numpages };
}

// ---------------------------------------------------------------------------
// Validation block
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = [];
  let totalTests = 0;

  // Test 1: empty buffer throws PdfParseError.
  totalTests += 1;
  try {
    await extractTextFromPdf(Buffer.alloc(0));
    failures.push('expected throw on empty buffer');
  } catch (err) {
    if (err.code !== 'PDF_PARSE_FAILED' && err.code !== 'PDF_TEXT_EMPTY') {
      failures.push(`expected PDF_PARSE_FAILED or PDF_TEXT_EMPTY, got ${err.code}`);
    }
  }

  // Test 2: non-buffer input throws.
  totalTests += 1;
  try {
    await extractTextFromPdf('not a buffer');
    failures.push('expected throw on string input');
  } catch (err) {
    if (err.code !== 'PDF_PARSE_FAILED') failures.push(`expected PDF_PARSE_FAILED, got ${err.code}`);
  }

  // (We don't include a real PDF fixture in this validation block - the
  // smoke test from the parent harness will exercise that path.)

  // Suppress the unused-import lint since TextOutOfRangeError is part of
  // the public throws contract:
  void TextOutOfRangeError;

  if (failures.length > 0) {
    console.error(`VALIDATION FAILED - ${failures.length} of ${totalTests} tests failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  } else {
    console.log(`VALIDATION PASSED - All ${totalTests} tests produced expected results`);
    process.exit(0);
  }
}
