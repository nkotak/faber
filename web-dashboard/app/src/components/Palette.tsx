// Palette.tsx - Cmd+K command palette.
//
// Lists applications (fuzzy-search by company / role / status), the main
// actions (cycle sort, toggle view, toggle theme, mask comp), and the
// known keybindings. Keyboard: arrow keys to move, Enter to run, Esc to
// close. Mouse: click.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Application } from '../lib/types';
import { listShortcuts, useShortcut } from '../lib/keymap';
import './Palette.css';

type Item =
  | { kind: 'app'; app: Application; score: number }
  | { kind: 'action'; id: string; label: string; hint?: string; run: () => void };

interface Props {
  open: boolean;
  onClose: () => void;
  apps: Application[];
  onNavigate: (reportNumber: string) => void;
}

export function CommandPalette({ open, onClose, apps, onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  // Global Escape closes.
  useShortcut({
    id: 'palette.close',
    combo: 'Escape',
    group: 'App',
    label: 'Close palette',
    when: () => open,
    run: onClose,
  });

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const matched: Item[] = apps
      .map((app) => ({
        app,
        score: fuzzyScore(q, `${app.company} ${app.role} ${app.canonicalStatus}`.toLowerCase()),
      }))
      .filter((r) => q === '' || r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map((r) => ({ kind: 'app' as const, app: r.app, score: r.score }));

    if (q === '') {
      const shortcuts = listShortcuts()
        .filter((s) => s.id.startsWith('app.') || s.id.startsWith('tabs.'))
        .slice(0, 8)
        .map((s) => ({
          kind: 'action' as const,
          id: s.id,
          label: s.label,
          hint: s.combo,
          run: () => {
            // fake a synthetic keyboard event so the shortcut's predicate runs
            const ev = new KeyboardEvent('keydown', { key: 'x' });
            s.run(ev);
          },
        }));
      return [...shortcuts, ...matched];
    }
    return matched;
  }, [apps, query]);

  const chosen = items[Math.min(cursor, items.length - 1)];

  if (!open) return null;

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && chosen) {
      e.preventDefault();
      if (chosen.kind === 'app') onNavigate(chosen.app.reportNumber);
      else chosen.run();
      onClose();
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Jump to company, role, or action…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={handleKey}
        />
        <ul className="palette__list" role="listbox">
          {items.length === 0 ? (
            <li className="palette__empty">No matches.</li>
          ) : (
            items.map((it, i) => {
              const isSelected = i === Math.min(cursor, items.length - 1);
              if (it.kind === 'app') {
                return (
                  <li
                    key={`app-${it.app.reportNumber}`}
                    className={`palette__item${isSelected ? ' palette__item--selected' : ''}`}
                    onMouseMove={() => setCursor(i)}
                    onClick={() => {
                      onNavigate(it.app.reportNumber);
                      onClose();
                    }}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <span className="palette__row-num mono">{it.app.reportNumber.padStart(3, '0')}</span>
                    <span className="palette__row-main">
                      <span className="palette__row-company">{it.app.company}</span>
                      <span className="palette__row-role">{it.app.role}</span>
                    </span>
                    <span className="palette__row-status mono">{it.app.canonicalStatus}</span>
                    <span className="palette__row-score mono tabular">
                      {it.app.score ? it.app.score.toFixed(1) : '—'}
                    </span>
                  </li>
                );
              }
              return (
                <li
                  key={`a-${it.id}`}
                  className={`palette__item palette__item--action${isSelected ? ' palette__item--selected' : ''}`}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => {
                    it.run();
                    onClose();
                  }}
                >
                  <span className="palette__row-num mono">act</span>
                  <span className="palette__row-main">
                    <span className="palette__row-company">{it.label}</span>
                  </span>
                  <span className="palette__row-status mono">{it.hint}</span>
                </li>
              );
            })
          )}
        </ul>
        <footer className="palette__foot mono">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="palette__foot-right">{items.length} matches</span>
        </footer>
      </div>
    </div>
  );
}

function fuzzyScore(q: string, hay: string): number {
  if (!q) return 1;
  if (hay.includes(q)) return 100 - hay.indexOf(q);
  // crude character-order match
  let qi = 0;
  let score = 0;
  for (let hi = 0; hi < hay.length && qi < q.length; hi++) {
    if (hay[hi] === q[qi]) {
      qi++;
      score += 1;
    }
  }
  if (qi < q.length) return 0;
  return score;
}
