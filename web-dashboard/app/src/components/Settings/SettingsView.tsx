// SettingsView.tsx -- post-onboarding edit surface for the four user-layer
// files. Mounts in place of the dashboard's main grid area when the user
// activates settings (Cmd+, or the masthead button). Owns nav, dirty
// tracking, save bar, esc-handling, and the keyboard contract.
//
// Per-pane behavior is delegated: each pane owns its own data fetch and
// save mutation. SettingsView aggregates dirty state, exposes a single
// save action that dispatches to the active pane via a custom event, and
// renders the surrounding chrome.
//
// Keyboard:
//   Cmd+S  save the active pane (when dirty + valid)
//   Cmd+1..4  jump to a pane (with a soft confirm if the active pane is dirty)
//   Esc     close (with a soft confirm if any pane is dirty)
//
// The palette and StatusPicker keep working over Settings; we don't gate
// their open shortcuts.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { SettingsPaneId } from '../../lib/types';
import { SETTINGS_NAV_ITEMS } from './lib/types';
import { SettingsNav } from './SettingsNav';
import { PaneCV } from './panes/PaneCV';
import { PaneProfile } from './panes/PaneProfile';
import { PaneProfileMd } from './panes/PaneProfileMd';
import { PanePortals } from './panes/PanePortals';
import { PaneLocationFilter } from './panes/PaneLocationFilter';
import { useShortcut } from '../../lib/keymap';
import './SettingsView.css';
import '../Onboarding/OnboardingForms.css';
import '../Onboarding/steps/StepProfileMd.css';

/** Custom DOM event the panes listen for to perform their save mutation. */
export const SETTINGS_SAVE_EVENT = 'settings:save-current-pane';

interface Props {
  initialPane: SettingsPaneId;
  onChangePane: (pane: SettingsPaneId) => void;
  onClose: () => void;
}

/** Opaque error state for the save bar. The `forPane` field guards against
 * stale errors leaking from one pane to another after a switch. */
interface SaveBarState {
  saving: boolean;
  error: string | null;
  forPane: SettingsPaneId | null;
}

export function SettingsView({ initialPane, onChangePane, onClose }: Props) {
  const [activePane, setActivePane] = useState<SettingsPaneId>(initialPane);
  const [dirtySet, setDirtySet] = useState<ReadonlySet<SettingsPaneId>>(
    () => new Set(),
  );
  const [validSet, setValidSet] = useState<ReadonlySet<SettingsPaneId>>(
    () => new Set(SETTINGS_NAV_ITEMS.map((i) => i.id)),
  );
  const [saveBar, setSaveBar] = useState<SaveBarState>({
    saving: false,
    error: null,
    forPane: null,
  });

  // -- Esc and pane-switch confirm notices ---------------------------------
  const [escNoticeUntil, setEscNoticeUntil] = useState(0);
  const [paneSwitchPending, setPaneSwitchPending] = useState<{
    target: SettingsPaneId;
    until: number;
  } | null>(null);

  const escNoticeVisible = escNoticeUntil > 0 && escNoticeUntil >= Date.now();
  const paneSwitchVisible =
    paneSwitchPending !== null && paneSwitchPending.until >= Date.now();

  // Tick the visibility flags so they auto-clear in the UI even without
  // a re-render trigger from elsewhere. We schedule a one-shot timer
  // each time a notice goes up.
  const escTimerRef = useRef<number | null>(null);
  const switchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (escNoticeUntil <= 0) return;
    if (escTimerRef.current) window.clearTimeout(escTimerRef.current);
    const ms = Math.max(0, escNoticeUntil - Date.now());
    escTimerRef.current = window.setTimeout(() => {
      setEscNoticeUntil(0);
    }, ms);
    return () => {
      if (escTimerRef.current) window.clearTimeout(escTimerRef.current);
    };
  }, [escNoticeUntil]);

  useEffect(() => {
    if (!paneSwitchPending) return;
    if (switchTimerRef.current) window.clearTimeout(switchTimerRef.current);
    const ms = Math.max(0, paneSwitchPending.until - Date.now());
    switchTimerRef.current = window.setTimeout(() => {
      setPaneSwitchPending(null);
    }, ms);
    return () => {
      if (switchTimerRef.current) window.clearTimeout(switchTimerRef.current);
    };
  }, [paneSwitchPending]);

  // -- Pane registration: each pane reports its dirty + valid state up. ---
  const onDirtyChange = useCallback(
    (pane: SettingsPaneId, isDirty: boolean) => {
      setDirtySet((prev) => {
        const had = prev.has(pane);
        if (had === isDirty) return prev;
        const next = new Set(prev);
        if (isDirty) next.add(pane);
        else next.delete(pane);
        return next;
      });
    },
    [],
  );

  const onValidChange = useCallback(
    (pane: SettingsPaneId, isValid: boolean) => {
      setValidSet((prev) => {
        const had = prev.has(pane);
        if (had === isValid) return prev;
        const next = new Set(prev);
        if (isValid) next.add(pane);
        else next.delete(pane);
        return next;
      });
    },
    [],
  );

  // -- Save dispatch: the active pane listens for this custom event. ------
  const dispatchSave = useCallback(() => {
    const pane = activePane;
    setSaveBar({ saving: true, error: null, forPane: pane });
    document.dispatchEvent(
      new CustomEvent(SETTINGS_SAVE_EVENT, { detail: { pane } }),
    );
  }, [activePane]);

  const onSaveSuccess = useCallback(
    (pane: SettingsPaneId) => {
      setSaveBar((prev) =>
        prev.forPane === pane ? { saving: false, error: null, forPane: null } : prev,
      );
    },
    [],
  );

  const onSaveError = useCallback(
    (pane: SettingsPaneId, message: string) => {
      setSaveBar((prev) =>
        prev.forPane === pane ? { saving: false, error: message, forPane: pane } : prev,
      );
    },
    [],
  );

  // -- Pane switching with dirty confirm ----------------------------------
  const switchPane = useCallback(
    (target: SettingsPaneId) => {
      if (target === activePane) return;
      const isDirty = dirtySet.has(activePane);
      if (!isDirty) {
        // Clean: switch immediately. Wrap in View Transition for the title morph.
        const doc = document as unknown as {
          startViewTransition?: (cb: () => void) => unknown;
        };
        if (
          doc.startViewTransition &&
          !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
          doc.startViewTransition(() => {
            setActivePane(target);
            onChangePane(target);
          });
        } else {
          setActivePane(target);
          onChangePane(target);
        }
        setPaneSwitchPending(null);
        return;
      }
      // Dirty: first click queues a soft confirm; second within 1.5s switches.
      if (
        paneSwitchPending &&
        paneSwitchPending.target === target &&
        paneSwitchPending.until >= Date.now()
      ) {
        // Confirmed — switch and discard. The pane will re-fetch on remount.
        setActivePane(target);
        onChangePane(target);
        setPaneSwitchPending(null);
        // Clear the dirty flag for the source pane: by switching we discard
        // its local state, and PaneX components reset their initial
        // baseline on remount. We optimistically clear it here.
        setDirtySet((prev) => {
          if (!prev.has(activePane)) return prev;
          const next = new Set(prev);
          next.delete(activePane);
          return next;
        });
        return;
      }
      setPaneSwitchPending({ target, until: Date.now() + 1500 });
    },
    [activePane, dirtySet, paneSwitchPending, onChangePane],
  );

  // -- Esc / Cmd+S / Cmd+1..4 shortcuts -----------------------------------
  const closeOrConfirm = useCallback(() => {
    const anyDirty = dirtySet.size > 0;
    if (!anyDirty) {
      onClose();
      return;
    }
    if (escNoticeUntil > 0 && escNoticeUntil >= Date.now()) {
      // Second Esc within window: discard and close.
      onClose();
      return;
    }
    setEscNoticeUntil(Date.now() + 2000);
  }, [dirtySet.size, escNoticeUntil, onClose]);

  useShortcut({
    id: 'settings.save',
    combo: 'Mod+s',
    group: 'Settings',
    label: 'Save active pane',
    run: () => {
      if (saveBar.saving) return;
      if (!dirtySet.has(activePane)) return;
      if (!validSet.has(activePane)) return;
      dispatchSave();
    },
    when: () => true,
  });

  useShortcut({
    id: 'settings.close',
    combo: 'Escape',
    group: 'Settings',
    label: 'Close settings',
    run: () => closeOrConfirm(),
    when: () => true,
  });

  useShortcut({
    id: 'settings.pane.1',
    combo: 'Mod+1',
    group: 'Settings',
    label: 'CV pane',
    run: () => switchPane('cv'),
    when: () => true,
  });
  useShortcut({
    id: 'settings.pane.2',
    combo: 'Mod+2',
    group: 'Settings',
    label: 'Profile pane',
    run: () => switchPane('profile'),
    when: () => true,
  });
  useShortcut({
    id: 'settings.pane.3',
    combo: 'Mod+3',
    group: 'Settings',
    label: 'Profile Notes pane',
    run: () => switchPane('profileMd'),
    when: () => true,
  });
  useShortcut({
    id: 'settings.pane.4',
    combo: 'Mod+4',
    group: 'Settings',
    label: 'Portals pane',
    run: () => switchPane('portals'),
    when: () => true,
  });
  useShortcut({
    id: 'settings.pane.5',
    combo: 'Mod+5',
    group: 'Settings',
    label: 'Location Filter pane',
    run: () => switchPane('locationFilter'),
    when: () => true,
  });

  // -- Pane title + path for the header strip -----------------------------
  const navItem = useMemo(
    () => SETTINGS_NAV_ITEMS.find((i) => i.id === activePane)!,
    [activePane],
  );

  const dirtyCount = dirtySet.size;
  const activeDirty = dirtySet.has(activePane);
  const activeValid = validSet.has(activePane);
  const saveDisabled = !activeDirty || !activeValid || saveBar.saving;

  return (
    <section className="settings" aria-label="Settings">
      <SettingsNav
        active={activePane}
        dirty={dirtySet}
        onSelect={(id) => switchPane(id)}
      />
      <div className="settings__pane">
        <header className="settings__header">
          <h1 className="settings__title display">{titleFor(activePane)}</h1>
          <span className="settings__path mono">~/faber/{navItem.relPath}</span>
        </header>

        <div className="settings__body" role="tabpanel" aria-labelledby={`settings-pane-${activePane}`}>
          <ActivePane
            id={activePane}
            onDirtyChange={onDirtyChange}
            onValidChange={onValidChange}
            onSaveSuccess={onSaveSuccess}
            onSaveError={onSaveError}
          />
        </div>

        <footer className="settings__savebar" role="region" aria-label="Save controls">
          <span className="settings__savebar-status">
            {saveBar.error
              ? `# write failed · ${saveBar.error}`
              : saveBar.saving
                ? '# saving'
                : dirtyCount === 0
                  ? '# all changes saved · esc to close'
                  : dirtyCount === 1
                    ? '# 1 unsaved · cmd-s save · esc to close'
                    : `# ${dirtyCount} unsaved · cmd-s save · esc to close`}
          </span>
          <span className="settings__savebar-actions">
            {dirtyCount > 0 ? (
              <>
                <button
                  type="button"
                  className="onb-btn onb-btn--ghost settings__btn"
                  onClick={() => dispatchDiscard(activePane)}
                  disabled={!activeDirty || saveBar.saving}
                >
                  discard
                </button>
                <button
                  type="button"
                  className="onb-btn onb-btn--primary settings__btn"
                  onClick={dispatchSave}
                  disabled={saveDisabled}
                  aria-busy={saveBar.saving || undefined}
                >
                  {saveBar.saving ? 'saving' : 'save'}
                </button>
              </>
            ) : null}
          </span>
        </footer>

        {escNoticeVisible ? (
          <div className="settings__esc-notice settings__esc-notice--visible" role="status" aria-live="polite">
            # unsaved changes · esc again to discard · cmd-s to save
          </div>
        ) : null}

        {paneSwitchVisible ? (
          <div className="settings__esc-notice settings__esc-notice--visible" role="status" aria-live="polite">
            # unsaved · click again to switch · cmd-s saves first
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Fire the discard event for the active pane. The pane resets its local
 * state and reports back via onDirtyChange. */
function dispatchDiscard(pane: SettingsPaneId): void {
  document.dispatchEvent(
    new CustomEvent('settings:discard-current-pane', { detail: { pane } }),
  );
}

function titleFor(pane: SettingsPaneId): string {
  switch (pane) {
    case 'cv':
      return 'cv';
    case 'profile':
      return 'profile';
    case 'profileMd':
      return 'profile notes';
    case 'portals':
      return 'portals';
    case 'locationFilter':
      return 'location filter';
  }
}

interface PaneCallbackProps {
  onDirtyChange: (pane: SettingsPaneId, isDirty: boolean) => void;
  onValidChange: (pane: SettingsPaneId, isValid: boolean) => void;
  onSaveSuccess: (pane: SettingsPaneId) => void;
  onSaveError: (pane: SettingsPaneId, message: string) => void;
}

interface ActivePaneProps extends PaneCallbackProps {
  id: SettingsPaneId;
}

function ActivePane({ id, ...rest }: ActivePaneProps) {
  switch (id) {
    case 'cv':
      return <PaneCV {...rest} />;
    case 'profile':
      return <PaneProfile {...rest} />;
    case 'profileMd':
      return <PaneProfileMd {...rest} />;
    case 'portals':
      return <PanePortals {...rest} />;
    case 'locationFilter':
      return <PaneLocationFilter {...rest} />;
  }
}
