// StepReady.tsx -- step 5: file summary, three keyboard hints, open dashboard.
//
// The "Open dashboard" button doesn't fire any new write — it just dispatches
// the COMPLETE action, the gate sees setupComplete via the next /status
// poll, and the modal unmounts via View Transition. No exclamation points,
// no confetti.

import { useMutation } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type { OnboardingStatus } from '../../../lib/types';
import './StepReady.css';

interface Props {
  status: OnboardingStatus | null;
  /** if true, /init-tracker hasn't run yet — we offer to do it on this step */
  initTrackerNeeded: boolean;
  onComplete: () => void;
}

export function StepReady({ status, initTrackerNeeded, onComplete }: Props) {
  const initMutation = useMutation({
    mutationFn: () => api.initTracker(),
  });

  // Show files from the server's status response.
  const files = (status?.required ?? []).concat(status?.optional ?? []);

  const onOpen = async () => {
    if (initTrackerNeeded) {
      try {
        await initMutation.mutateAsync();
      } catch {
        // Non-fatal: tracker can be created later. Still proceed.
      }
    }
    onComplete();
  };

  return (
    <div className="onb-step-ready">
      <ul className="onb-step-ready__files" aria-label="Files written">
        {files.length === 0 ? (
          <li className="onb-step-ready__file">
            <span className="onb-step-ready__file-name">awaiting first commit</span>
            <span className="onb-step-ready__file-size">—</span>
          </li>
        ) : (
          files.map((f) => (
            <li className="onb-step-ready__file" key={f.path}>
              <span className="onb-step-ready__file-name">{f.path}</span>
              <span className="onb-step-ready__file-size">
                {f.bytes ? formatBytes(f.bytes) : '—'}
              </span>
            </li>
          ))
        )}
      </ul>

      <div className="onb-step-ready__divider" aria-hidden>
        <span>three things to know</span>
      </div>

      <ul className="onb-step-ready__hints">
        <li className="onb-step-ready__hint-key">⌘K</li>
        <li className="onb-step-ready__hint-desc">
          command palette ·{' '}
          <span className="onb-step-ready__hint-desc-emph">jump to any company</span>
        </li>
        <li className="onb-step-ready__hint-key">c</li>
        <li className="onb-step-ready__hint-desc">
          change a row's status ·{' '}
          <span className="onb-step-ready__hint-desc-emph">applied → interview</span>
        </li>
        <li className="onb-step-ready__hint-key">r</li>
        <li className="onb-step-ready__hint-desc">
          manual refresh ·{' '}
          <span className="onb-step-ready__hint-desc-emph">force re-read tracker</span>
        </li>
      </ul>

      <div className="onb-step-ready__cta">
        <button
          type="button"
          className="onb-btn onb-btn--primary"
          onClick={onOpen}
          disabled={initMutation.isPending}
        >
          {initMutation.isPending ? 'finalizing…' : 'open dashboard →'}
        </button>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}
