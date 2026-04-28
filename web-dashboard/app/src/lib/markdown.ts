// lib/markdown.ts -- DOMPurify-sanitized markdown renderer.
//
// Centralized helper so the markdown-it + DOMPurify recipe lives in one
// place. The output is HTML that has been sanitized through DOMPurify
// (USE_PROFILES.html, ADD_ATTR for target/rel only). Callers can safely
// pass the result to React's dangerous-set-inner-html prop because the
// purification has already happened here.
//
// SECURITY: identical recipe to DetailPane.tsx and ResumePreview.tsx,
// kept in sync intentionally. markdown-it is configured with html:false
// so raw HTML in the source is escaped before purification; DOMPurify is
// the second layer that strips anything markdown-it might emit from
// typographer/linkify expansions.
//
// In v1, only PaneCV consumes this helper. Refactoring DetailPane and
// ResumePreview to share it is a deliberate follow-up — they keep their
// existing local copy of the recipe to avoid scope creep here.
//
// Sample input:  '# Hello\n\nworld'
// Expected output: '<h1>Hello</h1>\n<p>world</p>\n'

import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

/**
 * Render markdown to sanitized HTML.
 *
 * @param raw markdown source
 * @returns DOMPurify-sanitized HTML ready to be inserted as React HTML
 */
export function renderMarkdownToHtml(raw: string): string {
  if (!raw) return '';
  const rendered = md.render(raw);
  const safe = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
  return typeof safe === 'string' ? safe : String(safe);
}
