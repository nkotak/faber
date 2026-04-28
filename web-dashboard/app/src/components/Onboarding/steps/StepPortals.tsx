// StepPortals.tsx -- step 4: portals.yml keyword + per-company customization.
//
// Default toggle gates everything. When "use defaults" is selected the
// customize area dims; the user clicks "customize" to drill in. The
// keyword chips and company toggles are fully controlled.

import { useEffect } from 'react';
import type { Dispatch } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type { PortalsConfig } from '../../../lib/types';
import { KeywordChipInput } from '../inputs/KeywordChipInput';
import {
  CompanyToggleList,
  DEFAULT_COMPANY_SECTIONS,
} from '../inputs/CompanyToggleList';
import { savePortalsDraft, clearPortalsDraft } from '../lib/persistence';
import type { Action, OnboardingState } from '../lib/types';
import './StepPortals.css';

interface Props {
  state: OnboardingState;
  dispatch: Dispatch<Action>;
  onCommitted: () => void;
  onValidityChange: (valid: boolean) => void;
}

export function StepPortals({
  state,
  dispatch,
  onCommitted,
  onValidityChange,
}: Props) {
  const draft = state.portals;

  // Persist on every change
  useEffect(() => {
    savePortalsDraft(draft);
  }, [draft]);

  // Always valid: defaults work for everyone, customize requires no minimums
  // because the server inserts sensible fallbacks.
  useEffect(() => onValidityChange(true), [onValidityChange]);

  const writeMutation = useMutation({
    mutationFn: (payload: PortalsConfig) => api.writePortals(payload),
    onSuccess: () => {
      clearPortalsDraft();
      dispatch({ type: 'PORTALS_COMMITTED' });
      onCommitted();
    },
  });

  useEffect(() => {
    const handler = () => writeMutation.mutate(draft);
    document.addEventListener('onboarding:submit-current-step', handler);
    return () =>
      document.removeEventListener('onboarding:submit-current-step', handler);
  }, [draft, writeMutation]);

  return (
    <div className="onb-step-portals">
      <div className="onb-step-portals__toggle" role="radiogroup" aria-label="Portal customization">
        <button
          type="button"
          role="radio"
          aria-checked={draft.useDefaults}
          className={`onb-step-portals__choice${
            draft.useDefaults ? ' onb-step-portals__choice--active' : ''
          }`}
          onClick={() =>
            dispatch({ type: 'PORTALS_PATCH', patch: { useDefaults: true } })
          }
        >
          <span className="onb-step-portals__choice-radio">
            <span className="onb-step-portals__choice-radio-dot" />
            <span className="onb-step-portals__choice-title">use defaults</span>
          </span>
          <span className="onb-step-portals__choice-hint">
            # 45 companies · 23 search queries · all toggles on
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!draft.useDefaults}
          className={`onb-step-portals__choice${
            !draft.useDefaults ? ' onb-step-portals__choice--active' : ''
          }`}
          onClick={() =>
            dispatch({ type: 'PORTALS_PATCH', patch: { useDefaults: false } })
          }
        >
          <span className="onb-step-portals__choice-radio">
            <span className="onb-step-portals__choice-radio-dot" />
            <span className="onb-step-portals__choice-title">customize</span>
          </span>
          <span className="onb-step-portals__choice-hint">
            # tune keywords and pick which companies to scan
          </span>
        </button>
      </div>

      <div
        className={`onb-step-portals__customize${
          draft.useDefaults ? ' onb-dim' : ''
        }`}
        aria-hidden={draft.useDefaults || undefined}
      >
        <section className="onb-section">
          <h3 className="onb-section__title">positive keywords</h3>
          <p className="onb-help">
            # one match here · keep the offer in scope
          </p>
          <KeywordChipInput
            ariaLabel="Positive title keywords"
            values={draft.positiveKeywords}
            onChange={(positiveKeywords) =>
              dispatch({ type: 'PORTALS_PATCH', patch: { positiveKeywords } })
            }
            placeholder="ai engineer, llmops, forward deployed…"
          />
        </section>

        <section className="onb-section">
          <h3 className="onb-section__title">negative keywords</h3>
          <p className="onb-help">
            # any match here · skip the offer
          </p>
          <KeywordChipInput
            ariaLabel="Negative title keywords"
            values={draft.negativeKeywords}
            onChange={(negativeKeywords) =>
              dispatch({ type: 'PORTALS_PATCH', patch: { negativeKeywords } })
            }
            placeholder="junior, intern, .NET, salesforce admin…"
            variant="negative"
          />
        </section>

        <section className="onb-section">
          <h3 className="onb-section__title">tracked companies</h3>
          <p className="onb-help">
            # default-on · uncheck a company to skip it during scans
          </p>
          <CompanyToggleList
            sections={DEFAULT_COMPANY_SECTIONS}
            overrides={draft.companyOverrides}
            onChange={(companyOverrides) =>
              dispatch({ type: 'PORTALS_PATCH', patch: { companyOverrides } })
            }
          />
        </section>
      </div>

      {writeMutation.isError ? (
        <p className="onb-error" role="alert">
          # write failed · {String(writeMutation.error)}
        </p>
      ) : null}
    </div>
  );
}
