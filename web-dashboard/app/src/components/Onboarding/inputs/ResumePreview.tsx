// ResumePreview.tsx -- markdown preview with [rendered | raw | split] toggle.
//
// Reuses the markdown-it + DOMPurify recipe from DetailPane.tsx:17 so the
// rendering shape is identical to the report viewer (links open in new tabs
// after sanitization, html=false). The "edit text" textarea below the
// preview lets the user tune the LLM output before commit; that string
// flows up via onEditedChange and gets sent to /commit-cv as editedContent.
//
// SECURITY: The HTML emitted by markdown-it is sanitized with DOMPurify
// before being inserted via dangerouslySetInnerHTML. We use the same exact
// pattern as DetailPane.tsx (markdown-it html:false, DOMPurify with the
// html profile, ADD_ATTR for target/rel only). Without DOMPurify we would
// be vulnerable to XSS via crafted resume content; with it, the surface is
// equivalent to what DetailPane already trusts.

import { useMemo } from 'react';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import type { StepCvPreviewMode } from '../lib/types';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

function renderMarkdown(raw: string): string {
  const rendered = md.render(raw);
  const safe = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
  return typeof safe === 'string' ? safe : String(safe);
}

interface Props {
  staged: string;
  edited: string | null;
  onEditedChange: (value: string) => void;
  mode: StepCvPreviewMode;
  onModeChange: (mode: StepCvPreviewMode) => void;
}

export function ResumePreview({
  staged,
  edited,
  onEditedChange,
  mode,
  onModeChange,
}: Props) {
  const source = edited ?? staged;
  const html = useMemo(() => renderMarkdown(source), [source]);

  return (
    <div className="onb-preview">
      <div className="onb-preview__bar" role="tablist" aria-label="Preview mode">
        {(['rendered', 'raw', 'split'] as StepCvPreviewMode[]).map((m) => (
          <button
            type="button"
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={`onb-preview__tab${
              mode === m ? ' onb-preview__tab--active' : ''
            }`}
            onClick={() => onModeChange(m)}
          >
            {m}
          </button>
        ))}
        <span className="onb-preview__bar-hint mono">
          {edited && edited !== staged ? 'edited locally · saved on commit' : 'staged'}
        </span>
      </div>

      <div className={`onb-preview__body onb-preview__body--${mode}`}>
        {mode !== 'raw' ? (
          <div
            className="prose onb-preview__rendered"
            // DOMPurify-sanitized markdown — same recipe as DetailPane.tsx.
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : null}
        {mode !== 'rendered' ? (
          <textarea
            className="onb-textarea onb-textarea--mono onb-preview__raw"
            value={source}
            onChange={(e) => onEditedChange(e.target.value)}
            spellCheck={false}
            aria-label="Edit imported CV markdown before commit"
          />
        ) : null}
      </div>
    </div>
  );
}
