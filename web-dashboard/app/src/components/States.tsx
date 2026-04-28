// States.tsx - loading / empty / error states.

import './States.css';

interface Props {
  kind: 'loading' | 'empty' | 'error';
  message?: string;
}

export function EmptyOrLoading({ kind, message }: Props) {
  if (kind === 'loading') {
    return (
      <div className="state">
        <span className="state__bars mono" aria-hidden>
          <span /><span /><span /><span /><span /><span />
        </span>
        <p className="eyebrow">Reading tracker</p>
      </div>
    );
  }
  if (kind === 'error') {
    return (
      <div className="state state--error">
        <p className="eyebrow">Something's off</p>
        <pre className="state__err mono">{message ?? 'Unknown error.'}</pre>
        <p className="state__hint">
          Make sure the faber-web server is running and can read{' '}
          <code className="mono">data/applications.md</code>.
        </p>
      </div>
    );
  }
  return (
    <div className="state">
      <p className="eyebrow">Nothing here yet</p>
      <p className="state__hint">
        Either no applications match this filter, or your tracker is empty. Add an entry to{' '}
        <code className="mono">data/applications.md</code> and it will appear.
      </p>
    </div>
  );
}
