// lib/theme.ts - theme management with View Transitions radial reveal.

import type { ThemePref } from './types';

const KEY = 'faber.theme';

export function readPref(): ThemePref {
  return (localStorage.getItem(KEY) as ThemePref) ?? 'light';
}

function systemResolved(): 'light' | 'dark' {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolvedTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemResolved();
}

/**
 * Swap the theme with a View Transitions radial reveal, centered on the
 * click origin. Falls back gracefully without View Transitions.
 */
export async function setTheme(
  pref: ThemePref,
  origin?: { x: number; y: number },
) {
  const next = resolvedTheme(pref);
  const root = document.documentElement;
  const apply = () => {
    root.dataset.themePref = pref;
    root.dataset.theme = next;
    localStorage.setItem(KEY, pref);
  };

  // Respect reduced-motion: no animation, just swap.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduced || !('startViewTransition' in document) || !origin) {
    apply();
    return;
  }

  // Radial reveal from (x, y) to the farthest viewport corner.
  const { x, y } = origin;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const maxRadius = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));

  const transition = (document as any).startViewTransition(() => apply());
  try {
    await transition.ready;
    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${maxRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 560,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        pseudoElement: '::view-transition-new(root)',
      },
    );
  } catch {
    // the transition may skip; nothing to rescue
  }
}

export function applyPrefNow(pref: ThemePref) {
  const root = document.documentElement;
  root.dataset.themePref = pref;
  root.dataset.theme = resolvedTheme(pref);
  localStorage.setItem(KEY, pref);
}
