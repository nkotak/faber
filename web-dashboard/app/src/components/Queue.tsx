// Queue.tsx - the pending-URLs queue view (TUI's QUEUE tab).
// Each item has a button to spawn an eval job.
// Toolbar at the top hosts cleanup actions (dead URLs, region mismatches).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PendingJob, PendingLiveness } from '../lib/types';
import { CleanupActions } from './Queue/CleanupActions';
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
        <CleanupActions />
        <div className="queue__empty-body">
          <p className="eyebrow">Queue is clear</p>
          <p>
            Nothing pending. When you add URLs to <code>data/pipeline.md</code>,
            they appear here.
          </p>
        </div>
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
      <CleanupActions />
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
                  <div className="queue__item-meta">
                    <a
                      className="queue__item-url mono"
                      href={p.url.startsWith('local:') ? '#' : p.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {p.url}
                    </a>
                    {p.location ? (
                      <LocationPill location={p.location} />
                    ) : null}
                    {p.liveness ? (
                      <LivenessBadge liveness={p.liveness} />
                    ) : null}
                  </div>
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

interface LocationPillProps {
  location: string;
}

/** Compact pill rendering a job's location string. Color hints whether the
 * location is "remote-ish" (contains "remote") so a quick scan of the queue
 * tells you which jobs are remote vs onsite without reading the text. */
function LocationPill({ location }: LocationPillProps) {
  const lower = location.toLowerCase();
  const remoteish = /\bremote\b|\banywhere\b|\bdistributed\b/.test(lower);
  return (
    <span
      className={`queue__item-loc ${remoteish ? 'queue__item-loc--remote' : ''}`}
      title={`Location: ${location}`}
    >
      {location}
    </span>
  );
}

interface LivenessBadgeProps {
  liveness: PendingLiveness;
}

/** Liveness badge: "checked Nd ago" with a status dot. Sourced from
 * data/liveness-cache.tsv (written by cleanup-dead-jobs.mjs). Absent for rows
 * that haven't been swept yet — so the badge appears progressively as the
 * cleanup runs accumulate.
 *
 * Tone is subdued by default; only `tentative` (1st strike) and `uncertain`
 * draw attention so users can prioritize re-checking those rows. */
function LivenessBadge({ liveness }: LivenessBadgeProps) {
  const ageDays = daysSince(liveness.lastChecked);
  const ageLabel = formatAge(ageDays);

  // Tier classification:
  //   - active                              → "ok"     (subdued ✓)
  //   - expired + 1 fail                    → "tentative" (orange)
  //   - expired + 2+ fails                  → "dead"   (red — but the row
  //                                                    should already be gone)
  //   - uncertain                           → "uncertain" (yellow)
  const tier = (() => {
    if (liveness.lastResult === 'active') return 'ok';
    if (liveness.lastResult === 'uncertain') return 'uncertain';
    if (liveness.consecutiveFailures >= 2) return 'dead';
    return 'tentative';
  })();

  const label = {
    ok: 'live',
    tentative: 'flaky',
    dead: 'dead',
    uncertain: 'uncertain',
  }[tier];

  const reason = {
    ok: `Verified active ${ageLabel}.`,
    tentative: `One liveness check failed (${ageLabel}). Will be marked dead on the next failure.`,
    dead: `Two consecutive liveness failures — should already be removed.`,
    uncertain: `Last check was inconclusive (${ageLabel}). Re-run cleanup to retry.`,
  }[tier];

  return (
    <span
      className={`queue__item-liveness queue__item-liveness--${tier}`}
      title={reason}
      aria-label={reason}
    >
      <span className="queue__item-liveness-dot" aria-hidden="true" />
      <span className="queue__item-liveness-label">
        {label} · {ageLabel}
      </span>
    </span>
  );
}

function daysSince(yyyyMmDd: string): number {
  if (!yyyyMmDd) return Number.POSITIVE_INFINITY;
  const t = Date.parse(yyyyMmDd);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  const ms = Date.now() - t;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function formatAge(days: number): string {
  if (!Number.isFinite(days)) return 'never';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
