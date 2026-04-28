// Table.tsx - the virtual-scrolled applications table.
//
// Columns (left to right):
//   score   — a warm coin, 4.2 style, color-keyed to range
//   row     — [NUM]·company / role stack
//   status  — pill with canonical status
//   pdf     — ✓ / ? / —
//   meta    — date + archetype/TL;DR muted
//
// Grouped mode inserts "THEATER" headers between status groups,
// matching the TUI's grouped view. Keyboard: up/down navigates, enter
// opens (via onSelect → parent shows detail pane).

import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Application, SortMode, ViewMode } from '../lib/types';
import { api } from '../lib/api';
import { useShortcut } from '../lib/keymap';
import './Table.css';

type Row =
  | { kind: 'app'; app: Application }
  | { kind: 'group'; label: string; count: number };

interface Props {
  apps: Application[];
  view: ViewMode;
  sort: SortMode;
  selected: string | null;
  onSelect: (reportNumber: string) => void;
  maskComp: boolean;
}

export function ApplicationsTable({ apps, view, sort, selected, onSelect, maskComp }: Props) {
  const rows = useMemo<Row[]>(() => buildRows(apps, view), [apps, view]);
  const parent = useRef<HTMLDivElement | null>(null);
  const qc = useQueryClient();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    // Rough first guess; measureElement below re-measures once the row
    // renders so long company names, multi-line roles, and 2-line TL;DRs
    // all get the height they need without clipping.
    estimateSize: (i) => (rows[i].kind === 'group' ? 38 : 88),
    measureElement: (el) =>
      el instanceof HTMLElement ? el.getBoundingClientRect().height : 88,
    overscan: 6,
  });

  // Scroll the selected row into view.
  useEffect(() => {
    if (!selected) return;
    const idx = rows.findIndex((r) => r.kind === 'app' && r.app.reportNumber === selected);
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'auto' });
  }, [selected, rows, rowVirtualizer]);

  // Keyboard navigation: ArrowDown/ArrowUp cycle among app rows.
  useShortcut({
    id: 'table.down',
    combo: 'ArrowDown',
    group: 'Pipeline',
    label: 'Next row',
    run: () => {
      const flatApps = rows.filter((r): r is Extract<Row, { kind: 'app' }> => r.kind === 'app');
      const i = flatApps.findIndex((r) => r.app.reportNumber === selected);
      const next = flatApps[Math.min(i + 1, flatApps.length - 1)];
      if (next) onSelect(next.app.reportNumber);
    },
  });
  useShortcut({
    id: 'table.up',
    combo: 'ArrowUp',
    group: 'Pipeline',
    label: 'Previous row',
    run: () => {
      const flatApps = rows.filter((r): r is Extract<Row, { kind: 'app' }> => r.kind === 'app');
      const i = flatApps.findIndex((r) => r.app.reportNumber === selected);
      const next = flatApps[Math.max(i - 1, 0)];
      if (next) onSelect(next.app.reportNumber);
    },
  });

  const pdfMutation = useMutation({
    mutationFn: (reportNumber: string) => api.startPdfJob(reportNumber),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
  const prepMutation = useMutation({
    mutationFn: (reportNumber: string) => api.startInterviewPrepJob(reportNumber),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });

  return (
    <div className="table" ref={parent} tabIndex={-1}>
      <div className="table__header mono">
        <span className="table__h-col table__h-col--score">Score</span>
        <span className="table__h-col table__h-col--row">
          Row <span className="table__h-meta">· {sort}</span>
        </span>
        <span className="table__h-col table__h-col--status">Status</span>
        <span className="table__h-col table__h-col--pdf">PDF</span>
        <span className="table__h-col table__h-col--date">Date</span>
      </div>
      <div
        className="table__viewport"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index];
          // IMPORTANT: no explicit `height` here - the measureElement callback
          // reads the row's natural height after layout so wrapped roles and
          // 2-line TLDRs don't get cut off. `width: 100%` anchors the row to
          // the parent; `transform: translateY` places it.
          const positioning = {
            position: 'absolute' as const,
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${v.start}px)`,
          };
          const measureRef = (node: HTMLElement | null) => {
            if (node) rowVirtualizer.measureElement(node);
          };

          if (row.kind === 'group') {
            return (
              <div
                key={v.key}
                ref={measureRef}
                data-index={v.index}
                style={positioning}
                className="table__group"
              >
                <span className="table__group-dot" aria-hidden>●</span>
                <span className="table__group-label eyebrow">{row.label}</span>
                <span className="table__group-count mono tabular">{row.count}</span>
                <span className="table__group-rule" aria-hidden />
              </div>
            );
          }

          const app = row.app;
          const isSelected = app.reportNumber === selected;
          return (
            <button
              key={v.key}
              ref={measureRef}
              data-index={v.index}
              style={positioning}
              className={`table__row${isSelected ? ' table__row--selected' : ''}`}
              onClick={() => onSelect(app.reportNumber)}
              onDoubleClick={() => {
                if (app.pdfOnDisk) window.open(`/api/pdf?num=${app.reportNumInt}`, '_blank');
              }}
              title={`${app.company} · ${app.role}`}
            >
              <ScoreCoin score={app.score} />

              <span className="table__row-main">
                <span className="table__row-id mono">{app.reportNumber.padStart(3, '0')}</span>
                <span className="table__row-body">
                  <span className="table__row-company">{app.company}</span>
                  <span className="table__row-role">{app.role}</span>
                  {app.tlDr && (
                    <span className="table__row-tldr">
                      {maskComp ? maskCompText(app.tlDr) : app.tlDr}
                    </span>
                  )}
                </span>
              </span>

              <StatusPill status={app.canonicalStatus} raw={app.status} />

              <span className="table__row-pdf">
                <PDFGlyph
                  hasMarker={app.hasPDF}
                  onDisk={app.pdfOnDisk}
                  onGenerate={(e) => {
                    e.stopPropagation();
                    pdfMutation.mutate(app.reportNumber);
                  }}
                  onOpen={(e) => {
                    e.stopPropagation();
                    if (app.pdfOnDisk) window.open(`/api/pdf?num=${app.reportNumInt}`, '_blank');
                  }}
                />
                {app.hasInterviewPrep ? (
                  <span className="table__row-prep mono" title="interview prep on disk">i</span>
                ) : app.reportPath ? (
                  <button
                    className="table__row-prep-btn mono"
                    title="generate interview prep"
                    onClick={(e) => {
                      e.stopPropagation();
                      prepMutation.mutate(app.reportNumber);
                    }}
                  >
                    +
                  </button>
                ) : null}
              </span>

              <span className="table__row-date mono tabular">{shortDate(app.date)}</span>

              {isSelected && <span className="table__row-rule" aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function buildRows(apps: Application[], view: ViewMode): Row[] {
  if (view === 'flat') return apps.map((app) => ({ kind: 'app' as const, app }));
  const byStatus: Record<string, Application[]> = {};
  for (const a of apps) {
    (byStatus[a.canonicalStatus] ??= []).push(a);
  }
  const order = Object.keys(byStatus).sort((a, b) => {
    // reuse priority - lower statusRank first
    const ra = byStatus[a][0]?.statusRank ?? 99;
    const rb = byStatus[b][0]?.statusRank ?? 99;
    return ra - rb;
  });
  const out: Row[] = [];
  for (const k of order) {
    out.push({ kind: 'group', label: labelFor(k), count: byStatus[k].length });
    for (const a of byStatus[k]) out.push({ kind: 'app', app: a });
  }
  return out;
}

function labelFor(s: string) {
  if (!s) return 'Unlabeled';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shortDate(d: string) {
  if (!d) return '—';
  // d is YYYY-MM-DD; show MM-DD for compactness.
  const parts = d.split('-');
  if (parts.length < 2) return d;
  return `${parts[1]}-${parts[2] ?? ''}`;
}

function maskCompText(s: string): string {
  // mask things like $220K, $250-380K, 240K base, comp: $X
  return s
    .replace(/\$[\d,\.]+(?:-\$?[\d,\.]+)?\s*[KkMm]?/g, '$••')
    .replace(/\b\d{3,}K\b/gi, '•••')
    .replace(/\bcomp:\s*[^;,.]+/gi, 'comp: •••');
}

// -------- score coin --------------------------------------------------

function ScoreCoin({ score }: { score: number }) {
  const band =
    score >= 4.5 ? 'high' : score >= 4.0 ? 'strong' : score >= 3.0 ? 'ok' : score > 0 ? 'low' : 'none';
  return (
    <span className={`coin coin--${band}`} aria-label={`Score ${score.toFixed(1)} of 5`}>
      <span className="coin__value tabular">{score > 0 ? score.toFixed(1) : '—'}</span>
      <span className="coin__of">/5</span>
    </span>
  );
}

// -------- status pill --------------------------------------------------

export function StatusPill({ status, raw }: { status: string; raw?: string }) {
  const key = (status || 'unlabeled').toLowerCase();
  return (
    <span className={`pill pill--${key} mono`} title={raw ?? status}>
      <span className="pill__dot" aria-hidden />
      <span className="pill__label">{labelFor(key)}</span>
    </span>
  );
}

// -------- pdf glyph ----------------------------------------------------

function PDFGlyph({
  hasMarker,
  onDisk,
  onGenerate,
  onOpen,
}: {
  hasMarker: boolean;
  onDisk: boolean;
  onGenerate: (e: React.MouseEvent) => void;
  onOpen: (e: React.MouseEvent) => void;
}) {
  if (onDisk) {
    return (
      <button className="pdfglyph pdfglyph--ok mono" onClick={onOpen} title="open generated PDF">
        ✓ pdf
      </button>
    );
  }
  if (hasMarker) {
    return (
      <button className="pdfglyph pdfglyph--missing mono" onClick={onGenerate} title="marked done but file missing - regenerate">
        ? pdf
      </button>
    );
  }
  return (
    <button className="pdfglyph pdfglyph--none mono" onClick={onGenerate} title="generate PDF">
      + pdf
    </button>
  );
}
