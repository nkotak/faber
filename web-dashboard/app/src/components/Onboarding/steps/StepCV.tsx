// StepCV.tsx -- step 1: import resume → preview → commit cv.md.
//
// Lifecycle: idle → uploading → parsing → preview → committed (or error).
//
// In `parsing` mode we listen to SSE `job:update` events filtered to the
// returned parseJobId so the inline chip streams the same vocabulary the
// onboard-cv skill prints to stdout (`reading input`, `parsing N roles`,
// `writing cv-imported.md`, `done: N roles, M skills`). On success we
// fetch the staged content via /api/reports?path=cv-imported.md (the
// existing report-reader route also serves staged onboarding files; the
// backend agent confirmed this in the plan).

import { useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type { Job } from '../../../lib/types';
import { subscribeToEvents } from '../../../lib/events';
import { ResumeUploader } from '../inputs/ResumeUploader';
import { ResumePreview } from '../inputs/ResumePreview';
import type { Action, OnboardingState } from '../lib/types';
import './StepCV.css';

interface Props {
  state: OnboardingState;
  dispatch: Dispatch<Action>;
  onCommitted: () => void;
}

export function StepCV({ state, dispatch, onCommitted }: Props) {
  const cv = state.cv;
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);
  const resumedRef = useRef(false);

  // Resume-from-disconnect: if the previous session left a cv-imported.md
  // staged on disk and we land in idle phase locally, fetch it and jump
  // straight to preview. Otherwise the user would re-upload thinking their
  // resume parsing was lost. Runs ONCE per mount.
  useEffect(() => {
    if (resumedRef.current) return;
    if (cv.phase !== 'idle') return;
    if (!state.status?.staging?.cvImportedExists) return;
    resumedRef.current = true;
    api
      .report('cv-imported.md')
      .then((res) => {
        dispatch({
          type: 'CV_PREVIEW',
          content: res.content,
          bytes: res.content.length,
        });
      })
      .catch(() => {
        // staged path was reported by the server but the file vanished —
        // fall through to idle so the user can re-upload. No error toast;
        // this only happens in race conditions.
        resumedRef.current = false;
      });
  }, [cv.phase, state.status, dispatch]);

  // Tick a 0.5s timer while parsing so the chip shows MM:SS like JobTray.
  useEffect(() => {
    if (cv.phase !== 'parsing' && cv.phase !== 'uploading') {
      setElapsed(0);
      return;
    }
    if (startRef.current === 0) startRef.current = Date.now();
    const t = setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 500);
    return () => clearInterval(t);
  }, [cv.phase]);

  // Listen to SSE for our job's progress lines. We only react to events
  // tagged with our parseJobId so siblings in the dashboard's job list
  // can't interfere.
  useEffect(() => {
    if (!cv.parseJobId) return;
    const unsubscribe = subscribeToEvents((ev) => {
      if (ev.type !== 'job') return;
      if (ev.event === 'remove') return;
      const j = ev.job as Job;
      if (j.id !== cv.parseJobId) return;
      if (j.progressLine && j.progressLine !== cv.progressLine) {
        dispatch({ type: 'CV_PROGRESS', line: j.progressLine });
      }
      if (j.status === 'succeeded') {
        // job done — fetch staged content. The /api/reports route accepts
        // any project-relative path, so we point it at cv-imported.md.
        api
          .report('cv-imported.md')
          .then((res) => {
            // backend agent: please include `metadata.profileSeed` in the
            // job's terminal payload so we can hydrate step 2 here. Until
            // then we hydrate from /api/onboarding/status which the file
            // watcher invalidates anyway.
            dispatch({
              type: 'CV_PREVIEW',
              content: res.content,
              bytes: res.content.length,
            });
          })
          .catch((err) => {
            dispatch({
              type: 'CV_ERROR',
              message: 'job succeeded but staged file unreadable',
              hint: String(err),
            });
          });
      } else if (j.status === 'failed') {
        const msg = j.errorText || 'parse failed';
        const hint = msg.toLowerCase().includes('enoent')
          ? 'install: https://docs.claude.com/cli'
          : msg.toLowerCase().includes('image')
            ? 'most résumé PDFs are scans · paste the text yourself below'
            : '';
        dispatch({ type: 'CV_ERROR', message: msg, hint });
      }
    });
    return unsubscribe;
  }, [cv.parseJobId, cv.progressLine, dispatch]);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.parseResumeUpload(file),
    onMutate: () => dispatch({ type: 'CV_UPLOADING' }),
    onSuccess: ({ job }) => dispatch({ type: 'CV_PARSING', jobId: job.id }),
    onError: (err) => {
      const msg = (err as Error).message || 'upload failed';
      const lower = msg.toLowerCase();
      const hint = lower.includes('413')
        ? 'file is too large · max 10 MB'
        : lower.includes('415')
          ? 'unsupported format · use pdf, docx, txt, or md'
          : lower.includes('422')
            ? 'most résumé PDFs are scans · paste the text yourself below'
            : lower.includes('409')
              ? 'another import is already running · wait for it to finish'
              : '';
      dispatch({ type: 'CV_ERROR', message: msg, hint });
    },
  });

  const pasteMutation = useMutation({
    mutationFn: (text: string) => api.parseResumeText(text),
    onMutate: () => dispatch({ type: 'CV_UPLOADING' }),
    onSuccess: ({ job }) => dispatch({ type: 'CV_PARSING', jobId: job.id }),
    onError: (err) =>
      dispatch({
        type: 'CV_ERROR',
        message: (err as Error).message || 'paste failed',
      }),
  });

  const commitMutation = useMutation({
    mutationFn: () => api.commitCv(cv.editedContent ?? undefined),
    onSuccess: () => {
      dispatch({ type: 'CV_COMMITTED' });
      onCommitted();
    },
    onError: (err) =>
      dispatch({
        type: 'CV_ERROR',
        message: (err as Error).message || 'commit failed',
      }),
  });

  const isBusy =
    cv.phase === 'uploading' || cv.phase === 'parsing' || commitMutation.isPending;

  return (
    <div className="onb-step-cv">
      {(cv.phase === 'uploading' || cv.phase === 'parsing') && (
        <ProgressChip
          progress={cv.progressLine || (cv.phase === 'uploading' ? 'uploading' : 'queued')}
          elapsed={elapsed}
        />
      )}

      {cv.phase === 'idle' || cv.phase === 'uploading' || cv.phase === 'parsing' ? (
        <ResumeUploader
          disabled={isBusy}
          pastedText={cv.pastedText}
          onPastedTextChange={(text) => dispatch({ type: 'CV_PASTED', text })}
          onFile={(file) => uploadMutation.mutate(file)}
          onSubmitText={() => pasteMutation.mutate(cv.pastedText)}
        />
      ) : null}

      {cv.phase === 'preview' || cv.phase === 'committed' ? (
        <>
          <ResumePreview
            staged={cv.stagedContent}
            edited={cv.editedContent}
            onEditedChange={(edited) => dispatch({ type: 'CV_EDITED', edited })}
            mode={cv.previewMode}
            onModeChange={(mode) => dispatch({ type: 'CV_PREVIEW_MODE', mode })}
          />
          <div className="onb-uploader__paste-actions">
            <span className="onb-help">
              # cv-imported.md · {Math.round(cv.stagedBytes / 100) / 10} kb
            </span>
            <div className="onb-preview__actions">
              <button
                type="button"
                className="onb-btn"
                onClick={() => dispatch({ type: 'CV_RESET' })}
                disabled={commitMutation.isPending}
              >
                start over
              </button>
              <button
                type="button"
                className="onb-btn onb-btn--primary"
                onClick={() => commitMutation.mutate()}
                disabled={commitMutation.isPending || cv.phase === 'committed'}
              >
                {cv.phase === 'committed'
                  ? 'committed'
                  : commitMutation.isPending
                    ? 'committing…'
                    : 'commit · write cv.md'}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {cv.phase === 'error' ? (
        <div className="onb-cv-error" role="alert">
          <span className="onb-cv-error__msg"># {cv.errorMessage}</span>
          {cv.errorHint ? (
            <span className="onb-cv-error__hint">tip · {cv.errorHint}</span>
          ) : null}
          <div>
            <button
              type="button"
              className="onb-btn"
              onClick={() => dispatch({ type: 'CV_RESET' })}
            >
              try again
            </button>
          </div>
          {/* keep the textarea visible so paste fallback still works */}
          <ResumeUploader
            disabled={false}
            pastedText={cv.pastedText}
            onPastedTextChange={(text) => dispatch({ type: 'CV_PASTED', text })}
            onFile={(file) => uploadMutation.mutate(file)}
            onSubmitText={() => pasteMutation.mutate(cv.pastedText)}
          />
        </div>
      ) : null}
    </div>
  );
}

function ProgressChip({ progress, elapsed }: { progress: string; elapsed: number }) {
  const secs = Math.floor(elapsed / 1000);
  const time = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(
    secs % 60,
  ).padStart(2, '0')}`;
  return (
    <div className="onb-cv-progress" role="status" aria-live="polite">
      <span className="onb-cv-progress__spin" aria-hidden />
      <span className="onb-cv-progress__kind">CV-EXTRACT</span>
      <span className="onb-cv-progress__sep">·</span>
      <span className="onb-cv-progress__progress">{progress}</span>
      <span className="onb-cv-progress__sep">·</span>
      <span className="onb-cv-progress__time tabular">{time}</span>
    </div>
  );
}
