// lib/keymap.ts - central keyboard shortcut registry.
//
// Every component that needs to bind a key does so through this registry
// so the help overlay and command palette can introspect the full set.

import { useEffect } from 'react';

/**
 * Single-source-of-truth flag set by OnboardingGate while the modal is
 * mounted. Global shortcuts read it through `isOnboardingActive()` and
 * gate their `when` predicate so the user can't fire ⌘K, `c`, `s`, etc.
 * during a non-dismissable setup. Kept as a module-level scalar (not
 * Context) so it's also reachable from non-React callers.
 */
let onboardingActiveFlag = false;
const onboardingFlagSubs = new Set<() => void>();

export function setOnboardingActive(active: boolean): void {
  if (onboardingActiveFlag === active) return;
  onboardingActiveFlag = active;
  onboardingFlagSubs.forEach((fn) => fn());
}

export function isOnboardingActive(): boolean {
  return onboardingActiveFlag;
}

/**
 * Subscribe to onboarding-active transitions. Used by hook consumers that
 * need to re-render when the flag flips. Returns an unsubscribe.
 */
export function subscribeOnboardingActive(fn: () => void): () => void {
  onboardingFlagSubs.add(fn);
  return () => onboardingFlagSubs.delete(fn);
}

/**
 * React hook: reactively read the onboarding-active flag. Useful inside
 * components that already render conditional UI based on it.
 */
import { useSyncExternalStore } from 'react';
export function useOnboardingActive(): boolean {
  return useSyncExternalStore(
    subscribeOnboardingActive,
    isOnboardingActive,
    isOnboardingActive,
  );
}

export interface Shortcut {
  /** Stable id for grouping (e.g., "pipeline.open-report"). */
  id: string;
  /** The key combo, e.g. "Enter", "Mod+K", "Shift+P". */
  combo: string;
  /** Grouping label in the help overlay. */
  group: string;
  /** Human label. */
  label: string;
  /** Called when combo matches. */
  run: (e: KeyboardEvent) => void;
  /** Only fires when this predicate is true. */
  when?: () => boolean;
}

const active = new Map<string, Shortcut>();

function comboMatches(combo: string, e: KeyboardEvent) {
  const parts = combo.split('+').map((p) => p.trim().toLowerCase());
  const mod = parts.includes('mod');
  const shift = parts.includes('shift');
  const alt = parts.includes('alt');
  const ctrl = parts.includes('ctrl');
  const last = parts[parts.length - 1];

  // Required modifiers must be pressed.
  if (mod && !(e.metaKey || e.ctrlKey)) return false;
  if (!mod && shift && !e.shiftKey) return false;
  if (!mod && ctrl && !e.ctrlKey) return false;
  if (!mod && alt && !e.altKey) return false;

  // Modifiers NOT named in the combo must NOT be pressed. Without these
  // checks, a combo like `c` (status picker) fires on Cmd+C — the browser
  // copies AND the app shortcut runs. Same trap for `s` vs Cmd+S, `v` vs
  // Cmd+V, `r` vs Cmd+R. Single-key shortcuts now only fire on plain key
  // presses; modifier-prefixed shortcuts must declare their modifiers.
  if (!mod && (e.metaKey || e.ctrlKey)) return false;
  if (!alt && e.altKey) return false;

  const key = (e.key ?? '').toLowerCase();
  return key === last;
}

export function useShortcut(s: Shortcut | null | false | undefined) {
  useEffect(() => {
    if (!s) return;
    active.set(s.id, s);
    return () => {
      active.delete(s.id);
    };
  }, [s]);
}

export function listShortcuts(): Shortcut[] {
  return Array.from(active.values());
}

export function bindGlobalKeydown() {
  const handler = (e: KeyboardEvent) => {
    // Ignore repeats and keys fired inside inputs, unless explicitly Meta/Ctrl.
    if (e.repeat) return;
    // While onboarding is active, every shortcut registered through the
    // global registry (palette, refresh, etc.) is silenced. The modal owns
    // its own keymap and stops propagation for keys it cares about.
    if (onboardingActiveFlag) return;
    const target = e.target as HTMLElement | null;
    const inField =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable);
    for (const s of active.values()) {
      if (s.when && !s.when()) continue;
      if (!comboMatches(s.combo, e)) continue;
      // When in a text field, only fire if the combo uses Mod/Ctrl.
      if (inField && !/mod|ctrl/i.test(s.combo)) continue;
      e.preventDefault();
      s.run(e);
      break;
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
