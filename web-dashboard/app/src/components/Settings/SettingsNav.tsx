// SettingsNav.tsx -- left rail of the Settings view.
//
// Lists the four panes with their keyboard shortcuts and a dirty marker
// when the corresponding pane has unsaved changes. Active pane gets a
// 1px phosphor left border (the only phosphor in the nav).

import type { SettingsPaneId } from '../../lib/types';
import { SETTINGS_NAV_ITEMS } from './lib/types';

interface Props {
  active: SettingsPaneId;
  dirty: ReadonlySet<SettingsPaneId>;
  onSelect: (id: SettingsPaneId) => void;
}

export function SettingsNav({ active, dirty, onSelect }: Props) {
  return (
    <nav className="settings__nav" aria-label="Settings sections">
      <ul className="settings__nav-list">
        {SETTINGS_NAV_ITEMS.map((it) => {
          const isActive = it.id === active;
          const isDirty = dirty.has(it.id);
          return (
            <li key={it.id}>
              <button
                type="button"
                className={`settings__nav-item${isActive ? ' settings__nav-item--active' : ''}${
                  isDirty ? ' settings__nav-item--dirty' : ''
                }`}
                onClick={() => onSelect(it.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="settings__nav-label">{it.label}</span>
                <span className="settings__nav-shortcut">cmd-{it.idx}</span>
                <span className="settings__nav-marker" aria-hidden>
                  {isDirty ? '·' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <footer className="settings__nav-foot">
        <span className="settings__nav-foot-line"># esc close</span>
        <span className="settings__nav-foot-line"># cmd-s save</span>
      </footer>
    </nav>
  );
}
