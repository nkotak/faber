// PaneCV.tsx -- raw markdown editor for cv.md.
//
// edit | preview toggle. The edit textarea reuses the .onb-textarea--mono
// class from OnboardingForms.css so it matches the StepCV edit panel.
// Preview goes through the shared DOMPurify-sanitized renderer in
// lib/markdown.ts.
//
// Save flow: POST /api/onboarding/commit-cv with `editedContent`. The
// existing endpoint backs up any prior cv.md to cv.md.bak-<ts> before
// overwriting; the response includes backupPath which we surface
// transiently in the save bar context (handled by SettingsView via the
// success callback).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type { CommitCvResponse, SettingsPaneId } from '../../../lib/types';
import { renderMarkdownToHtml } from '../../../lib/markdown';
import { useDirty } from '../lib/useDirty';
import { SETTINGS_SAVE_EVENT } from '../SettingsView';
import './PaneCV.css';

interface Props {
  onDirtyChange: (pane: SettingsPaneId, isDirty: boolean) => void;
  onValidChange: (pane: SettingsPaneId, isValid: boolean) => void;
  onSaveSuccess: (pane: SettingsPaneId) => void;
  onSaveError: (pane: SettingsPaneId, message: string) => void;
}

type Mode = 'edit' | 'preview';

const REQUIRED_H2S = ['## CORE SKILLS', '## CAREER HIGHLIGHTS', '## EDUCATION'] as const;

export function PaneCV({
  onDirtyChange,
  onValidChange,
  onSaveSuccess,
  onSaveError,
}: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('edit');
  const [edited, setEdited] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverMissing, setServerMissing] = useState<string[]>([]);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const backupTimerRef = useRef<number | null>(null);

  const cvQuery = useQuery({
    queryKey: ['settings', 'cv'],
    queryFn: () => api.loadCv(),
  });

  const initialContent = cvQuery.data?.content ?? '';
  const currentContent = edited ?? initialContent;

  const { isDirty } = useDirty(initialContent, edited === null ? initialContent : edited);

  useEffect(() => {
    onDirtyChange('cv', isDirty);
  }, [isDirty, onDirtyChange]);

  // Validity: backend is the source of truth, but we surface a soft hint
  // when one of the required H2 sections is absent. Save itself is never
  // gated on this — backend will return 422 if the shape is wrong.
  useEffect(() => {
    onValidChange('cv', true);
  }, [onValidChange]);

  const missingHeaders = useMemo(() => {
    if (!currentContent) return [] as string[];
    const upper = currentContent.toUpperCase();
    return REQUIRED_H2S.filter((h) => !upper.includes(h));
  }, [currentContent]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () => api.commitCv(edited ?? undefined),
    onSuccess: (res: CommitCvResponse) => {
      setEdited(null);
      setServerError(null);
      setServerMissing([]);
      onSaveSuccess('cv');
      qc.invalidateQueries({ queryKey: ['settings', 'cv'] });
      qc.invalidateQueries({ queryKey: ['onboarding', 'status'] });
      if (res.backupPath) {
        const tail = res.backupPath.split('/').pop() ?? res.backupPath;
        setBackupNotice(`# saved · prior cv.md backed up to ${tail}`);
        if (backupTimerRef.current) window.clearTimeout(backupTimerRef.current);
        backupTimerRef.current = window.setTimeout(() => {
          setBackupNotice(null);
        }, 4000);
      }
    },
    onError: (err: unknown) => {
      const message = parseError(err);
      // Try to recover the missing-sections list if the server returned 422.
      const missing = parseMissingHeaders(err);
      setServerError(message);
      setServerMissing(missing);
      onSaveError('cv', message);
    },
  });

  // Listen for save dispatch from SettingsView.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pane: SettingsPaneId }>).detail;
      if (detail?.pane !== 'cv') return;
      saveMutation.mutate();
    };
    document.addEventListener(SETTINGS_SAVE_EVENT, handler);
    return () => document.removeEventListener(SETTINGS_SAVE_EVENT, handler);
  }, [saveMutation]);

  // Listen for discard dispatch.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pane: SettingsPaneId }>).detail;
      if (detail?.pane !== 'cv') return;
      setEdited(null);
      setServerError(null);
      setServerMissing([]);
    };
    document.addEventListener('settings:discard-current-pane', handler);
    return () =>
      document.removeEventListener('settings:discard-current-pane', handler);
  }, []);

  useEffect(() => {
    return () => {
      if (backupTimerRef.current) window.clearTimeout(backupTimerRef.current);
    };
  }, []);

  // The preview HTML is produced by renderMarkdownToHtml which routes the
  // string through DOMPurify (USE_PROFILES.html). Output is safe for
  // dangerouslySetInnerHTML — same recipe as DetailPane and ResumePreview.
  const previewHtml = useMemo(() => renderMarkdownToHtml(currentContent), [currentContent]);

  if (cvQuery.isLoading) {
    return <p className="settings__placeholder">Reading cv.md</p>;
  }
  if (cvQuery.isError) {
    return (
      <p className="settings__placeholder settings__placeholder--error">
        # could not load cv.md · {String(cvQuery.error)}
      </p>
    );
  }

  return (
    <div className="pane-cv">
      <div className="pane-cv__bar" role="tablist" aria-label="Edit mode">
        {(['edit', 'preview'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`pane-cv__tab${mode === m ? ' pane-cv__tab--active' : ''}`}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
        {backupNotice ? (
          <span className="pane-cv__backup-notice">{backupNotice}</span>
        ) : null}
      </div>

      {missingHeaders.length > 0 ? (
        <p className="settings-hint">
          # heads-up · this CV is missing {missingHeaders.join(', ')}
        </p>
      ) : null}

      {serverError ? (
        <p className="settings-error" role="alert">
          # write failed · {serverError}
          {serverMissing.length > 0 ? (
            <>
              {' '}
              · missing {serverMissing.join(', ')}
            </>
          ) : null}
        </p>
      ) : null}

      <div className="pane-cv__body">
        {mode === 'edit' ? (
          <textarea
            className="onb-textarea onb-textarea--mono pane-cv__textarea"
            value={currentContent}
            onChange={(e) => setEdited(e.target.value)}
            spellCheck={false}
            aria-label="cv.md markdown source"
          />
        ) : (
          <PreviewRender html={previewHtml} />
        )}
      </div>
    </div>
  );
}

/** Render the sanitized markdown HTML. The input MUST be the output of
 * renderMarkdownToHtml so it's already DOMPurify-cleaned. */
function PreviewRender({ html }: { html: string }) {
  // eslint-disable-next-line react/no-danger -- input flows through DOMPurify in lib/markdown.ts
  return <article className="prose pane-cv__preview settings-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

function parseError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Parse a 422 response body that includes `missing: [...]`. The api helper
 * surfaces the response text wholesale via Error.message; we look for a
 * JSON tail within it. Best-effort. */
function parseMissingHeaders(err: unknown): string[] {
  if (!(err instanceof Error)) return [];
  const m = err.message.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed: unknown = JSON.parse(m[0]);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'missing' in parsed &&
      Array.isArray((parsed as { missing: unknown }).missing)
    ) {
      const missing = (parsed as { missing: unknown[] }).missing;
      return missing.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    // ignore
  }
  return [];
}
