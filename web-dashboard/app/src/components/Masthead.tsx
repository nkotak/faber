// Masthead.tsx - the top header. FABER wordmark + operational stats +
// theme toggle + palette launcher. This is the first thing people see,
// so every pixel is considered.

import { useEffect, useState } from 'react';
import { readPref, setTheme } from '../lib/theme';
import type { ThemePref } from '../lib/types';
import './Masthead.css';

interface Props {
  total: number;
  withPDF: number;
  avgScore: number;
  topScore: number;
  onOpenPalette: () => void;
  maskComp: boolean;
  onToggleMask: () => void;
  focus: boolean;
  onToggleFocus: () => void;
  settingsActive: boolean;
  onOpenSettings: () => void;
}

export function Masthead(p: Props) {
  const [pref, setPref] = useState<ThemePref>(() => readPref());
  const [clock, setClock] = useState(() => fmtClock(new Date()));

  useEffect(() => {
    const t = setInterval(() => setClock(fmtClock(new Date())), 1000);
    return () => clearInterval(t);
  }, []);

  const cyclePref = (e: React.MouseEvent) => {
    const nextPref: ThemePref = pref === 'auto' ? 'light' : pref === 'light' ? 'dark' : 'auto';
    setPref(nextPref);
    setTheme(nextPref, { x: e.clientX, y: e.clientY });
  };

  return (
    <header className="masthead">
      <div className="masthead__brand">
        <span className="masthead__wordmark display">Faber</span>
        <span className="masthead__rule" aria-hidden="true" />
        <span className="masthead__tagline mono">operational board</span>
      </div>

      <div className="masthead__stats mono">
        <Stat label="tracked" value={String(p.total).padStart(3, '0')} />
        <Stat label="pdf" value={`${p.withPDF}/${p.total}`} />
        <Stat label="avg" value={p.avgScore ? p.avgScore.toFixed(2) : '—'} />
        <Stat label="top" value={p.topScore ? p.topScore.toFixed(1) : '—'} accent />
        <Stat label="clock" value={clock} />
      </div>

      <div className="masthead__actions">
        <button
          className="masthead__btn mono"
          onClick={p.onToggleFocus}
          aria-pressed={p.focus}
          title={p.focus ? 'Exit focus mode (⌘.)' : 'Enter focus mode (⌘.)'}
        >
          <span>{p.focus ? '◱' : '◰'}</span>
          <span className="masthead__btn-label">{p.focus ? 'split' : 'focus'}</span>
        </button>
        <button
          className="masthead__btn mono"
          onClick={p.onToggleMask}
          aria-pressed={p.maskComp}
          title="Mask comp figures (Cmd+M)"
        >
          {p.maskComp ? '$$$' : '$ $ $'}
        </button>
        <button
          className="masthead__btn mono"
          onClick={cyclePref}
          title="Cycle theme: auto → light → dark"
        >
          {pref === 'auto' ? 'AUTO' : pref === 'light' ? 'LIGHT' : 'DARK'}
        </button>
        <button
          className="masthead__btn mono"
          onClick={p.onOpenSettings}
          aria-pressed={p.settingsActive}
          title="Settings (Cmd+,)"
        >
          <span>{p.settingsActive ? '◆' : '◇'}</span>
          <span className="masthead__btn-label">settings</span>
        </button>
        <button
          className="masthead__btn masthead__btn--accent mono"
          onClick={p.onOpenPalette}
          title="Command palette (Cmd+K)"
        >
          <span>⌘K</span>
          <span className="masthead__btn-label">palette</span>
        </button>
      </div>
    </header>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className={`masthead__stat${accent ? ' masthead__stat--accent' : ''}`}>
      <span className="masthead__stat-label">{label}</span>
      <span className="masthead__stat-value tabular">{value}</span>
    </span>
  );
}

function fmtClock(d: Date) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop() ?? '';
  return `${hh}:${mm}:${ss} ${tz.slice(0, 3).toUpperCase()}`;
}
