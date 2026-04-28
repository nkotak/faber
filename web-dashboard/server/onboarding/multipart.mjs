// onboarding/multipart.mjs - receive a single resume upload from a
// @fastify/multipart request, dispatch to the right extractor, and stage
// the resulting text in <tmp>/faber-onboarding/<uuid>.txt for the
// claude -p subprocess to consume.
//
// Strategy:
//   1. Read the first file part. Reject extras as 400.
//   2. Cap the buffer at 10 MB (entries above are rejected; the multipart
//      plugin's `limits.fileSize` enforces the cap inline).
//   3. Validate MIME by extension AND content-type header. Treat
//      .pdf/.docx/.txt/.md as the only allowed types.
//   4. Dispatch:
//        application/pdf, .pdf  -> extractTextFromPdf
//        word/docx, .docx       -> extractTextFromDocx
//        text/*, .txt, .md      -> validateAndNormalize directly
//   5. Write the extracted text to a unique tmp file. Return the path.
//
// The route handler in index.mjs is responsible for spawning the
// onboarding-cv job with the tmp file path as argument and for unlinking
// the file when the job finalizes.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { extractTextFromPdf, PdfTextEmptyError, PdfParseError } from './parsers/pdf.mjs';
import { extractTextFromDocx, DocxTextEmptyError, DocxParseError } from './parsers/docx.mjs';
import { validateAndNormalize, TextOutOfRangeError } from './parsers/text.mjs';
import { getOnboardingTmpDir } from './cleanup.mjs';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED = {
  pdf:  { mimes: ['application/pdf'],                                                   ext: ['.pdf'] },
  docx: { mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ext: ['.docx'] },
  text: { mimes: ['text/plain', 'text/markdown', 'application/octet-stream'],            ext: ['.txt', '.md'] },
};

export class UploadError extends Error {
  constructor(message, { code, status }) {
    super(message);
    this.name = 'UploadError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Receive a multipart upload from a Fastify request, classify it, extract
 * text, and stage the text in a tmp file. Returns the staged path and a
 * "kind" tag for telemetry.
 *
 * @param {import('fastify').FastifyRequest} req
 * @returns {Promise<{ kind: 'pdf'|'docx'|'text', tmpPath: string, originalName: string, sizeBytes: number, charsExtracted: number }>}
 * @throws {UploadError}
 */
export async function receiveUpload(req) {
  if (!req.isMultipart()) {
    throw new UploadError('expected multipart request', { code: 'NOT_MULTIPART', status: 415 });
  }

  let part;
  try {
    part = await req.file({ limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
  } catch (err) {
    // @fastify/multipart throws RequestFileTooLargeError on cap breach.
    if (/RequestFileTooLargeError|file size limit/i.test(String(err))) {
      throw new UploadError('file exceeds 10 MB', { code: 'FILE_TOO_LARGE', status: 413 });
    }
    throw new UploadError(`multipart read failed: ${err?.message ?? 'unknown'}`, { code: 'MULTIPART_READ', status: 400 });
  }

  if (!part) {
    throw new UploadError('no file in upload', { code: 'NO_FILE', status: 400 });
  }

  const originalName = String(part.filename ?? 'upload');
  const ext = path.extname(originalName).toLowerCase();
  const mime = String(part.mimetype ?? '').toLowerCase();

  const kind = classify(ext, mime);
  if (!kind) {
    // Drain the stream so the connection doesn't hang.
    try { await part.toBuffer(); } catch { /* ignore */ }
    throw new UploadError(
      `unsupported file type: ${originalName} (${mime || 'unknown mime'})`,
      { code: 'UNSUPPORTED_TYPE', status: 415 },
    );
  }

  let buffer;
  try {
    buffer = await part.toBuffer();
  } catch (err) {
    if (/file size limit/i.test(String(err))) {
      throw new UploadError('file exceeds 10 MB', { code: 'FILE_TOO_LARGE', status: 413 });
    }
    throw new UploadError(`upload read failed: ${err?.message ?? 'unknown'}`, { code: 'UPLOAD_READ', status: 400 });
  }

  if (part.file?.truncated) {
    throw new UploadError('file exceeds 10 MB', { code: 'FILE_TOO_LARGE', status: 413 });
  }

  let text = '';
  try {
    if (kind === 'pdf') {
      ({ text } = await extractTextFromPdf(buffer));
    } else if (kind === 'docx') {
      ({ text } = await extractTextFromDocx(buffer));
    } else {
      // text/markdown
      text = validateAndNormalize(buffer.toString('utf-8'));
    }
  } catch (err) {
    if (err instanceof PdfTextEmptyError) {
      throw new UploadError(
        `PDF appears to be a scan (${err.charsExtracted} chars). Paste the text instead.`,
        { code: 'PDF_TEXT_EMPTY', status: 422 },
      );
    }
    if (err instanceof DocxTextEmptyError) {
      throw new UploadError(
        `DOCX yielded no text (${err.charsExtracted} chars).`,
        { code: 'DOCX_TEXT_EMPTY', status: 422 },
      );
    }
    if (err instanceof PdfParseError || err instanceof DocxParseError) {
      throw new UploadError(`could not parse file: ${err.message}`, { code: err.code, status: 422 });
    }
    if (err instanceof TextOutOfRangeError) {
      throw new UploadError(err.message, { code: err.code, status: 422 });
    }
    throw new UploadError(`extract failed: ${err?.message ?? 'unknown'}`, { code: 'EXTRACT_FAILED', status: 500 });
  }

  const tmpPath = await stageText(text);
  return { kind, tmpPath, originalName, sizeBytes: buffer.length, charsExtracted: text.length };
}

/**
 * Stage already-validated text into a tmp file and return the absolute path.
 * Public so the JSON-text path in the route can also use it.
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function stageText(text) {
  const dir = getOnboardingTmpDir();
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}.txt`;
  const tmpPath = path.join(dir, filename);
  await writeFile(tmpPath, text, 'utf-8');
  return tmpPath;
}

/**
 * Classify by extension + mime. Returns 'pdf' | 'docx' | 'text' | null.
 *
 * Strategy:
 *   1. If the file has a recognized extension, accept that extension's
 *      bucket. Mime is informational only at this point.
 *   2. If the file has NO recognized extension, fall back to mime - but
 *      only for the strong mimes (application/pdf, the wordprocessingml
 *      one, or text/*). We do NOT accept application/octet-stream as a
 *      mime-only signal because browsers send that for arbitrary binaries.
 */
function classify(ext, mime) {
  if (ext) {
    for (const [k, spec] of Object.entries(ALLOWED)) {
      if (spec.ext.includes(ext)) return k;
    }
    // Recognized extension bucket only - if ext is set but unknown,
    // refuse rather than mime-sniffing.
    return null;
  }
  // No extension: mime sniff against strong mimes only.
  if (!mime) return null;
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (mime.startsWith('text/')) return 'text';
  return null;
}

// ---------------------------------------------------------------------------
// Validation block (offline; multipart is exercised in the smoke tests)
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = [];
  let totalTests = 0;

  // Test 1: classify('.pdf', 'application/pdf') === 'pdf'
  totalTests += 1;
  if (classify('.pdf', 'application/pdf') !== 'pdf') failures.push('classify .pdf');

  // Test 2: classify('.docx', '...wordprocessingml.document') === 'docx'
  totalTests += 1;
  if (classify('.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') !== 'docx') failures.push('classify .docx');

  // Test 3: classify('.txt', '') === 'text'
  totalTests += 1;
  if (classify('.txt', '') !== 'text') failures.push('classify .txt');

  // Test 4: classify('.exe', 'application/octet-stream') === null
  totalTests += 1;
  if (classify('.exe', 'application/octet-stream') !== null) failures.push('classify .exe should be null');

  // Test 5: stageText writes a file and returns its path.
  totalTests += 1;
  const p = await stageText('hello world ' + 'x'.repeat(300));
  const fs = await import('node:fs/promises');
  try {
    const txt = await fs.readFile(p, 'utf-8');
    if (!txt.startsWith('hello world')) failures.push(`stageText content mismatch: ${txt.slice(0, 30)}`);
    await fs.unlink(p);
  } catch (err) {
    failures.push(`stageText readback failed: ${err.message}`);
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
