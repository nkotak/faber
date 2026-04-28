// OnboardingGate.tsx -- mounts in main.tsx, wraps <App />.
//
// One useQuery (['onboarding','status']) decides whether to mount the
// modal. While loading we show a tiny boot splash; on error we render a
// retry button instead of the modal so the user isn't stuck. The gate
// always renders {children} so the dashboard mounts behind the modal
// (blurred); when setup completes the modal unmounts via View Transition
// and the dashboard takes focus.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { setOnboardingActive } from '../../lib/keymap';
import { OnboardingModal } from './OnboardingModal';
import './OnboardingModal.css';

interface Props {
  children: ReactNode;
}

export function OnboardingGate({ children }: Props) {
  const qc = useQueryClient();
  // Mirror the modal's mounted state into the global flag so global
  // shortcuts (⌘K, c, s, …) can suppress themselves.
  const [modalShown, setModalShown] = useState(false);

  const statusQuery = useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn: api.onboardingStatus,
    refetchOnWindowFocus: false,
    // Stop polling once setup is complete; the dashboard's other queries
    // take over and we don't want a stale modal flicker on subsequent
    // status fetches.
    refetchInterval: (q) =>
      q.state.data && q.state.data.setupComplete ? false : 30_000,
  });

  // Sync the active flag with whether the modal is mounted.
  useEffect(() => {
    setOnboardingActive(modalShown);
    return () => setOnboardingActive(false);
  }, [modalShown]);

  const onComplete = () => {
    // Mark the modal as down before the next query lands so the global
    // shortcuts stop being suppressed instantly. Then refetch status
    // so the gate's authoritative answer is fresh.
    setModalShown(false);
    qc.invalidateQueries({ queryKey: ['onboarding', 'status'] });
    qc.invalidateQueries({ queryKey: ['pipeline'] });
  };

  // Decide what to render based on query state. We always render children
  // (the dashboard) so the file watcher / SSE bootstrap continues to fire;
  // the modal is mounted on top when applicable.
  const shouldShowModal = !!(
    statusQuery.data && !statusQuery.data.setupComplete
  );

  // Sync modalShown after render to avoid the "setState during render" warning.
  useEffect(() => {
    setModalShown(shouldShowModal);
  }, [shouldShowModal]);

  let overlay: ReactNode = null;
  if (statusQuery.isLoading) {
    overlay = <BootSplash />;
  } else if (statusQuery.isError) {
    overlay = (
      <BootError
        message={String(statusQuery.error)}
        onRetry={() => statusQuery.refetch()}
      />
    );
  } else if (shouldShowModal) {
    overlay = (
      <OnboardingModal status={statusQuery.data!} onComplete={onComplete} />
    );
  }

  return (
    <>
      {children}
      {overlay}
    </>
  );
}

function BootSplash() {
  return (
    <div className="onb-boot" role="status" aria-live="polite">
      <div className="onb-boot__inner">
        <span className="onb-boot__bars" aria-hidden>
          <span /><span /><span /><span /><span /><span />
        </span>
        <p className="eyebrow">checking setup</p>
      </div>
    </div>
  );
}

function BootError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="onb-boot" role="alert">
      <div className="onb-boot__inner">
        <p className="eyebrow">cant reach the server</p>
        <pre className="onb-boot__err">{message}</pre>
        <p className="onb-help">
          # is faber-web running · npm run dev:server
        </p>
        <button type="button" className="onb-boot__retry" onClick={onRetry}>
          retry
        </button>
      </div>
    </div>
  );
}
