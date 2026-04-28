// PaneProfileMd.tsx -- structured editor for modes/_profile.md.
//
// Honest constraint: there is no markdown -> structured parser. Every save
// regenerates the file from the structured payload via the existing
// /api/onboarding/customize-profile-md endpoint. To prevent surprise data
// loss, a banner at the top tells the user that saving overwrites the
// whole file, and points them at their text editor for prose-only edits.
// The current file content shows up in a collapsed "view current" block
// so the user can read what's there without leaving the dashboard.
//
// Sections mirror StepProfileMd: archetypes (rich mode), location scoring,
// deal-breakers, narrative textareas. Save is gated on at least one
// archetype having a name and a non-empty exit story.

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type {
  Archetype,
  LocationScores,
  ProfileMdDraft,
  SettingsPaneId,
} from '../../../lib/types';
import { ArchetypeBuilder } from '../../Onboarding/inputs/ArchetypeBuilder';
import { LocationScoringEditor } from '../../Onboarding/inputs/LocationScoringEditor';
import { DealBreakersList } from '../../Onboarding/inputs/DealBreakersList';
import { DEFAULT_LOCATION_SCORES } from '../../Onboarding/lib/reducer';
import { useDirty } from '../lib/useDirty';
import { SETTINGS_SAVE_EVENT } from '../SettingsView';
import './PaneProfileMd.css';

interface Props {
  onDirtyChange: (pane: SettingsPaneId, isDirty: boolean) => void;
  onValidChange: (pane: SettingsPaneId, isValid: boolean) => void;
  onSaveSuccess: (pane: SettingsPaneId) => void;
  onSaveError: (pane: SettingsPaneId, message: string) => void;
}

const INITIAL_DRAFT: ProfileMdDraft = {
  archetypes: [],
  locationScores: DEFAULT_LOCATION_SCORES,
  dealBreakers: [],
  exitStory: '',
  crossCuttingAdvantage: '',
};

export function PaneProfileMd({
  onDirtyChange,
  onValidChange,
  onSaveSuccess,
  onSaveError,
}: Props) {
  const qc = useQueryClient();

  const previewQuery = useQuery({
    queryKey: ['settings', 'profileMd'],
    queryFn: () => api.loadProfileMd(),
    // The endpoint returns 404 when the file doesn't exist; we treat that
    // as "show empty preview" rather than an error.
    retry: false,
  });

  const [draft, setDraft] = useState<ProfileMdDraft>(INITIAL_DRAFT);
  const [serverError, setServerError] = useState<string | null>(null);

  const { isDirty } = useDirty(INITIAL_DRAFT, draft);

  useEffect(() => {
    onDirtyChange('profileMd', isDirty);
  }, [isDirty, onDirtyChange]);

  const isValid =
    draft.archetypes.some((a) => a.name.trim().length > 0) &&
    draft.exitStory.trim().length > 0;

  useEffect(() => {
    onValidChange('profileMd', isValid);
  }, [isValid, onValidChange]);

  const saveMutation = useMutation({
    mutationFn: (payload: ProfileMdDraft) => api.writeProfileMd(payload),
    onSuccess: () => {
      setServerError(null);
      // After a save, the structured form has done its job; we reset the
      // local draft to defaults so the dirty flag clears. The user can
      // re-open the file fresh next time.
      setDraft(INITIAL_DRAFT);
      onSaveSuccess('profileMd');
      qc.invalidateQueries({ queryKey: ['settings', 'profileMd'] });
      qc.invalidateQueries({ queryKey: ['onboarding', 'status'] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setServerError(message);
      onSaveError('profileMd', message);
    },
  });

  // Save dispatch
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pane: SettingsPaneId }>).detail;
      if (detail?.pane !== 'profileMd') return;
      if (!isValid) return;
      saveMutation.mutate(toServerDraft(draft));
    };
    document.addEventListener(SETTINGS_SAVE_EVENT, handler);
    return () => document.removeEventListener(SETTINGS_SAVE_EVENT, handler);
  }, [draft, isValid, saveMutation]);

  // Discard dispatch
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pane: SettingsPaneId }>).detail;
      if (detail?.pane !== 'profileMd') return;
      setDraft(INITIAL_DRAFT);
      setServerError(null);
    };
    document.addEventListener('settings:discard-current-pane', handler);
    return () =>
      document.removeEventListener('settings:discard-current-pane', handler);
  }, []);

  const setArchetypes = (archetypes: Archetype[]) =>
    setDraft((d) => ({ ...d, archetypes }));
  const setLocationScores = (key: keyof LocationScores, score: number) =>
    setDraft((d) => ({ ...d, locationScores: { ...d.locationScores, [key]: score } }));
  const setDealBreakers = (dealBreakers: string[]) =>
    setDraft((d) => ({ ...d, dealBreakers }));

  return (
    <div className="pane-profile-md">
      <p className="settings__banner" role="note">
        # editing structured fields here will overwrite the entire modes/_profile.md
        {'\n'}# to edit prose freely, open the file in your editor: ~/faber/modes/_profile.md
      </p>

      {serverError ? (
        <p className="settings-error" role="alert">
          # write failed · {serverError}
        </p>
      ) : null}

      <section className="onb-section">
        <h3 className="onb-section__title">target archetypes</h3>
        <p className="onb-help"># at least one role you want · saved as rich shape</p>
        <ArchetypeBuilder
          mode="rich"
          values={draft.archetypes}
          onChange={setArchetypes}
        />
      </section>

      <section className="onb-section">
        <h3 className="onb-section__title">location scoring</h3>
        <p className="onb-help"># click or use 1..5 to rate</p>
        <LocationScoringEditor
          values={draft.locationScores}
          onChange={setLocationScores}
        />
      </section>

      <section className="onb-section">
        <h3 className="onb-section__title">deal-breakers</h3>
        <p className="onb-help"># any of these in a JD and the offer is auto-skipped</p>
        <DealBreakersList values={draft.dealBreakers} onChange={setDealBreakers} />
      </section>

      <section className="onb-section">
        <h3 className="onb-section__title">narrative</h3>
        <div className="onb-narrative">
          <div className="onb-narrative__field">
            <label className="onb-narrative__field-label">exit story</label>
            <textarea
              className="onb-textarea"
              rows={4}
              placeholder="What's your story · why are you on the market"
              value={draft.exitStory}
              onChange={(e) => setDraft((d) => ({ ...d, exitStory: e.target.value }))}
            />
          </div>
          <div className="onb-narrative__field">
            <label className="onb-narrative__field-label">cross-cutting advantage</label>
            <textarea
              className="onb-textarea"
              rows={3}
              placeholder="Your signature move · what others on this list cannot do"
              value={draft.crossCuttingAdvantage}
              onChange={(e) =>
                setDraft((d) => ({ ...d, crossCuttingAdvantage: e.target.value }))
              }
            />
          </div>
        </div>
      </section>

      <details className="settings-collapse">
        <summary>
          # view current modes/_profile.md
        </summary>
        <pre className="settings-collapse__pre">
          {previewQuery.isLoading
            ? '# loading'
            : previewQuery.isError
              ? '# file not present'
              : previewQuery.data?.content ?? ''}
        </pre>
      </details>
    </div>
  );
}

function toServerDraft(draft: ProfileMdDraft): ProfileMdDraft {
  return {
    archetypes: draft.archetypes.filter((a) => a.name.trim().length > 0),
    locationScores: draft.locationScores,
    dealBreakers: draft.dealBreakers.filter((d) => d.trim().length > 0),
    exitStory: draft.exitStory.trim(),
    crossCuttingAdvantage: draft.crossCuttingAdvantage.trim(),
  };
}
