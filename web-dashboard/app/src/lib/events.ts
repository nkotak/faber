// lib/events.ts - SSE client that translates server events into Query
// invalidations and a live jobs store. Reconnects automatically (native
// EventSource behavior); on reconnect we do a fresh refetch to fill gaps.

import type { QueryClient } from '@tanstack/react-query';
import type { Job } from './types';

type FileEvent = {
  type: 'file';
  kind:
    | 'applications'
    | 'pipeline'
    | 'reports'
    | 'output'
    | 'interview-prep'
    | 'onboarding';
  path: string;
};

type JobEvent =
  | { type: 'job'; event: 'update'; job: Job }
  | { type: 'job'; event: 'remove'; id: string };

type Hello = { type: 'hello'; ts: number };

type ServerEvent = FileEvent | JobEvent | Hello;

const listeners = new Set<(ev: ServerEvent) => void>();

export function subscribeToEvents(fn: (ev: ServerEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startEventStream(qc: QueryClient) {
  let es: EventSource | null = null;

  const connect = () => {
    es = new EventSource('/api/events');

    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as ServerEvent;
        listeners.forEach((fn) => fn(data));

        if (data.type === 'file') {
          switch (data.kind) {
            case 'applications':
            case 'pipeline':
            case 'output':
            case 'interview-prep':
              qc.invalidateQueries({ queryKey: ['pipeline'] });
              break;
            case 'reports':
              // Report contents changed - if it's the one currently open,
              // Query will refetch on its own stale window.
              qc.invalidateQueries({ queryKey: ['report'] });
              break;
            case 'onboarding':
              // cv.md / profile.yml / _profile.md / portals.yml / cv-imported.md
              // changed on disk — re-read /api/onboarding/status so the modal
              // advances or unmounts in real time. Pipeline also refetches
              // because the new files unlock parsers downstream.
              qc.invalidateQueries({ queryKey: ['onboarding', 'status'] });
              qc.invalidateQueries({ queryKey: ['pipeline'] });
              break;
          }
        }
      } catch {
        // malformed event; ignore
      }
    };

    es.onerror = () => {
      // EventSource reconnects on its own; just trigger a refetch to fill
      // any gap since last successful event.
      qc.invalidateQueries({ queryKey: ['pipeline'] });
    };
  };

  connect();

  // No cleanup: this runs for the lifetime of the page.
}
