// PaneLocationFilter.tsx -- Settings pane for editing the optional
// `location_filter` block of config/profile.yml.
//
// Loads the FULL profile so unrelated fields aren't lost on save. The pane
// renders the structured editor (LocationPreferencesEditor) and merges its
// output back into the full profile payload before writing.
//
// Save flow:
//   1. Load profile via /api/config/parsed
//   2. User edits → local form state (LocationFilter)
//   3. SETTINGS_SAVE_EVENT fires → merge form into the rest of the profile,
//      send via api.writeProfile() (zod-validated server-side)
//   4. invalidate ['settings', 'profile'] so other panes see the new value
//
// Discard event resets the form to whatever the loaded profile had (which
// may be undefined for users who haven't configured a filter yet).

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type {
  LocationFilter,
  ProfileYaml,
  ProfileYamlFull,
  SettingsPaneId,
} from '../../../lib/types';
import { LocationPreferencesEditor } from '../../Onboarding/inputs/LocationPreferencesEditor';
import { useDirty } from '../lib/useDirty';
import { SETTINGS_SAVE_EVENT } from '../SettingsView';
import './PaneLocationFilter.css';

interface Props {
  onDirtyChange: (pane: SettingsPaneId, isDirty: boolean) => void;
  onValidChange: (pane: SettingsPaneId, isValid: boolean) => void;
  onSaveSuccess: (pane: SettingsPaneId) => void;
  onSaveError: (pane: SettingsPaneId, message: string) => void;
}

const EMPTY_FILTER: LocationFilter = {
  enabled: false,
  remote: { enabled: true, accept_regions: [], bare_remote_policy: 'allow' },
  hybrid: { locations: [] },
  onsite: { locations: [] },
  unknown_policy: 'ask',
};

export function PaneLocationFilter({
  onDirtyChange,
  onValidChange,
  onSaveSuccess,
  onSaveError,
}: Props) {
  const qc = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['settings', 'profile'],
    queryFn: () => api.loadProfile(),
  });

  // Initial filter pulled from the loaded profile. Wider type cast because
  // ProfileYamlFull is the zod-validated read shape; location_filter is
  // optional and may be missing entirely on first run.
  const initial: LocationFilter = useMemo(() => {
    const lf = (profileQuery.data?.parsed as ProfileYamlFull & {
      location_filter?: LocationFilter;
    } | undefined)?.location_filter;
    return lf ?? EMPTY_FILTER;
  }, [profileQuery.data]);

  const [form, setForm] = useState<LocationFilter | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (profileQuery.data) setForm(initial);
  }, [profileQuery.data, initial]);

  const { isDirty } = useDirty(initial, form);

  useEffect(() => {
    onDirtyChange('locationFilter', isDirty);
  }, [isDirty, onDirtyChange]);

  // Always valid: the location filter is optional and any combination is
  // legal. The zod schema does the real validation server-side.
  useEffect(() => {
    onValidChange('locationFilter', true);
  }, [onValidChange]);

  const saveMutation = useMutation({
    mutationFn: (payload: ProfileYaml) => api.writeProfile(payload),
    onSuccess: () => {
      setServerError(null);
      onSaveSuccess('locationFilter');
      qc.invalidateQueries({ queryKey: ['settings', 'profile'] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setServerError(message);
      onSaveError('locationFilter', message);
    },
  });

  // Listen for save dispatch from SettingsView
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pane: SettingsPaneId }>).detail;
      if (detail?.pane !== 'locationFilter') return;
      if (!form || !profileQuery.data) return;

      // Build the full profile payload by merging the existing parsed YAML
      // with the new location_filter. Strip out empty optional sub-fields so
      // the YAML stays clean and round-trips byte-stable when the filter is
      // disabled.
      const existing = profileQuery.data.parsed as ProfileYamlFull;
      const cleaned = cleanForWire(form);
      const payload: ProfileYaml = {
        ...existing,
        location_filter: cleaned,
      };
      saveMutation.mutate(payload);
    };
    document.addEventListener(SETTINGS_SAVE_EVENT, handler);
    return () => document.removeEventListener(SETTINGS_SAVE_EVENT, handler);
  }, [form, profileQuery.data, saveMutation]);

  // Listen for discard
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pane: SettingsPaneId }>).detail;
      if (detail?.pane !== 'locationFilter') return;
      setForm(initial);
      setServerError(null);
    };
    document.addEventListener('settings:discard-current-pane', handler);
    return () =>
      document.removeEventListener('settings:discard-current-pane', handler);
  }, [initial]);

  if (profileQuery.isLoading || !form) {
    return <p className="settings__placeholder">Reading config/profile.yml</p>;
  }
  if (profileQuery.isError) {
    return (
      <p className="settings__placeholder settings__placeholder--error">
        # could not load profile.yml · {String(profileQuery.error)}
      </p>
    );
  }

  return (
    <div className="pane-location-filter">
      <p className="settings__banner" role="note">
        # filter runs at scan time. off (default) = every job passes. scoring
        tiers in modes/_profile.md still apply at evaluation time and are
        unaffected.
      </p>

      {serverError ? (
        <p className="settings-error" role="alert">
          # write failed · {serverError}
        </p>
      ) : null}

      <LocationPreferencesEditor
        value={form}
        onChange={setForm}
        ariaLabel="Location filter preferences"
      />
    </div>
  );
}

/**
 * Strip empty arrays / unset blocks before sending the filter payload. Keeps
 * the YAML clean: a "filter off" save round-trips to a minimal block instead
 * of leaving stale keys around. Server zod accepts any shape; this is purely
 * cosmetic for the on-disk YAML.
 */
function cleanForWire(f: LocationFilter): LocationFilter {
  const out: LocationFilter = {
    enabled: f.enabled ?? false,
    unknown_policy: f.unknown_policy ?? 'ask',
  };
  if (f.remote) {
    out.remote = {
      enabled: f.remote.enabled !== false,
      accept_regions: f.remote.accept_regions ?? [],
      bare_remote_policy: f.remote.bare_remote_policy ?? 'allow',
    };
  }
  if (f.hybrid && (f.hybrid.locations ?? []).length > 0) {
    out.hybrid = { locations: f.hybrid.locations };
  }
  if (f.onsite && (f.onsite.locations ?? []).length > 0) {
    out.onsite = { locations: f.onsite.locations };
  }
  if (f.custom_aliases && Object.keys(f.custom_aliases).length > 0) {
    out.custom_aliases = f.custom_aliases;
  }
  return out;
}
