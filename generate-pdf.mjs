#!/usr/bin/env node

/**
 * generate-pdf.mjs — HTML → PDF via Playwright
 *
 * Usage:
 *   node faber/generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4] [--margin=0.4in]
 *
 * Requires: @playwright/test (or playwright) installed.
 * Uses Chromium headless to render the HTML and produce a clean, ATS-parseable PDF.
 *
 * Default behavior: auto-fits the output to 1 page by walking a ladder of
 * layout levers (margins → font-size → spacing), preserving content. Only
 * reports back to the caller if every layout lever is exhausted — the caller
 * (usually Claude running modes/pdf.md) then decides whether to drop a
 * low-weighted bullet and retry. Passing --margin=<X> opts out of the ladder
 * and does a single-shot render at the requested margin.
 */

import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Auto-fit ladder — each rung is attempted in order; the first that lands
 * on 1 page is the final output. Margins tighten first (content-preserving,
 * no visual cost), then body font-size drops, then section/line-height
 * tightens. See modes/pdf.md Stage 7 "Auto-fit ladder" for the spec.
 *
 * Each rung's `css` is injected into a tagged <style> element in the document
 * head, replacing the previous rung's style. Using !important because the
 * template's specificity is moderate and we want the overrides to always win.
 */
const AUTO_FIT_LADDER = [
  { stage: 'margin-0.6',        margin: '0.6in',  css: '' },
  { stage: 'margin-0.5',        margin: '0.5in',  css: '' },
  { stage: 'margin-0.4',        margin: '0.4in',  css: '' },
  { stage: 'margin-0.3',        margin: '0.3in',  css: '' },
  { stage: 'margin-0.25',       margin: '0.25in', css: '' },
  {
    stage: 'font-10.5',
    margin: '0.25in',
    css: `
      body { font-size: 10.5px !important; }
      .summary-text { font-size: 10.5px !important; }
      .job li { font-size: 10px !important; }
      .skill-item, .skill-category { font-size: 10px !important; }
      .project-desc { font-size: 10px !important; }
    `,
  },
  {
    stage: 'font-10',
    margin: '0.25in',
    css: `
      body { font-size: 10px !important; }
      .summary-text { font-size: 10px !important; }
      .job li { font-size: 9.5px !important; }
      .skill-item, .skill-category { font-size: 9.5px !important; }
      .project-desc { font-size: 9.5px !important; }
      .header h1 { font-size: 24px !important; }
    `,
  },
  {
    stage: 'spacing-tight',
    margin: '0.25in',
    css: `
      body { font-size: 10px !important; line-height: 1.4 !important; }
      .summary-text { font-size: 10px !important; line-height: 1.5 !important; }
      .job li { font-size: 9.5px !important; line-height: 1.45 !important; margin-bottom: 2px !important; }
      .skill-item, .skill-category { font-size: 9.5px !important; }
      .project-desc { font-size: 9.5px !important; line-height: 1.4 !important; }
      .header h1 { font-size: 24px !important; }
      .section { margin-bottom: 14px !important; }
      .job { margin-bottom: 10px !important; }
      .header { margin-bottom: 14px !important; }
    `,
  },
  {
    stage: 'spacing-tightest',
    margin: '0.25in',
    css: `
      body { font-size: 10px !important; line-height: 1.35 !important; }
      .summary-text { font-size: 10px !important; line-height: 1.45 !important; }
      .job li { font-size: 9.5px !important; line-height: 1.35 !important; margin-bottom: 2px !important; }
      .skill-item, .skill-category { font-size: 9.5px !important; }
      .project-desc { font-size: 9.5px !important; line-height: 1.35 !important; }
      .header h1 { font-size: 22px !important; }
      .section { margin-bottom: 12px !important; }
      .job { margin-bottom: 8px !important; }
      .header { margin-bottom: 10px !important; }
      .section-title { margin-bottom: 6px !important; }
    `,
  },
];

/**
 * Normalize text for ATS compatibility by converting problematic Unicode.
 *
 * ATS parsers and legacy systems often fail on em-dashes, smart quotes,
 * zero-width characters, and non-breaking spaces. These cause mojibake,
 * parsing errors, or display issues. See issue #1.
 *
 * Only touches body text — preserves CSS, JS, tag attributes, and URLs.
 * Returns { html, replacements } so the caller can log what was changed.
 */
function normalizeTextForATS(html) {
  const replacements = {};
  const bump = (key, n) => { replacements[key] = (replacements[key] || 0) + n; };

  const masks = [];
  const masked = html.replace(
    /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi,
    (match) => {
      const token = `\u0000MASK${masks.length}\u0000`;
      masks.push(match);
      return token;
    }
  );

  let out = '';
  let i = 0;
  while (i < masked.length) {
    const lt = masked.indexOf('<', i);
    if (lt === -1) { out += sanitizeText(masked.slice(i)); break; }
    out += sanitizeText(masked.slice(i, lt));
    const gt = masked.indexOf('>', lt);
    if (gt === -1) { out += masked.slice(lt); break; }
    out += masked.slice(lt, gt + 1);
    i = gt + 1;
  }

  const restored = out.replace(/\u0000MASK(\d+)\u0000/g, (_, n) => masks[Number(n)]);
  return { html: restored, replacements };

  function sanitizeText(text) {
    if (!text) return text;
    let t = text;
    t = t.replace(/\u2014/g, () => { bump('em-dash', 1); return '-'; });
    t = t.replace(/\u2013/g, () => { bump('en-dash', 1); return '-'; });
    t = t.replace(/[\u201C\u201D\u201E\u201F]/g, () => { bump('smart-double-quote', 1); return '"'; });
    t = t.replace(/[\u2018\u2019\u201A\u201B]/g, () => { bump('smart-single-quote', 1); return "'"; });
    t = t.replace(/\u2026/g, () => { bump('ellipsis', 1); return '...'; });
    t = t.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, () => { bump('zero-width', 1); return ''; });
    t = t.replace(/\u00A0/g, () => { bump('nbsp', 1); return ' '; });
    return t;
  }
}

/**
 * Render a single attempt: swap the auto-fit style, render PDF, count pages.
 * Reuses the browser page across attempts for speed.
 */
async function renderAttempt(page, { margin, css }, format) {
  // Swap the auto-fit <style> element: remove old, add new.
  await page.evaluate((cssText) => {
    const prev = document.getElementById('__faber_autofit__');
    if (prev) prev.remove();
    if (cssText) {
      const style = document.createElement('style');
      style.id = '__faber_autofit__';
      style.textContent = cssText;
      document.head.appendChild(style);
    }
  }, css);

  const pdfBuffer = await page.pdf({
    format,
    printBackground: true,
    margin: { top: margin, right: margin, bottom: margin, left: margin },
    preferCSSPageSize: false,
  });

  const pdfString = pdfBuffer.toString('latin1');
  const pageCount = (pdfString.match(/\/Type\s*\/Page[^s]/g) || []).length;

  return { pdfBuffer, pageCount };
}

/**
 * Render an HTML file to PDF with auto-fit to 1 page.
 *
 * When `margin` is null (default), walks the AUTO_FIT_LADDER and returns the
 * first rung that fits on 1 page — or the last rung's output with a warning
 * if every rung produces >1 page. When `margin` is an explicit string (e.g.
 * "0.4in"), skips the ladder and does a single-shot render — this is the
 * escape hatch for callers who need a specific margin.
 *
 * Returned `fitStage` tells the caller which rung produced the final PDF.
 * Callers (modes/pdf.md) use `pageCount` and `fitStage` to decide whether
 * to drop a low-weighted bullet and retry (Stage 4 of the auto-fit ladder
 * lives in the caller, not in this script).
 *
 * @param {Object} opts
 * @param {string} opts.inputPath  Absolute or relative path to HTML
 * @param {string} opts.outputPath Absolute or relative path for PDF output
 * @param {string} [opts.format]   "letter" or "a4" (default: "a4")
 * @param {string|null} [opts.margin] Explicit margin like "0.4in" to skip auto-fit; null/omit for ladder
 * @param {boolean} [opts.quiet]   If true, suppress stdout logs
 * @returns {Promise<{outputPath: string, pageCount: number, size: number, fitStage: string, laddersTried: number}>}
 */
export async function renderHtmlToPdf({ inputPath, outputPath, format = 'a4', margin = null, quiet = false }) {
  inputPath = resolve(inputPath);
  outputPath = resolve(outputPath);

  // Validate format
  const validFormats = ['a4', 'letter'];
  if (!validFormats.includes(format)) {
    throw new Error(`Invalid format "${format}". Use: ${validFormats.join(', ')}`);
  }

  const log = quiet ? () => {} : (...args) => console.log(...args);

  log(`📄 Input:  ${inputPath}`);
  log(`📁 Output: ${outputPath}`);
  log(`📏 Format: ${format.toUpperCase()}`);

  // Read HTML to inject font paths as absolute file:// URLs
  let html = await readFile(inputPath, 'utf-8');

  // Resolve font paths relative to faber/fonts/
  const fontsDir = resolve(__dirname, 'fonts');
  html = html.replace(
    /url\(['"]?\.\/fonts\//g,
    `url('file://${fontsDir}/`
  );
  html = html.replace(
    /file:\/\/([^'")]+)\.woff2['"]\)/g,
    `file://$1.woff2')`
  );

  // Normalize text for ATS compatibility (issue #1)
  const normalized = normalizeTextForATS(html);
  html = normalized.html;
  const totalReplacements = Object.values(normalized.replacements).reduce((a, b) => a + b, 0);
  if (totalReplacements > 0) {
    const breakdown = Object.entries(normalized.replacements).map(([k, v]) => `${k}=${v}`).join(', ');
    log(`🧹 ATS normalization: ${totalReplacements} replacements (${breakdown})`);
  }

  // Decide attempts: explicit margin = single shot, otherwise = auto-fit ladder
  const attempts = margin !== null
    ? [{ stage: `explicit-${margin}`, margin, css: '' }]
    : AUTO_FIT_LADDER;

  log(`🪜 Auto-fit: ${attempts.length} rung${attempts.length === 1 ? '' : 's'} (${attempts[0].margin} … ${attempts[attempts.length - 1].margin})`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setContent(html, {
    waitUntil: 'networkidle',
    baseURL: `file://${dirname(inputPath)}/`,
  });
  await page.evaluate(() => document.fonts.ready);

  let result = null;
  let laddersTried = 0;
  for (const attempt of attempts) {
    laddersTried++;
    const { pdfBuffer, pageCount } = await renderAttempt(page, attempt, format);
    log(`   ${laddersTried}. ${attempt.stage} (margin=${attempt.margin}) → ${pageCount} page${pageCount === 1 ? '' : 's'}`);
    result = { pdfBuffer, pageCount, attempt };
    if (pageCount <= 1) break;
  }

  await browser.close();

  const { writeFile } = await import('fs/promises');
  await writeFile(outputPath, result.pdfBuffer);

  log(`✅ PDF generated: ${outputPath}`);
  log(`📊 Pages: ${result.pageCount}`);
  log(`📦 Size: ${(result.pdfBuffer.length / 1024).toFixed(1)} KB`);
  log(`🎯 Settled at: ${result.attempt.stage} (margin=${result.attempt.margin})`);

  if (result.pageCount > 1) {
    log(`⚠️  Could not fit to 1 page even at ${result.attempt.stage}. Caller should drop lowest-weighted bullet and retry (modes/pdf.md Stage 7 step 4).`);
  }

  return {
    outputPath,
    pageCount: result.pageCount,
    size: result.pdfBuffer.length,
    fitStage: result.attempt.stage,
    laddersTried,
  };
}

// =============================================================================
// CLI entrypoint — only runs when invoked directly, not when imported
// =============================================================================

const isMain = import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const args = process.argv.slice(2);
  let inputPath, outputPath, format = 'a4', margin = null;

  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      format = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--margin=')) {
      margin = arg.split('=')[1];
    } else if (!inputPath) {
      inputPath = arg;
    } else if (!outputPath) {
      outputPath = arg;
    }
  }

  if (!inputPath || !outputPath) {
    console.error('Usage: node generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4] [--margin=0.4in]');
    console.error('  Omit --margin to enable auto-fit ladder (default, 1-page target).');
    console.error('  Pass --margin=X.Xin for a single-shot render at a specific margin.');
    process.exit(1);
  }

  renderHtmlToPdf({ inputPath, outputPath, format, margin })
    .then((r) => {
      // Non-zero exit code if we couldn't fit to 1 page, so batch scripts can detect.
      if (r.pageCount > 1) process.exitCode = 2;
    })
    .catch((err) => {
      console.error('❌ PDF generation failed:', err.message);
      process.exit(1);
    });
}
