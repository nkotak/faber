// DetailPane.tsx - the right-side reader. Shows a hero header for the
// selected application (company, role, score, archetype, comp/remote/TLDR),
// then renders the report markdown with reading-mode typography.
//
// HTML rendering is routed through DOMPurify + markdown-it (html:false)
// so even if a pathological report embeds raw HTML, it gets sanitized.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, useEffect } from 'react';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import type { Application, Job } from '../lib/types';
import { api } from '../lib/api';
import { StatusPill } from './Table';
import './DetailPane.css';

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
const purify = DOMPurify;

/**
 * Wrap every <table> in a scrollable container so wide eval-report tables
 * don't silently clip inside a narrow pane. The wrapper gets `overflow-x:
 * auto` styling from globals.css so the user can see AND reach every cell.
 */
function wrapTablesForScroll(html: string): string {
  if (typeof window === 'undefined' || !html.includes('<table')) return html;
  const doc = new DOMParser().parseFromString(`<div id="__root__">${html}</div>`, 'text/html');
  const root = doc.getElementById('__root__');
  if (!root) return html;
  root.querySelectorAll('table').forEach((table) => {
    const wrap = doc.createElement('div');
    wrap.className = 'prose-table-scroll';
    table.replaceWith(wrap);
    wrap.appendChild(table);
  });
  return root.innerHTML;
}

function renderMarkdown(raw: string): string {
  const rendered = md.render(raw);
  const safe = purify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
  return wrapTablesForScroll(typeof safe === 'string' ? safe : String(safe));
}

type Tab = 'report' | 'pdf' | 'prep';

interface Props {
  app: Application | null;
  maskComp: boolean;
}

export function DetailPane({ app, maskComp }: Props) {
  const [tab, setTab] = useState<Tab>('report');
  const qc = useQueryClient();

  // When the row changes, only fall back to 'report' if the current tab is
  // no longer available for the new app. Keeps the user's chosen tab sticky
  // across navigation (was resetting to 'report' every time).
  useEffect(() => {
    if (!app) return;
    if (tab === 'pdf' && !app.pdfOnDisk) setTab('report');
    else if (tab === 'prep' && !app.hasInterviewPrep) setTab('report');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.reportNumber, app?.pdfOnDisk, app?.hasInterviewPrep]);

  const reportQuery = useQuery({
    queryKey: ['report', app?.reportPath],
    queryFn: () => api.report(app!.reportPath),
    enabled: !!app?.reportPath && tab === 'report',
  });

  const prepQuery = useQuery({
    queryKey: ['prep', app?.interviewPrepSlug],
    queryFn: () => api.interviewPrep(app!.interviewPrepSlug),
    enabled: !!app?.interviewPrepSlug && app.hasInterviewPrep && tab === 'prep',
  });

  // Read active jobs so that a generation triggered from the sidebar (or from
  // a previous session that's still running) shows as in-flight here too.
  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: api.jobs,
    refetchInterval: 2000,
  });

  const pdfMutation = useMutation({
    mutationFn: (reportNumber: string) => api.startPdfJob(reportNumber),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      // Switch to the pdf tab so the user watches the result land.
      setTab('pdf');
    },
  });
  const prepMutation = useMutation({
    mutationFn: (reportNumber: string) => api.startInterviewPrepJob(reportNumber),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      setTab('prep');
    },
  });

  // A matching active job is one whose refKey is this app's reportNumber and
  // whose kind maps to the asset we care about. `running` is the live state;
  // we also count `cancelling` so the tab doesn't flip back to idle during a
  // cancel animation.
  const pdfJobRunning = useMemo(
    () => hasActiveJob(jobsQuery.data?.jobs, app?.reportNumber, 'pdf'),
    [jobsQuery.data, app?.reportNumber],
  );
  const prepJobRunning = useMemo(
    () => hasActiveJob(jobsQuery.data?.jobs, app?.reportNumber, 'interview-prep'),
    [jobsQuery.data, app?.reportNumber],
  );
  const pdfInFlight = pdfMutation.isPending || pdfJobRunning;
  const prepInFlight = prepMutation.isPending || prepJobRunning;

  const reportHtml = useMemo(() => {
    if (!reportQuery.data) return '';
    let content = reportQuery.data.content;
    if (maskComp) content = maskCompBlock(content);
    return renderMarkdown(content);
  }, [reportQuery.data, maskComp]);

  const prepHtml = useMemo(() => {
    if (!prepQuery.data) return '';
    let content = prepQuery.data.content;
    if (maskComp) content = maskCompBlock(content);
    return renderMarkdown(content);
  }, [prepQuery.data, maskComp]);

  if (!app) {
    return (
      <section className="detail detail--empty">
        <p className="eyebrow">No selection</p>
        <p className="detail__empty-line">
          Pick any row on the left to read its evaluation report — or press{' '}
          <kbd className="mono">⌘K</kbd> to jump directly.
        </p>
      </section>
    );
  }

  return (
    <section className="detail" aria-label="application detail">
      <header className="detail__hero">
        {/* Row 1 — masthead band: coord on the left, tab nav on the right.
            Mono, small-caps, single line. Operational-terminal density. */}
        <div className="detail__masthead">
          <div className="detail__masthead-coord mono">
            <span className="detail__coord-label">Row</span>
            <span className="detail__coord-value tabular">{app.reportNumber.padStart(3, '0')}</span>
            <span className="detail__coord-sep">·</span>
            <span className="detail__coord-label">{shortDate(app.date)}</span>
            {app.jobURL && (
              <>
                <span className="detail__coord-sep">·</span>
                <a className="detail__coord-link" href={app.jobURL} target="_blank" rel="noreferrer">
                  open posting ↗
                </a>
              </>
            )}
          </div>
          <nav className="detail__tabs mono">
            <button
              className="detail__tab"
              data-active={tab === 'report'}
              onClick={() => setTab('report')}
              disabled={!app.reportPath}
            >
              report
            </button>

            {/* PDF tab: when the file exists, this is a view-tab. When it
                doesn't, it's an action button that kicks off a generation
                job. `.detail__tab--action` styles it to look like an
                affordance (the `+` prefix) rather than a disabled viewer. */}
            {app.pdfOnDisk ? (
              <button
                className="detail__tab"
                data-active={tab === 'pdf'}
                onClick={() => setTab('pdf')}
              >
                pdf
              </button>
            ) : (
              <button
                className="detail__tab detail__tab--action"
                onClick={() => pdfMutation.mutate(app.reportNumber)}
                disabled={pdfInFlight || !app.reportPath}
                data-running={pdfInFlight || undefined}
                title={
                  !app.reportPath
                    ? 'Evaluate this role first'
                    : pdfInFlight
                    ? 'Generating PDF — this takes a minute or two'
                    : 'Generate tailored CV PDF for this role'
                }
              >
                {pdfInFlight ? 'generating pdf…' : '+ pdf'}
              </button>
            )}

            {/* Interview prep tab: same pattern as PDF. */}
            {app.hasInterviewPrep ? (
              <button
                className="detail__tab"
                data-active={tab === 'prep'}
                onClick={() => setTab('prep')}
              >
                interview
              </button>
            ) : (
              <button
                className="detail__tab detail__tab--action"
                onClick={() => prepMutation.mutate(app.reportNumber)}
                disabled={prepInFlight || !app.reportPath}
                data-running={prepInFlight || undefined}
                title={
                  !app.reportPath
                    ? 'Evaluate this role first'
                    : prepInFlight
                    ? 'Generating interview prep — this takes a couple of minutes'
                    : 'Generate interview prep notes for this role'
                }
              >
                {prepInFlight ? 'generating prep…' : '+ interview'}
              </button>
            )}
          </nav>
        </div>

        {/* Row 2 — editorial banner: company headline + score rating block.
            Grid 1fr auto so the company shrinks gracefully while the
            score stays pinned to the right, baseline-aligned. */}
        <div className="detail__banner">
          <h1
            className="display detail__company"
            style={{ viewTransitionName: 'detail-company' }}
          >
            {app.company}
          </h1>
          {app.score != null && (
            <div className="detail__score-block" aria-label={`Score ${app.score.toFixed(1)} out of 5`}>
              <span className="detail__score-block-num tabular">{app.score.toFixed(1)}</span>
              <span className="detail__score-block-of">out of 5</span>
            </div>
          )}
        </div>

        {/* Row 3 — kicker: role in italic prose serif, subtitle to the
            company headline. */}
        <p
          className="detail__role"
          style={{ viewTransitionName: 'detail-role' }}
        >
          {app.role}
        </p>

        {/* Row 4 — standfirst: inline key-value strip, small-caps labels in
            mono. Replaces the old 5-cell grid that wrapped awkwardly. */}
        <div className="detail__standfirst">
          <span className="detail__standfirst-item">
            <span className="detail__standfirst-label">Status</span>
            <StatusPill status={app.canonicalStatus} raw={app.status} />
          </span>
          {app.archetype && (
            <>
              <span className="detail__standfirst-sep" aria-hidden="true">·</span>
              <span className="detail__standfirst-item">
                <span className="detail__standfirst-label">Archetype</span>
                <span className="detail__standfirst-value">{app.archetype}</span>
              </span>
            </>
          )}
          {app.remote && (
            <>
              <span className="detail__standfirst-sep" aria-hidden="true">·</span>
              <span className="detail__standfirst-item">
                <span className="detail__standfirst-label">Remote</span>
                <span className="detail__standfirst-value">{app.remote}</span>
              </span>
            </>
          )}
          {app.compEstimate && (
            <>
              <span className="detail__standfirst-sep" aria-hidden="true">·</span>
              <span className="detail__standfirst-item">
                <span className="detail__standfirst-label">Comp</span>
                <span className="detail__standfirst-value">
                  {maskComp ? '•••' : app.compEstimate}
                </span>
              </span>
            </>
          )}
        </div>

        {/* Row 5 — pull-quote TL;DR (optional): Spectral italic with a
            thin phosphor-dim left rule. Editorial flourish, not a card. */}
        {app.tlDr && (
          <p className="detail__tldr">
            {maskComp ? maskCompInline(app.tlDr) : app.tlDr}
          </p>
        )}
      </header>

      <div className="detail__body">
        {tab === 'report' && (
          <div className="detail__reader">
            {reportQuery.isLoading ? (
              <p className="detail__placeholder">Reading report…</p>
            ) : reportQuery.isError ? (
              <p className="detail__placeholder">Couldn’t load the report.</p>
            ) : (
              <SanitizedProse html={reportHtml} />
            )}
          </div>
        )}
        {tab === 'pdf' && app.pdfOnDisk && (
          <iframe
            className="detail__pdf"
            src={`/api/pdf?num=${app.reportNumInt}`}
            title={`${app.company} · generated CV PDF`}
          />
        )}
        {tab === 'prep' && (
          <div className="detail__reader">
            {prepQuery.isLoading ? (
              <p className="detail__placeholder">Reading prep notes…</p>
            ) : prepQuery.isError ? (
              <p className="detail__placeholder">Couldn’t load prep notes.</p>
            ) : (
              <SanitizedProse html={prepHtml} />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * SanitizedProse - thin wrapper that renders DOMPurify-sanitized HTML.
 * Kept in a dedicated component so the sanitization call site is easy
 * to audit. `html` MUST come from renderMarkdown above.
 */
function SanitizedProse({ html }: { html: string }) {
  // eslint-disable-next-line react/no-danger -- content is sanitized via DOMPurify at source.
  return <article className="prose detail__prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * True when there's a running/cancelling job for this app's reportNumber
 * of the given kind. Lets the detail pane show in-flight state even when
 * the generation was triggered somewhere else (sidebar, Queue, another tab).
 */
function hasActiveJob(jobs: Job[] | undefined, reportNumber: string | undefined, kind: Job['kind']): boolean {
  if (!jobs || !reportNumber) return false;
  return jobs.some(
    (j) =>
      j.kind === kind &&
      j.refKey === reportNumber &&
      (j.status === 'running' || j.status === 'cancelling'),
  );
}

function shortDate(d: string) {
  if (!d) return '—';
  return d;
}

function maskCompBlock(md: string) {
  return md
    .replace(/^.*\*\*Comp\*\*.*$/gm, '**Comp** | •••')
    .replace(/^.*\bcomp(?:ensation)?:?\s.*$/gim, (line) =>
      line.replace(/[$€£][\d,\.]+K?[^;\n,]*/g, '•••'),
    )
    .replace(/\$[\d,\.]+(?:-\$?[\d,\.]+)?\s*[KkMm]?/g, '$••')
    .replace(/\b\d{3,}K\b/gi, '•••');
}

function maskCompInline(s: string) {
  return s
    .replace(/\$[\d,\.]+(?:-\$?[\d,\.]+)?\s*[KkMm]?/g, '$••')
    .replace(/\b\d{3,}K\b/gi, '•••');
}
