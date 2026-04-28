// App.tsx - top-level shell.
//
// Grid:
//   row 1: Masthead (logo + tabs + clock + theme toggle)
//   row 2: Main (two-column: left = table, right = detail/reader)
//   row 3: JobTray (active job chips)

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import { bindGlobalKeydown } from './lib/keymap';
import type {
  Application,
  FilterTab,
  SettingsPaneId,
  SortMode,
  ViewMode,
} from './lib/types';
import { Masthead } from './components/Masthead';
import { FilterTabs } from './components/FilterTabs';
import { ApplicationsTable } from './components/Table';
import { DetailPane } from './components/DetailPane';
import { JobTray } from './components/JobTray';
import { CommandPalette } from './components/Palette';
import { PendingQueue } from './components/Queue';
import { EmptyOrLoading } from './components/States';
import { StatusPicker } from './components/StatusPicker';
import { SettingsView } from './components/Settings/SettingsView';
import { useShortcut } from './lib/keymap';
import './components/Shell.css';
import { useQueryClient } from '@tanstack/react-query';

const SETTINGS_PANE_IDS: ReadonlyArray<SettingsPaneId> = [
  'cv',
  'profile',
  'profileMd',
  'portals',
];

function isSettingsPaneId(v: string | null): v is SettingsPaneId {
  return v !== null && (SETTINGS_PANE_IDS as ReadonlyArray<string>).includes(v);
}

export function App() {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [sort, setSort] = useState<SortMode>('score');
  const [view, setView] = useState<ViewMode>('grouped');
  const [selectedReportNum, setSelectedReportNum] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [maskComp, setMaskComp] = useState(false); // privacy toggle for shared sessions

  // Settings view: false when closed, otherwise the active pane id.
  // Hydrated from URL `?settings=<id>` so a refresh preserves the pane.
  const [settingsActive, setSettingsActive] = useState<SettingsPaneId | false>(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('settings');
    return isSettingsPaneId(id) ? id : false;
  });

  const qc = useQueryClient();

  // Focus mode: sidebar collapses to a navigation rail, detail takes over.
  // Default is viewport-aware (narrow laptop → focus; external monitor → split).
  // User's explicit ⌘. toggle locks until the viewport crosses the breakpoint.
  const [focus, setFocus] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const locked = localStorage.getItem('faber.focusLock');
    if (locked === 'on') return true;
    if (locked === 'off') return false;
    return window.matchMedia('(max-width: 1200px)').matches;
  });

  // React to viewport changes — but only if the user hasn't locked a preference.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1200px)');
    const onChange = () => {
      if (localStorage.getItem('faber.focusLock')) return;
      setFocus(mq.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Reflect focus state on <html> so CSS selectors can key off it.
  useEffect(() => {
    document.documentElement.dataset.focus = focus ? 'true' : 'false';
  }, [focus]);

  const toggleFocus = () => {
    setFocus((prev) => {
      const next = !prev;
      // Record the explicit preference so resize doesn't override it.
      localStorage.setItem('faber.focusLock', next ? 'on' : 'off');
      return next;
    });
  };

  // Bind keyboard globally once.
  useEffect(() => bindGlobalKeydown(), []);

  const pipelineQuery = useQuery({
    queryKey: ['pipeline'],
    queryFn: api.pipeline,
  });

  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: api.jobs,
    refetchInterval: 2_500,
  });

  const apps: Application[] = pipelineQuery.data?.applications ?? [];
  const pending = pipelineQuery.data?.pending ?? [];

  // Derived: filtered + sorted rows, grouped or flat.
  const filteredApps = useMemo(() => filterApps(apps, filter), [apps, filter]);
  const sortedApps = useMemo(() => sortApps(filteredApps, sort), [filteredApps, sort]);

  // Resolve selected app for the right pane.
  const selectedApp = useMemo(
    () => apps.find((a) => a.reportNumber === selectedReportNum) ?? null,
    [apps, selectedReportNum],
  );

  // View-transition-wrapped select - creates the cinematic morph between the
  // selected row's company name and the detail hero's company name.
  const selectApp = (reportNumber: string) => {
    const doc = document as unknown as {
      startViewTransition?: (cb: () => void) => unknown;
    };
    if (doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      doc.startViewTransition(() => setSelectedReportNum(reportNumber));
    } else {
      setSelectedReportNum(reportNumber);
    }
  };

  // Default selection: first app after data lands, once.
  useEffect(() => {
    if (!selectedReportNum && sortedApps.length > 0) {
      setSelectedReportNum(sortedApps[0].reportNumber);
    }
  }, [selectedReportNum, sortedApps]);

  // Sync the URL with the active settings pane so reload restores the pane.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (settingsActive) {
      url.searchParams.set('settings', settingsActive);
    } else {
      url.searchParams.delete('settings');
    }
    // replaceState avoids polluting history with one entry per toggle.
    window.history.replaceState({}, '', url.toString());
  }, [settingsActive]);

  // Keyboard: Mod+K opens the palette.
  useShortcut({
    id: 'app.palette',
    combo: 'Mod+k',
    group: 'App',
    label: 'Command palette',
    run: () => setPaletteOpen((v) => !v),
  });
  useShortcut({
    id: 'app.toggle-settings',
    combo: 'Mod+,',
    group: 'App',
    label: 'Toggle settings',
    run: () => setSettingsActive((s) => (s ? false : 'cv')),
    when: () => !paletteOpen && !statusPickerOpen,
  });
  useShortcut({
    id: 'app.cycle-sort',
    combo: 's',
    group: 'App',
    label: 'Cycle sort',
    run: () => setSort(nextSort),
    when: () => !paletteOpen,
  });
  useShortcut({
    id: 'app.toggle-view',
    combo: 'v',
    group: 'App',
    label: 'Toggle grouped / flat',
    run: () => setView((v) => (v === 'grouped' ? 'flat' : 'grouped')),
    when: () => !paletteOpen,
  });
  useShortcut({
    id: 'app.mask-comp',
    combo: 'Mod+m',
    group: 'App',
    label: 'Mask comp figures',
    run: () => setMaskComp((v) => !v),
  });
  useShortcut({
    id: 'app.toggle-focus',
    combo: 'Mod+.',
    group: 'App',
    label: 'Toggle focus mode',
    run: toggleFocus,
  });
  useShortcut({
    id: 'app.refresh',
    combo: 'r',
    group: 'App',
    label: 'Manual refresh',
    run: () => {
      qc.invalidateQueries({ queryKey: ['pipeline'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    when: () => !paletteOpen && !statusPickerOpen,
  });
  useShortcut({
    id: 'app.status-picker',
    combo: 'c',
    group: 'Pipeline',
    label: 'Change status',
    run: () => {
      if (selectedApp) setStatusPickerOpen(true);
    },
    when: () => !paletteOpen,
  });
  useShortcut({
    id: 'app.open-report',
    combo: 'Enter',
    group: 'Pipeline',
    label: 'Focus report',
    run: () => {
      const reader = document.querySelector<HTMLElement>('.detail__reader, .detail__pdf');
      reader?.focus();
    },
    when: () => !paletteOpen && !statusPickerOpen,
  });

  const isQueue = filter === 'queue';

  return (
    <>
      <Masthead
        total={pipelineQuery.data?.meta.total ?? 0}
        withPDF={pipelineQuery.data?.meta.withPDF ?? 0}
        avgScore={pipelineQuery.data?.meta.avgScore ?? 0}
        topScore={pipelineQuery.data?.meta.topScore ?? 0}
        onOpenPalette={() => setPaletteOpen(true)}
        maskComp={maskComp}
        onToggleMask={() => setMaskComp((v) => !v)}
        focus={focus}
        onToggleFocus={toggleFocus}
        settingsActive={!!settingsActive}
        onOpenSettings={() => setSettingsActive((s) => (s ? false : 'cv'))}
      />
      {settingsActive ? (
        <SettingsView
          initialPane={settingsActive}
          onChangePane={(p) => setSettingsActive(p)}
          onClose={() => setSettingsActive(false)}
        />
      ) : (
        <main className="shell">
          <div className="shell__sidebar">
            <FilterTabs
              current={filter}
              onChange={setFilter}
              counts={pipelineQuery.data?.meta.byStatus ?? {}}
              pendingCount={pipelineQuery.data?.meta.pendingCount ?? 0}
              total={apps.length}
            />
            <div className="shell__list">
              {pipelineQuery.isLoading ? (
                <EmptyOrLoading kind="loading" />
              ) : pipelineQuery.isError ? (
                <EmptyOrLoading kind="error" message={String(pipelineQuery.error)} />
              ) : isQueue ? (
                <PendingQueue items={pending} />
              ) : sortedApps.length === 0 ? (
                <EmptyOrLoading kind="empty" />
              ) : (
                <ApplicationsTable
                  apps={sortedApps}
                  view={view}
                  sort={sort}
                  selected={selectedReportNum}
                  onSelect={selectApp}
                  maskComp={maskComp}
                />
              )}
            </div>
          </div>
          <div className="shell__reader">
            <DetailPane app={selectedApp} maskComp={maskComp} />
          </div>
        </main>
      )}
      <JobTray jobs={jobsQuery.data?.jobs ?? []} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        apps={apps}
        onNavigate={(reportNumber) => {
          selectApp(reportNumber);
          setPaletteOpen(false);
        }}
      />
      <StatusPicker
        open={statusPickerOpen}
        reportNumber={selectedApp?.reportNumber ?? null}
        current={selectedApp?.status ?? null}
        options={pipelineQuery.data?.canonicalStatuses ?? []}
        onClose={() => setStatusPickerOpen(false)}
      />
    </>
  );
}

function filterApps(apps: Application[], f: FilterTab): Application[] {
  switch (f) {
    case 'all':
      return apps;
    case 'top':
      return apps.filter((a) => a.score >= 4.0 && a.canonicalStatus !== 'skip');
    case 'applied':
      return apps.filter((a) => a.canonicalStatus === 'applied');
    case 'interview':
      return apps.filter((a) => a.canonicalStatus === 'interview');
    case 'evaluated':
      return apps.filter((a) => a.canonicalStatus === 'evaluated');
    case 'skip':
      return apps.filter((a) => a.canonicalStatus === 'skip');
    case 'queue':
      return apps;
    default:
      return apps;
  }
}

function sortApps(apps: Application[], sort: SortMode): Application[] {
  const arr = [...apps];
  switch (sort) {
    case 'score':
      return arr.sort((a, b) => b.score - a.score || a.company.localeCompare(b.company));
    case 'date':
      return arr.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    case 'company':
      return arr.sort((a, b) => a.company.localeCompare(b.company));
    case 'status':
      return arr.sort((a, b) => a.statusRank - b.statusRank || b.score - a.score);
  }
}

function nextSort(prev: SortMode): SortMode {
  const order: SortMode[] = ['score', 'date', 'company', 'status'];
  return order[(order.indexOf(prev) + 1) % order.length];
}
