// JobTray.tsx - bottom bar with live job chips. Each chip animates in with
// spring-like physics, streams its progress label, then fades out after
// its toast window expires (server-managed).
//
// Cleanup-* chips have an extra mode: when a dry-run succeeds with proposed
// changes (exitCode === 2), the chip surfaces an inline `apply` button so the
// user can apply without reopening the modal. While running, a 1-pixel
// progress bar at the bottom of the chip shows tier-2 progress parsed from
// the script's `[N/T]` stderr lines.

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Job } from '../lib/types';
import './JobTray.css';

interface Props {
  jobs: Job[];
}

export function JobTray({ jobs }: Props) {
  const qc = useQueryClient();
  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.cancelJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });

  return (
    <footer className="tray" aria-label="active jobs">
      <span className="tray__label eyebrow">Jobs</span>
      <ul className="tray__list">
        {jobs.length === 0 ? (
          <li className="tray__empty mono">idle</li>
        ) : (
          jobs.map((j) => (
            <JobChip key={j.id} job={j} onCancel={() => cancelMutation.mutate(j.id)} />
          ))
        )}
      </ul>
    </footer>
  );
}

function JobChip({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - job.startedAt);

  useEffect(() => {
    if (job.status !== 'running' && job.status !== 'cancelling') return;
    const t = setInterval(() => setElapsed(Date.now() - job.startedAt), 500);
    return () => clearInterval(t);
  }, [job.startedAt, job.status]);

  const isCleanup = job.kind === 'cleanup-dead' || job.kind === 'cleanup-region';
  const awaitingApply =
    isCleanup && job.status === 'succeeded' && job.exitCode === 2;
  const progress = parseProgress(job.progressLine);

  const glyph = awaitingApply ? '⚑' : statusGlyph(job.status);
  const kindLabel =
    job.kind === 'interview-prep' ? 'PREP' : job.kind.toUpperCase();
  const secs = Math.floor(elapsed / 1000);
  const timeStr = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

  // Derived display label: server-set label is frozen at spawn-time. Override
  // it for the awaiting-apply state so the chip clearly reads "apply" instead
  // of stale "dry-run" text.
  const displayLabel = awaitingApply
    ? job.label.replace(/dry-run/i, 'apply').replace(/·\s*$/, '').trim()
    : job.label;

  // Show progress bar while the job is running — determinate when we have
  // [N/T], indeterminate sweep before the first match arrives.
  const showProgressBar = job.status === 'running' || job.status === 'cancelling';

  const chipClass = [
    'chip',
    `chip--${job.status}`,
    'mono',
    awaitingApply ? 'chip--awaiting-apply' : '',
    showProgressBar ? 'chip--has-progress' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={chipClass}>
      <div className="chip__row">
        <span className={`chip__glyph chip__glyph--${awaitingApply ? 'awaiting' : job.status}`}>
          {glyph}
        </span>
        <span className="chip__kind">{kindLabel}</span>
        <span className="chip__sep">·</span>
        <span className="chip__label">{displayLabel}</span>

        {(job.status === 'running' || job.status === 'cancelling') && (
          <>
            <span className="chip__sep">·</span>
            <span className="chip__progress">{job.progressLine || 'working…'}</span>
            <span className="chip__sep">·</span>
            <span className="chip__time tabular">{timeStr}</span>
            <button className="chip__cancel" onClick={onCancel} aria-label="cancel job">
              ×
            </button>
          </>
        )}

        {awaitingApply && (
          <>
            <span className="chip__sep">·</span>
            <CleanupApplyButton job={job} />
          </>
        )}

        {job.status === 'failed' && job.errorText && (
          <>
            <span className="chip__sep">·</span>
            <span className="chip__error">{job.errorText}</span>
          </>
        )}
      </div>

      {showProgressBar ? (
        <ProgressBar
          ratio={progress?.ratio ?? null}
          label={progress ? `${progress.done} of ${progress.total}` : 'in progress'}
        />
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Cleanup apply button — only renders for cleanup-dead / cleanup-region chips
// in the awaiting-apply state. Calls the same endpoint the modal's apply does.
// ---------------------------------------------------------------------------

function CleanupApplyButton({ job }: { job: Job }) {
  const qc = useQueryClient();
  const [handedOff, setHandedOff] = useState(false);
  const applyMutation = useMutation({
    mutationFn: () =>
      job.kind === 'cleanup-dead'
        ? api.startCleanupDead({ dryRun: false })
        : api.startCleanupRegion({ dryRun: false }),
    onSuccess: () => {
      // The apply job now exists as a separate chip with its own progress
      // bar. Hand off — collapse this chip's button so the user can't fire
      // a duplicate apply (server would 409).
      setHandedOff(true);
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  if (handedOff) {
    return <span className="chip__handed-off">→ applying</span>;
  }

  return (
    <button
      type="button"
      className="chip__apply"
      onClick={() => applyMutation.mutate()}
      disabled={applyMutation.isPending}
      aria-label={`apply ${job.kind} changes`}
    >
      {applyMutation.isPending ? 'applying…' : 'apply'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Progress bar — hairline at the bottom of the chip. Determinate when we can
// parse [N/T] from the progress line, indeterminate sweep otherwise.
// ---------------------------------------------------------------------------

interface ProgressBarProps {
  ratio: number | null;
  label: string;
}

function ProgressBar({ ratio, label }: ProgressBarProps) {
  const determinate = ratio !== null && ratio >= 0 && ratio <= 1;
  return (
    <div
      className={`chip__progressbar ${determinate ? '' : 'chip__progressbar--indeterminate'}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={determinate ? 1 : undefined}
      aria-valuenow={determinate ? ratio! : undefined}
    >
      <div
        className="chip__progressbar-fill"
        style={determinate ? { width: `${(ratio! * 100).toFixed(1)}%` } : undefined}
      />
    </div>
  );
}

/**
 * Parse `[N/T]` from a progress line like `✅ [12/528] https://...`. Returns
 * null if the line doesn't have a fraction (early script output, or other
 * job kinds that don't emit it).
 */
function parseProgress(line: string): { done: number; total: number; ratio: number } | null {
  if (!line) return null;
  const m = line.match(/\[(\d+)\s*\/\s*(\d+)\]/);
  if (!m) return null;
  const done = Number.parseInt(m[1], 10);
  const total = Number.parseInt(m[2], 10);
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
  return { done, total, ratio: Math.min(1, Math.max(0, done / total)) };
}

function statusGlyph(s: Job['status']) {
  switch (s) {
    case 'running':
      return <SpinnerDot />;
    case 'cancelling':
      return '⏳';
    case 'succeeded':
      return '✓';
    case 'failed':
      return '✗';
    case 'cancelled':
      return '⊘';
  }
}

function SpinnerDot() {
  return <span className="chip__spin" aria-hidden />;
}
