// Settings/lib/useDirty.ts -- dirty-state hook (deep-equality via JSON).
//
// JSON.stringify is fine for our payload sizes (kilobytes, not megabytes)
// and avoids pulling in lodash. The shapes we compare are constructed
// with stable key order (controlled inside the panes), so reordering
// false-positives are not a concern.
//
// Sample input:  ({a: 1}, {a: 1}) -> isDirty=false
//                ({a: 1}, {a: 2}) -> isDirty=true

import { useMemo } from 'react';

export interface DirtyState<T> {
  isDirty: boolean;
  initial: T;
  current: T;
}

/**
 * Compute whether `current` differs from `initial`. The result is memoized
 * on the JSON projections of both inputs.
 */
export function useDirty<T>(initial: T, current: T): DirtyState<T> {
  const initialKey = useMemo(() => JSON.stringify(initial), [initial]);
  const currentKey = useMemo(() => JSON.stringify(current), [current]);
  const isDirty = initialKey !== currentKey;
  return { isDirty, initial, current };
}
