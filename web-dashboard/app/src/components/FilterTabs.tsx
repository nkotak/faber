// FilterTabs.tsx - row of filter tabs with a magnetic underline that
// springs to the active tab. Keyboard: ArrowLeft/ArrowRight cycle.
//
// Zero-count noise reduction: filters with no applications tracked are
// hidden by default, except the core set (all / top / evaluated / queue)
// which are always relevant as pipeline surfaces. This keeps the strip
// short enough that "Queue" stops getting cut off on narrow sidebars.
// Counts update live, so a filter re-appears the moment it gains a row.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FilterTab } from '../lib/types';
import { useShortcut } from '../lib/keymap';
import './FilterTabs.css';

const TABS: Array<{ id: FilterTab; label: string; desc?: string }> = [
  { id: 'all', label: 'All' },
  { id: 'top', label: 'Top fit', desc: 'Score ≥ 4.0' },
  { id: 'evaluated', label: 'Evaluated' },
  { id: 'applied', label: 'Applied' },
  { id: 'interview', label: 'Interview' },
  { id: 'skip', label: 'Skip' },
  { id: 'queue', label: 'Queue' },
];

/** Always rendered, regardless of count. These are the anchor filters. */
const CORE_TABS: ReadonlySet<FilterTab> = new Set<FilterTab>(['all', 'top', 'evaluated', 'queue']);

interface Props {
  current: FilterTab;
  onChange: (f: FilterTab) => void;
  counts: Record<string, number>;
  pendingCount: number;
  total: number;
}

export function FilterTabs({ current, onChange, counts, pendingCount, total }: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [bar, setBar] = useState({ left: 0, width: 0 });

  // Drop zero-count filters that aren't in the core set. If the user has
  // the current filter active but its count goes to zero, keep it visible
  // so the UI isn't ripped out from under them.
  const visibleTabs = useMemo(() => {
    return TABS.filter((t) => {
      if (CORE_TABS.has(t.id)) return true;
      if (t.id === current) return true;
      const c = t.id === 'queue' ? pendingCount : countFor(t.id, counts, total);
      return c > 0;
    });
  }, [counts, pendingCount, total, current]);

  // Reposition the underline when the active tab or the window width changes.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLButtonElement>(`button[data-active="true"]`);
    if (!active) return;
    const parentBox = list.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    setBar({ left: box.left - parentBox.left, width: box.width });
  }, [current, total, visibleTabs]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const ro = new ResizeObserver(() => {
      const active = list.querySelector<HTMLButtonElement>(`button[data-active="true"]`);
      if (!active) return;
      const parentBox = list.getBoundingClientRect();
      const box = active.getBoundingClientRect();
      setBar({ left: box.left - parentBox.left, width: box.width });
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, []);

  // Keyboard navigation - Left/Right cycles tabs like the TUI. We cycle
  // through the visible tabs so arrow keys never land on a hidden filter.
  useShortcut({
    id: 'tabs.prev',
    combo: 'ArrowLeft',
    group: 'Pipeline',
    label: 'Previous tab',
    run: () => {
      if (visibleTabs.length === 0) return;
      const i = visibleTabs.findIndex((t) => t.id === current);
      const next = i === -1 ? 0 : (i + visibleTabs.length - 1) % visibleTabs.length;
      onChange(visibleTabs[next].id);
    },
  });
  useShortcut({
    id: 'tabs.next',
    combo: 'ArrowRight',
    group: 'Pipeline',
    label: 'Next tab',
    run: () => {
      if (visibleTabs.length === 0) return;
      const i = visibleTabs.findIndex((t) => t.id === current);
      const next = i === -1 ? 0 : (i + 1) % visibleTabs.length;
      onChange(visibleTabs[next].id);
    },
  });

  return (
    <div className="tabs" ref={listRef}>
      {visibleTabs.map((t) => {
        const count = t.id === 'queue' ? pendingCount : countFor(t.id, counts, total);
        const isActive = current === t.id;
        return (
          <button
            key={t.id}
            className="tabs__item"
            data-active={isActive}
            onClick={() => onChange(t.id)}
            aria-pressed={isActive}
            title={t.desc ?? t.label}
          >
            <span className="tabs__item-label">{t.label}</span>
            <span className="tabs__item-count mono tabular">{count}</span>
          </button>
        );
      })}
      <span
        className="tabs__bar"
        aria-hidden="true"
        style={{ transform: `translateX(${bar.left}px)`, width: bar.width }}
      />
    </div>
  );
}

function countFor(id: FilterTab, counts: Record<string, number>, total: number): number {
  switch (id) {
    case 'all':
      return total;
    case 'top':
      return Object.entries(counts).reduce((sum, [k, v]) => (k !== 'skip' ? sum + v : sum), 0);
    default:
      return counts[id] ?? 0;
  }
}
