// StatusPicker.tsx - modal for changing an application's status.
//
// Invoked by pressing `c` on the focused row, or by clicking the status pill
// in the detail pane. Writes through /api/applications/:num/status which is
// atomic on the server.

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import './StatusPicker.css';

interface Props {
  open: boolean;
  reportNumber: string | null;
  current: string | null;
  options: string[];
  onClose: () => void;
}

export function StatusPicker({ open, reportNumber, current, options, onClose }: Props) {
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    const initial = Math.max(0, options.findIndex((o) => o.toLowerCase() === (current ?? '').toLowerCase()));
    setCursor(initial);
    queueMicrotask(() => rootRef.current?.focus());
  }, [open, current, options]);

  const mutate = useMutation({
    mutationFn: ({ reportNumber, status }: { reportNumber: string; status: string }) =>
      api.setStatus(reportNumber, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipeline'] }),
  });

  if (!open || !reportNumber) return null;

  const choose = (status: string) => {
    if (status.toLowerCase() !== (current ?? '').toLowerCase()) {
      mutate.mutate({ reportNumber, status });
    }
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(options[cursor]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div
        className="picker"
        ref={rootRef}
        tabIndex={-1}
        onKeyDown={onKey}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Set status"
      >
        <header className="picker__head">
          <span className="eyebrow">Set status</span>
          <span className="picker__head-id mono">row {reportNumber.padStart(3, '0')}</span>
        </header>
        <ul className="picker__list">
          {options.map((o, i) => {
            const isSelected = i === cursor;
            const isCurrent = o.toLowerCase() === (current ?? '').toLowerCase();
            return (
              <li
                key={o}
                className={`picker__item${isSelected ? ' picker__item--selected' : ''}`}
                onMouseMove={() => setCursor(i)}
                onClick={() => choose(o)}
              >
                <span className="picker__item-label">{o}</span>
                {isCurrent && <span className="picker__item-current mono">current</span>}
              </li>
            );
          })}
        </ul>
        <footer className="picker__foot mono">
          <span>↑↓ move</span>
          <span>↵ apply</span>
          <span>esc cancel</span>
        </footer>
      </div>
    </div>
  );
}
