// StepProfileMd.tsx -- step 3: archetypes, scoring, deal-breakers, narrative.
//
// This is the hybrid step: structured forms for the parts that have shape
// (archetype rows, location scoring grid, deal-breakers list) and Spectral
// textareas for the prose parts (exit story, cross-cutting advantage). The
// server templates the markdown from the structured payload at commit
// time, so we never have to handle markdown synthesis client-side.

import { useEffect } from 'react';
import type { Dispatch } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type { ProfileMdDraft } from '../../../lib/types';
import { ArchetypeBuilder } from '../inputs/ArchetypeBuilder';
import { LocationScoringEditor } from '../inputs/LocationScoringEditor';
import { DealBreakersList } from '../inputs/DealBreakersList';
import { saveProfileMdDraft, clearProfileMdDraft } from '../lib/persistence';
import { EMPTY_ARCHETYPE } from '../lib/reducer';
import type { Action, OnboardingState } from '../lib/types';
import './StepProfileMd.css';

interface Props {
  state: OnboardingState;
  dispatch: Dispatch<Action>;
  onCommitted: () => void;
  onValidityChange: (valid: boolean) => void;
}

export function StepProfileMd({
  state,
  dispatch,
  onCommitted,
  onValidityChange,
}: Props) {
  const draft = state.profileMd;

  // Persist on every change
  useEffect(() => {
    saveProfileMdDraft(draft);
  }, [draft]);

  // valid = at least one archetype with a name and a non-empty exit story.
  const valid =
    draft.archetypes.some((a) => a.name.trim().length > 0) &&
    draft.exitStory.trim().length > 0;
  useEffect(() => onValidityChange(valid), [valid, onValidityChange]);

  // Pull narrative seeds from step 2's profile draft if present.
  useEffect(() => {
    if (!draft.exitStory && state.profile.narrative?.exit_story) {
      dispatch({
        type: 'PROFILE_MD_PATCH',
        patch: { exitStory: state.profile.narrative.exit_story },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.profile.narrative?.exit_story]);

  const writeMutation = useMutation({
    mutationFn: (payload: ProfileMdDraft) => api.writeProfileMd(payload),
    onSuccess: () => {
      clearProfileMdDraft();
      dispatch({ type: 'PROFILE_MD_COMMITTED' });
      onCommitted();
    },
  });

  // Listen for the modal's submit signal.
  useEffect(() => {
    const handler = () => {
      if (valid) writeMutation.mutate(toPayload(draft));
    };
    document.addEventListener('onboarding:submit-current-step', handler);
    return () =>
      document.removeEventListener('onboarding:submit-current-step', handler);
  }, [valid, draft, writeMutation]);

  // Add-archetype hotkey (Mod+Shift+A) -- the modal forwards it here via
  // a custom event so we don't have to register a global shortcut.
  useEffect(() => {
    const handler = () => {
      dispatch({
        type: 'PROFILE_MD_ARCHETYPES',
        archetypes: [...draft.archetypes, { ...EMPTY_ARCHETYPE }],
      });
    };
    document.addEventListener('onboarding:add-archetype', handler);
    return () =>
      document.removeEventListener('onboarding:add-archetype', handler);
  }, [draft.archetypes, dispatch]);

  return (
    <div className="onb-step-profile-md">
      <section className="onb-section">
        <h3 className="onb-section__title">target archetypes</h3>
        <p className="onb-help">
          # at least one role you want · adopt suggestions or write your own
        </p>
        <ArchetypeBuilder
          values={draft.archetypes}
          onChange={(archetypes) =>
            dispatch({ type: 'PROFILE_MD_ARCHETYPES', archetypes })
          }
          suggestions={state.profileSeed?.suggestedArchetypes ?? []}
        />
      </section>

      <section className="onb-section">
        <h3 className="onb-section__title">location scoring</h3>
        <p className="onb-help">
          # how each location type scores against your priorities · click or 1..5
        </p>
        <LocationScoringEditor
          values={draft.locationScores}
          onChange={(key, score) =>
            dispatch({ type: 'PROFILE_MD_LOCATION_SCORE', key, score })
          }
        />
      </section>

      <section className="onb-section">
        <h3 className="onb-section__title">deal-breakers</h3>
        <p className="onb-help">
          # any of these in a JD and the offer is auto-skipped
        </p>
        <DealBreakersList
          values={draft.dealBreakers}
          onChange={(values) =>
            dispatch({ type: 'PROFILE_MD_DEAL_BREAKERS', values })
          }
        />
      </section>

      <section className="onb-section">
        <h3 className="onb-section__title">narrative</h3>
        <div className="onb-narrative">
          <div className="onb-narrative__field">
            <label className="onb-narrative__field-label">exit story</label>
            <textarea
              className="onb-textarea"
              rows={4}
              placeholder="What's your story · why are you on the market · what shaped your point of view"
              value={draft.exitStory}
              onChange={(e) =>
                dispatch({
                  type: 'PROFILE_MD_PATCH',
                  patch: { exitStory: e.target.value },
                })
              }
            />
          </div>
          <div className="onb-narrative__field">
            <label className="onb-narrative__field-label">
              cross-cutting advantage
            </label>
            <textarea
              className="onb-textarea"
              rows={3}
              placeholder="Your signature move · what you do that others on this list cannot"
              value={draft.crossCuttingAdvantage}
              onChange={(e) =>
                dispatch({
                  type: 'PROFILE_MD_PATCH',
                  patch: { crossCuttingAdvantage: e.target.value },
                })
              }
            />
          </div>
        </div>
      </section>

      {writeMutation.isError ? (
        <p className="onb-error" role="alert">
          # write failed · {String(writeMutation.error)}
        </p>
      ) : null}
    </div>
  );
}

function toPayload(draft: ProfileMdDraft): ProfileMdDraft {
  return {
    archetypes: draft.archetypes.filter((a) => a.name.trim().length > 0),
    locationScores: draft.locationScores,
    dealBreakers: draft.dealBreakers.filter((d) => d.trim().length > 0),
    exitStory: draft.exitStory.trim(),
    crossCuttingAdvantage: draft.crossCuttingAdvantage.trim(),
  };
}
