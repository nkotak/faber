// JobTray.tsx - bottom bar with live job chips. Each chip animates in with
// spring-like physics, streams its progress label, then fades out after
// its toast window expires (server-managed).

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

  const glyph = statusGlyph(job.status);
  const kindLabel = job.kind === 'interview-prep' ? 'PREP' : job.kind.toUpperCase();
  const secs = Math.floor(elapsed / 1000);
  const timeStr = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <li className={`chip chip--${job.status} mono`}>
      <span className={`chip__glyph chip__glyph--${job.status}`}>{glyph}</span>
      <span className="chip__kind">{kindLabel}</span>
      <span className="chip__sep">·</span>
      <span className="chip__label">{job.label}</span>
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
      {job.status === 'failed' && job.errorText && (
        <>
          <span className="chip__sep">·</span>
          <span className="chip__error">{job.errorText}</span>
        </>
      )}
    </li>
  );
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
