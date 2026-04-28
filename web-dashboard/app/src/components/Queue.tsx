// Queue.tsx - the pending-URLs queue view (TUI's QUEUE tab).
// Each item has a button to spawn an eval job.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PendingJob } from '../lib/types';
import './Queue.css';

interface Props {
  items: PendingJob[];
}

export function PendingQueue({ items }: Props) {
  const qc = useQueryClient();
  const evalMutation = useMutation({
    mutationFn: (url: string) => api.startEvalJob(url),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });

  if (items.length === 0) {
    return (
      <div className="queue queue--empty">
        <p className="eyebrow">Queue is clear</p>
        <p>Nothing pending. When you add URLs to <code>data/pipeline.md</code>, they appear here.</p>
      </div>
    );
  }

  // Group by section header (e.g. "Scanned 2026-04-20").
  const bySection = new Map<string, PendingJob[]>();
  for (const it of items) {
    const s = it.section || 'Uncategorized';
    const list = bySection.get(s) ?? [];
    list.push(it);
    bySection.set(s, list);
  }

  return (
    <div className="queue">
      {[...bySection.entries()].map(([section, list]) => (
        <section className="queue__section" key={section}>
          <header className="queue__section-head">
            <span className="eyebrow">{section}</span>
            <span className="queue__section-count mono tabular">{list.length}</span>
          </header>
          <ul className="queue__list">
            {list.map((p) => (
              <li className="queue__item" key={`${p.url}-${p.lineNumber}`}>
                <div className="queue__item-main">
                  <span className="queue__item-company">{p.company || '—'}</span>
                  <span className="queue__item-role">{p.role || p.url}</span>
                  <a className="queue__item-url mono" href={p.url.startsWith('local:') ? '#' : p.url} target="_blank" rel="noreferrer">
                    {p.url}
                  </a>
                </div>
                <button
                  className="queue__eval mono"
                  onClick={() => evalMutation.mutate(p.url)}
                >
                  evaluate ↗
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
