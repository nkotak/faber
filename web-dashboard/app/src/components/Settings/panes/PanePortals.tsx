// PanePortals.tsx -- portals.yml editor.
//
// Reuses the onboarding KeywordChipInput and CompanyToggleList. The
// "use defaults" mode is omitted (Settings is always customize-mode).
// A read-only collapsible "view current portals.yml" section displays
// the on-disk raw text from the parsed-config endpoint's `raw` field.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type { PortalsConfig, SettingsPaneId } from '../../../lib/types';
import { KeywordChipInput } from '../../Onboarding/inputs/KeywordChipInput';
import {
  CompanyToggleList,
  DEFAULT_COMPANY_SECTIONS,
} from '../../Onboarding/inputs/CompanyToggleList';
import { useDirty } from '../lib/useDirty';
import { parsePortalsYaml } from '../lib/parsePortalsYaml';
import { SETTINGS_SAVE_EVENT } from '../SettingsView';
import './PanePortals.css';

interface Props {
  onDirtyChange: (pane: SettingsPaneId, isDirty: boolean) => void;
  onValidChange: (pane: SettingsPaneId, isValid: boolean) => void;
  onSaveSuccess: (pane: SettingsPaneId) => void;
  onSaveError: (pane: SettingsPaneId, message: string) => void;
}

export function PanePortals({
  onDirtyChange,
  onValidChange,
  onSaveSuccess,
  onSaveError,
}: Props) {
  const qc = useQueryClient();
  const portalsQuery = useQuery({
    queryKey: ['settings', 'portals'],
    queryFn: () => api.loadPortals(),
  });

  const initial = useMemo<PortalsConfig | null>(
    () => (portalsQuery.data ? parsePortalsYaml(portalsQuery.data.parsed) : null),
    [portalsQuery.data],
  );

  const [form, setForm] = useState<PortalsConfig | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) setForm(initial);
  }, [initial]);

  const { isDirty } = useDirty(initial ?? null, form);

  useEffect(() => {
    onDirtyChange('portals', isDirty);
  }, [isDirty, onDirtyChange]);

  // Always valid: the backend inserts sensible defaults for empty arrays.
  useEffect(() => {
    onValidChange('portals', true);
  }, [onValidChange]);

  const saveMutation = useMutation({
    mutationFn: (payload: PortalsConfig) => api.writePortals(payload),
    onSuccess: () => {
      setServerError(null);
      onSaveSuccess('portals');
      qc.invalidateQueries({ queryKey: ['settings', 'portals'] });
      qc.invalidateQueries({ queryKey: ['onboarding', 'status'] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setServerError(message);
      onSaveError('portals', message);
    },
  });

  // Save dispatch
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pane: SettingsPaneId }>).detail;
      if (detail?.pane !== 'portals') return;
      if (!form) return;
      // Settings is always in customize mode; we explicitly send useDefaults=false.
      saveMutation.mutate({ ...form, useDefaults: false });
    };
    document.addEventListener(SETTINGS_SAVE_EVENT, handler);
    return () => document.removeEventListener(SETTINGS_SAVE_EVENT, handler);
  }, [form, saveMutation]);

  // Discard dispatch
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pane: SettingsPaneId }>).detail;
      if (detail?.pane !== 'portals') return;
      if (initial) setForm(initial);
      setServerError(null);
    };
    document.addEventListener('settings:discard-current-pane', handler);
    return () =>
      document.removeEventListener('settings:discard-current-pane', handler);
  }, [initial]);

  if (portalsQuery.isLoading || !form) {
    return <p className="settings__placeholder">Reading portals.yml</p>;
  }
  if (portalsQuery.isError) {
    return (
      <p className="settings__placeholder settings__placeholder--error">
        # could not load portals.yml · {String(portalsQuery.error)}
      </p>
    );
  }

  return (
    <div className="pane-portals">
      {serverError ? (
        <p className="settings-error" role="alert">
          # write failed · {serverError}
        </p>
      ) : null}

      <section className="onb-section">
        <h3 className="onb-section__title">positive keywords</h3>
        <p className="onb-help"># one match here · keep the offer in scope</p>
        <KeywordChipInput
          ariaLabel="Positive title keywords"
          values={form.positiveKeywords}
          onChange={(positiveKeywords) =>
            setForm((prev) => (prev ? { ...prev, positiveKeywords } : prev))
          }
          placeholder="ai engineer, llmops, forward deployed"
        />
      </section>

      <section className="onb-section">
        <h3 className="onb-section__title">negative keywords</h3>
        <p className="onb-help"># any match here · skip the offer</p>
        <KeywordChipInput
          ariaLabel="Negative title keywords"
          values={form.negativeKeywords}
          onChange={(negativeKeywords) =>
            setForm((prev) => (prev ? { ...prev, negativeKeywords } : prev))
          }
          placeholder="junior, intern, salesforce admin"
          variant="negative"
        />
      </section>

      <section className="onb-section">
        <h3 className="onb-section__title">tracked companies</h3>
        <p className="onb-help"># default-on · uncheck a company to skip it during scans</p>
        <CompanyToggleList
          sections={DEFAULT_COMPANY_SECTIONS}
          overrides={form.companyOverrides}
          onChange={(companyOverrides) =>
            setForm((prev) => (prev ? { ...prev, companyOverrides } : prev))
          }
        />
      </section>

      <details className="settings-collapse">
        <summary>
          # view current portals.yml
        </summary>
        <pre className="settings-collapse__pre">
          {portalsQuery.data?.raw ?? ''}
        </pre>
      </details>
    </div>
  );
}
