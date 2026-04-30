// CleanupActions.tsx -- toolbar buttons + confirm modal for the queue.
//
// Offers two cleanup operations:
//   1. Cleanup dead URLs   → runs cleanup-dead-jobs.mjs (two-strikes liveness)
//   2. Cleanup region      → runs cleanup-region-mismatch.mjs (filter mismatch)
//
// Flow per click:
//   click button → modal opens → POST /api/cleanup/{kind} with dryRun:true →
//   subscribe to SSE for job id → render live progressLine →
//   when job ends, show "Apply" + "Close" → if Apply, POST again with
//   dryRun:false and repeat the SSE flow → final "Done" state → Close.
//
// React Query is invalidated on apply success so the queue and applications
// table reflect the new state without a manual reload.

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useJob } from '../../lib/hooks/useJob';
import type { Job } from '../../lib/types';
import './CleanupActions.css';

type CleanupKind = 'dead' | 'region';

/** Modal state machine. We render different chrome per stage. */
type Stage =
  | { phase: 'idle' }
  | { phase: 'previewing'; jobId: string }
  | { phase: 'reviewing'; jobId: string }
  | { phase: 'applying'; jobId: string }
  | { phase: 'done'; outcome: 'succeeded' | 'failed' | 'cancelled'; line: string };

const KIND_LABEL: Record<CleanupKind, { title: string; subtitle: string; help: string }> = {
  dead: {
    title: 'Cleanup dead URLs',
    subtitle: 'two-strikes liveness sweep',
    help:
      'Visits each tracked URL with Playwright. A URL must fail in two consecutive runs before it flips to Discarded — so this is safe to re-run.',
  },
  region: {
    title: 'Cleanup region mismatches',
    subtitle: 'apply current location filter',
    help:
      'Drops pipeline rows whose location doesn\'t match `config/profile.yml` location_filter. Evaluated apps get marked Discarded with a note. Mismatches are preserved in a `## Discarded — region` section for audit.',
  },
};

export function CleanupActions() {
  const [openKind, setOpenKind] = useState<CleanupKind | null>(null);

  return (
    <>
      <div className="cleanup-actions">
        <span className="cleanup-actions__label eyebrow">cleanup</span>
        <button
          type="button"
          className="cleanup-actions__btn"
          onClick={() => setOpenKind('dead')}
          title={KIND_LABEL.dead.help}
        >
          dead URLs
        </button>
        <button
          type="button"
          className="cleanup-actions__btn"
          onClick={() => setOpenKind('region')}
          title={KIND_LABEL.region.help}
        >
          region mismatches
        </button>
      </div>
      {openKind ? (
        <CleanupModal kind={openKind} onClose={() => setOpenKind(null)} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface ModalProps {
  kind: CleanupKind;
  onClose: () => void;
}

function CleanupModal({ kind, onClose }: ModalProps) {
  const qc = useQueryClient();
  const labels = KIND_LABEL[kind];
  const [stage, setStage] = useState<Stage>({ phase: 'idle' });

  const startMutation = useMutation({
    mutationFn: ({ dryRun }: { dryRun: boolean }) =>
      kind === 'dead'
        ? api.startCleanupDead({ dryRun })
        : api.startCleanupRegion({ dryRun }),
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setStage({ phase: 'done', outcome: 'failed', line: message });
    },
  });

  // On mount: either re-attach to an existing cleanup of this kind (running
  // OR recently finished with proposed changes), or kick off a fresh dry-run.
  //
  // The cleanup status endpoint returns the most-recent job per kind, kept
  // alive for 10 minutes after success so the user can close the modal mid-
  // run, come back later, and still see the apply button for a finished
  // dry-run. Branches:
  //   running             → previewing (latch onto live progress)
  //   succeeded + exit 2  → reviewing  (proposed changes pending; show apply)
  //   anything else       → spawn a fresh dry-run
  //
  // React 18 StrictMode invokes mount effects twice in dev. The ref guard
  // keeps us from spawning two dry-runs in the spawn-fresh branch — the
  // re-attach branches are naturally idempotent (latching to the same id).
  const dryRunStartedRef = useRef(false);
  useEffect(() => {
    if (stage.phase !== 'idle') return;

    let cancelled = false;
    (async () => {
      try {
        const status = await api.cleanupStatus();
        const recent = kind === 'dead' ? status.deadJob : status.regionJob;
        if (recent) {
          // Still running → re-attach for live progress.
          if (recent.status === 'running' || recent.status === 'cancelling') {
            if (!cancelled) setStage({ phase: 'previewing', jobId: recent.id });
            return;
          }
          // Finished dry-run with proposed changes → re-attach in reviewing
          // stage so the user can apply.
          if (recent.status === 'succeeded' && recent.exitCode === 2) {
            if (!cancelled) setStage({ phase: 'reviewing', jobId: recent.id });
            return;
          }
          // Otherwise (succeeded with exit 0, failed, cancelled): fall through
          // to spawn a fresh dry-run. The previous result is either applied
          // or no-op, so a new run is the right next step.
        }

        // Spawn a fresh dry-run. Guarded against StrictMode double-fire.
        if (dryRunStartedRef.current) return;
        dryRunStartedRef.current = true;
        const job = await startMutation.mutateAsync({ dryRun: true });
        if (!cancelled) setStage({ phase: 'previewing', jobId: job.id });
      } catch {
        // onError handler already moved us to 'done'
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to the active job's events.
  const activeJobId =
    stage.phase === 'previewing' || stage.phase === 'applying'
      ? stage.jobId
      : null;
  const { job, removed } = useJob(activeJobId);

  // Drive transitions when the active job ends.
  useEffect(() => {
    if (!job) return;
    if (stage.phase === 'previewing' && isTerminal(job)) {
      if (job.status === 'succeeded') {
        setStage({ phase: 'reviewing', jobId: job.id });
      } else {
        setStage({
          phase: 'done',
          outcome: job.status === 'failed' ? 'failed' : 'cancelled',
          line: job.errorText || job.progressLine || 'Job ended',
        });
      }
      return;
    }
    if (stage.phase === 'applying' && isTerminal(job)) {
      setStage({
        phase: 'done',
        outcome:
          job.status === 'succeeded'
            ? 'succeeded'
            : job.status === 'failed'
              ? 'failed'
              : 'cancelled',
        line:
          job.status === 'succeeded'
            ? 'Cleanup applied successfully.'
            : (job.errorText || 'Job ended'),
      });
      // Refresh pipeline + applications so the UI reflects the new state.
      if (job.status === 'succeeded') {
        qc.invalidateQueries({ queryKey: ['pipeline'] });
        qc.invalidateQueries({ queryKey: ['settings', 'profile'] });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, stage.phase]);

  // SSE 'remove' fires after the toast TTL. If we hit it before reaching a
  // terminal local state, fall through to a generic 'done'.
  useEffect(() => {
    if (!removed) return;
    setStage((prev) => {
      if (prev.phase === 'done') return prev;
      return {
        phase: 'done',
        outcome: 'succeeded',
        line: 'Job finished and was reaped before we observed the terminal event.',
      };
    });
  }, [removed]);

  const apply = async () => {
    try {
      const next = await startMutation.mutateAsync({ dryRun: false });
      setStage({ phase: 'applying', jobId: next.id });
    } catch {
      // onError already moved us to 'done' with the failure line
    }
  };

  // ---------- chrome ----------

  const lineLive =
    job?.progressLine && (stage.phase === 'previewing' || stage.phase === 'applying')
      ? job.progressLine
      : null;

  // Closing the modal mid-run does NOT cancel the subprocess — the JobManager
  // owns the lifecycle and exposes it via /api/cleanup/status. On reopen, the
  // mount effect re-attaches to the active job. So backdrop/Esc/× are always
  // safe to close, even mid-run.
  const isRunning = stage.phase === 'previewing' || stage.phase === 'applying';
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    onClose();
  };

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="cleanup-modal__backdrop"
      role="presentation"
      onClick={handleBackdropClick}
    >
      <div
        className="cleanup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cleanup-modal-title"
      >
        <header className="cleanup-modal__head">
          <span className="eyebrow">{labels.subtitle}</span>
          <h2 id="cleanup-modal-title" className="cleanup-modal__title">
            {labels.title}
          </h2>
          <button
            type="button"
            className="cleanup-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <p className="cleanup-modal__help">{labels.help}</p>

        <div className="cleanup-modal__body">
          <StageBadge stage={stage} />
          {lineLive ? (
            <pre className="cleanup-modal__progress" aria-live="polite">
              {lineLive}
            </pre>
          ) : null}
          {isRunning ? (
            <p className="cleanup-modal__hint">
              Long-running cleanups (300+ URLs through Playwright) can take
              several minutes. <strong>Close this modal any time</strong> — the
              job continues in the background. Reopen it to see live progress
              and the apply button when the dry-run finishes.
            </p>
          ) : null}
          {stage.phase === 'reviewing' ? (
            <p className="cleanup-modal__hint">
              Dry run complete. No files were changed. Click <strong>apply</strong>{' '}
              to re-run and write changes (with <code>.bak</code> backups).
            </p>
          ) : null}
          {stage.phase === 'done' ? (
            <pre className="cleanup-modal__progress" aria-live="polite">
              {stage.line}
            </pre>
          ) : null}
        </div>

        <footer className="cleanup-modal__foot">
          {stage.phase === 'reviewing' ? (
            <>
              <button
                type="button"
                className="cleanup-modal__btn"
                onClick={onClose}
              >
                cancel
              </button>
              <button
                type="button"
                className="cleanup-modal__btn cleanup-modal__btn--primary"
                onClick={apply}
              >
                apply
              </button>
            </>
          ) : stage.phase === 'done' ? (
            <button
              type="button"
              className="cleanup-modal__btn"
              onClick={onClose}
            >
              close
            </button>
          ) : (
            <button
              type="button"
              className="cleanup-modal__btn"
              onClick={onClose}
            >
              close · keep running
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTerminal(j: Job) {
  return j.status === 'succeeded' || j.status === 'failed' || j.status === 'cancelled';
}

interface StageBadgeProps {
  stage: Stage;
}

function StageBadge({ stage }: StageBadgeProps) {
  const dotClass = (() => {
    if (stage.phase === 'idle' || stage.phase === 'previewing' || stage.phase === 'applying') {
      return 'cleanup-modal__dot cleanup-modal__dot--running';
    }
    if (stage.phase === 'reviewing') {
      return 'cleanup-modal__dot cleanup-modal__dot--review';
    }
    if (stage.phase === 'done') {
      return stage.outcome === 'succeeded'
        ? 'cleanup-modal__dot cleanup-modal__dot--ok'
        : 'cleanup-modal__dot cleanup-modal__dot--fail';
    }
    return 'cleanup-modal__dot';
  })();

  const label = (() => {
    switch (stage.phase) {
      case 'idle':
        return 'starting…';
      case 'previewing':
        return 'dry run in progress';
      case 'reviewing':
        return 'dry run complete';
      case 'applying':
        return 'applying changes';
      case 'done':
        return stage.outcome === 'succeeded'
          ? 'done'
          : stage.outcome === 'failed'
            ? 'failed'
            : 'cancelled';
    }
  })();

  return (
    <div className="cleanup-modal__stage" aria-live="polite">
      <span className={dotClass} aria-hidden="true" />
      <span className="cleanup-modal__stage-text mono">{label}</span>
    </div>
  );
}
