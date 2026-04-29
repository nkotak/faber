// useJob.ts -- subscribe to SSE updates for a single job by id.
//
// The events store in lib/events.ts already emits typed `job` events for
// every spawn/update/remove the JobManager fans out. This hook narrows that
// firehose to one specific job id and returns the latest snapshot.
//
// Returns null until either the first 'update' arrives for the id, or the
// job is removed (then `removed` becomes true). Designed to be cheap to
// mount/unmount: a single Set entry per call.

import { useEffect, useState } from 'react';
import { subscribeToEvents } from '../events';
import type { Job } from '../types';

interface UseJobResult {
  job: Job | null;
  removed: boolean;
}

export function useJob(id: string | null): UseJobResult {
  const [job, setJob] = useState<Job | null>(null);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    if (!id) {
      setJob(null);
      setRemoved(false);
      return;
    }
    setRemoved(false);
    const unsubscribe = subscribeToEvents((ev) => {
      if (ev.type !== 'job') return;
      if (ev.event === 'remove' && ev.id === id) {
        setRemoved(true);
        return;
      }
      if (ev.event === 'update' && ev.job.id === id) {
        setJob(ev.job);
      }
    });
    return unsubscribe;
  }, [id]);

  return { job, removed };
}
