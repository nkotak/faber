// PaneProfile.tsx -- full structured form for config/profile.yml.
//
// Sections mirror config/profile.example.yml: candidate, target_roles,
// narrative (with proof_points + dashboard demo), compensation, location.
// Reuses .onb-* form classes from OnboardingForms.css so the look matches
// onboarding's StepProfile.
//
// Save flow: POST /api/onboarding/profile (existing endpoint). The zod
// schema accepts every field including the optional ones onboarding step 2
// skipped (twitter, narrative.headline, proof_points, dashboard,
// onsite_availability).

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type {
  Archetype,
  ProfileYaml,
  ProofPoint,
  SettingsPaneId,
} from '../../../lib/types';
import { ArchetypeBuilder } from '../../Onboarding/inputs/ArchetypeBuilder';
import { KeywordChipInput } from '../../Onboarding/inputs/KeywordChipInput';
import { useDirty } from '../lib/useDirty';
import { parseProfileYaml } from '../lib/parseProfileYaml';
import type { ProfileYamlForm } from '../lib/types';
import { SETTINGS_SAVE_EVENT } from '../SettingsView';
import './PaneProfile.css';

interface Props {
  onDirtyChange: (pane: SettingsPaneId, isDirty: boolean) => void;
  onValidChange: (pane: SettingsPaneId, isValid: boolean) => void;
  onSaveSuccess: (pane: SettingsPaneId) => void;
  onSaveError: (pane: SettingsPaneId, message: string) => void;
}

const CURRENCIES: ProfileYaml['compensation']['currency'][] = [
  'USD',
  'GBP',
  'EUR',
  'CAD',
  'AUD',
];

export function PaneProfile({
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

  const initial = useMemo<ProfileYamlForm | null>(
    () => (profileQuery.data ? parseProfileYaml(profileQuery.data.parsed) : null),
    [profileQuery.data],
  );

  const [form, setForm] = useState<ProfileYamlForm | null>(null);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset form when initial changes (i.e. after a save refetch).
  useEffect(() => {
    if (initial) setForm(initial);
  }, [initial]);

  const { isDirty } = useDirty(initial ?? null, form);

  useEffect(() => {
    onDirtyChange('profile', isDirty);
  }, [isDirty, onDirtyChange]);

  const isValid = useMemo(() => isFormValid(form), [form]);

  useEffect(() => {
    onValidChange('profile', isValid);
  }, [isValid, onValidChange]);

  const saveMutation = useMutation({
    mutationFn: (payload: ProfileYaml) => api.writeProfile(payload),
    onSuccess: () => {
      setServerError(null);
      onSaveSuccess('profile');
      qc.invalidateQueries({ queryKey: ['settings', 'profile'] });
      qc.invalidateQueries({ queryKey: ['onboarding', 'status'] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setServerError(message);
      onSaveError('profile', message);
    },
  });

  // Listen for save dispatch from SettingsView.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pane: SettingsPaneId }>).detail;
      if (detail?.pane !== 'profile') return;
      if (!form) return;
      saveMutation.mutate(toServerPayload(form));
    };
    document.addEventListener(SETTINGS_SAVE_EVENT, handler);
    return () => document.removeEventListener(SETTINGS_SAVE_EVENT, handler);
  }, [form, saveMutation]);

  // Listen for discard dispatch — revert to initial.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ pane: SettingsPaneId }>).detail;
      if (detail?.pane !== 'profile') return;
      if (initial) setForm(initial);
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

  // Adapter: ProfileYamlForm uses ArchetypeSlim; ArchetypeBuilder consumes
  // the rich Archetype shape. We carry empty axes/whatTheyBuy through and
  // strip them in the save transformer.
  const archetypeRich: Archetype[] = form.target_roles.archetypes.map((a) => ({
    name: a.name,
    axes: '',
    whatTheyBuy: '',
    fit: a.fit,
    level: a.level,
  }));

  return (
    <form
      className="pane-profile"
      onSubmit={(e) => e.preventDefault()}
    >
      {serverError ? (
        <p className="settings-error" role="alert">
          # write failed · {serverError}
        </p>
      ) : null}

      {/* candidate */}
      <section className="onb-section">
        <h3 className="onb-section__title">candidate</h3>
        <div className="onb-grid">
          <Field
            label="Full name"
            required
            value={form.candidate.full_name}
            onChange={(v) => patch(setForm, { candidate: { ...form.candidate, full_name: v } })}
          />
          <Field
            label="Email"
            required
            type="email"
            value={form.candidate.email}
            error={form.candidate.email && !isEmail(form.candidate.email) ? 'invalid format' : null}
            onChange={(v) => patch(setForm, { candidate: { ...form.candidate, email: v } })}
          />
          <Field
            label="Phone"
            value={form.candidate.phone}
            onChange={(v) => patch(setForm, { candidate: { ...form.candidate, phone: v } })}
          />
          <Field
            label="Location"
            required
            value={form.candidate.location}
            placeholder="City, Country"
            onChange={(v) => patch(setForm, { candidate: { ...form.candidate, location: v } })}
          />
          <Field
            label="LinkedIn"
            value={form.candidate.linkedin}
            placeholder="linkedin.com/in/you"
            onChange={(v) => patch(setForm, { candidate: { ...form.candidate, linkedin: v } })}
          />
          <Field
            label="Portfolio"
            value={form.candidate.portfolio_url}
            placeholder="https://you.dev"
            onChange={(v) => patch(setForm, { candidate: { ...form.candidate, portfolio_url: v } })}
          />
          <Field
            label="GitHub"
            value={form.candidate.github}
            placeholder="github.com/you"
            onChange={(v) => patch(setForm, { candidate: { ...form.candidate, github: v } })}
          />
          <Field
            label="Twitter"
            value={form.candidate.twitter}
            placeholder="twitter.com/you"
            onChange={(v) => patch(setForm, { candidate: { ...form.candidate, twitter: v } })}
          />
          <Field
            label="Canva resume id"
            value={form.candidate.canva_resume_design_id}
            placeholder="canva design id (optional)"
            onChange={(v) =>
              patch(setForm, { candidate: { ...form.candidate, canva_resume_design_id: v } })
            }
          />
        </div>
      </section>

      {/* target roles */}
      <section className="onb-section">
        <h3 className="onb-section__title">target roles</h3>
        <div className="onb-grid">
          <span className="onb-field__label onb-field__label--required">Primary roles</span>
          <div className="onb-field__control">
            <KeywordChipInput
              ariaLabel="Primary target roles"
              values={form.target_roles.primary}
              onChange={(primary) =>
                patch(setForm, { target_roles: { ...form.target_roles, primary } })
              }
              placeholder="Senior Backend Engineer, Staff PM"
            />
          </div>
        </div>
        <div className="settings-section settings-section--divided">
          <p className="onb-help"># archetypes for slim profile.yml mapping</p>
          <ArchetypeBuilder
            mode="slim"
            values={archetypeRich}
            onChange={(rows) =>
              patch(setForm, {
                target_roles: {
                  ...form.target_roles,
                  archetypes: rows.map((r) => ({
                    name: r.name,
                    level: r.level ?? '',
                    fit: r.fit,
                  })),
                },
              })
            }
          />
        </div>
      </section>

      {/* narrative */}
      <section className="onb-section">
        <h3 className="onb-section__title">narrative</h3>
        <div className="onb-grid">
          <Field
            label="Headline"
            value={form.narrative.headline}
            placeholder="One line that frames every application"
            onChange={(v) => patch(setForm, { narrative: { ...form.narrative, headline: v } })}
          />
        </div>
        <div className="settings-section settings-section--divided">
          <label className="onb-field__label">Exit story</label>
          <textarea
            className="onb-textarea"
            rows={4}
            placeholder="Why are you on the market"
            value={form.narrative.exit_story}
            onChange={(e) =>
              patch(setForm, { narrative: { ...form.narrative, exit_story: e.target.value } })
            }
          />
        </div>
        <div className="settings-section settings-section--divided">
          <span className="onb-field__label">Superpowers</span>
          <KeywordChipInput
            ariaLabel="Superpowers"
            values={form.narrative.superpowers}
            onChange={(superpowers) =>
              patch(setForm, { narrative: { ...form.narrative, superpowers } })
            }
            placeholder="ship to prod, prompt evals, lead reviews"
          />
        </div>
        <ProofPointsList
          values={form.narrative.proof_points}
          onChange={(proof_points) =>
            patch(setForm, { narrative: { ...form.narrative, proof_points } })
          }
        />
        <details
          className="settings-collapse"
          open={dashboardOpen}
          onToggle={(e) => setDashboardOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>
            # dashboard demo (optional)
          </summary>
          <div className="onb-grid settings-collapse__body">
            <Field
              label="URL"
              value={form.narrative.dashboard.url}
              placeholder="https://dashboard.example.com"
              onChange={(v) =>
                patch(setForm, {
                  narrative: {
                    ...form.narrative,
                    dashboard: { ...form.narrative.dashboard, url: v },
                  },
                })
              }
            />
            <Field
              label="Password"
              value={form.narrative.dashboard.password}
              onChange={(v) =>
                patch(setForm, {
                  narrative: {
                    ...form.narrative,
                    dashboard: { ...form.narrative.dashboard, password: v },
                  },
                })
              }
            />
          </div>
        </details>
      </section>

      {/* compensation */}
      <section className="onb-section">
        <h3 className="onb-section__title">compensation</h3>
        <div className="onb-grid">
          <Field
            label="Target range"
            required
            value={form.compensation.target_range}
            placeholder="$150K-200K"
            onChange={(v) =>
              patch(setForm, { compensation: { ...form.compensation, target_range: v } })
            }
          />
          <SelectField
            label="Currency"
            required
            value={form.compensation.currency}
            options={CURRENCIES}
            onChange={(v) =>
              patch(setForm, { compensation: { ...form.compensation, currency: v } })
            }
          />
          <Field
            label="Minimum"
            required
            value={form.compensation.minimum}
            placeholder="$120K"
            onChange={(v) =>
              patch(setForm, { compensation: { ...form.compensation, minimum: v } })
            }
          />
          <Field
            label="Flexibility"
            value={form.compensation.location_flexibility}
            placeholder="Remote preferred, 1 wk/mo on-site possible"
            onChange={(v) =>
              patch(setForm, {
                compensation: { ...form.compensation, location_flexibility: v },
              })
            }
          />
        </div>
      </section>

      {/* location */}
      <section className="onb-section">
        <h3 className="onb-section__title">location</h3>
        <div className="onb-grid">
          <Field
            label="Country"
            required
            value={form.location.country}
            onChange={(v) => patch(setForm, { location: { ...form.location, country: v } })}
          />
          <Field
            label="City"
            required
            value={form.location.city}
            onChange={(v) => patch(setForm, { location: { ...form.location, city: v } })}
          />
          <Field
            label="Timezone"
            required
            value={form.location.timezone}
            placeholder="America/New_York"
            onChange={(v) => patch(setForm, { location: { ...form.location, timezone: v } })}
          />
          <Field
            label="Visa status"
            value={form.location.visa_status}
            placeholder="No sponsorship needed"
            onChange={(v) =>
              patch(setForm, { location: { ...form.location, visa_status: v } })
            }
          />
          <Field
            label="Onsite availability"
            value={form.location.onsite_availability}
            placeholder="2 days/week in metro"
            onChange={(v) =>
              patch(setForm, { location: { ...form.location, onsite_availability: v } })
            }
          />
        </div>
      </section>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function patch(
  setForm: React.Dispatch<React.SetStateAction<ProfileYamlForm | null>>,
  patch: Partial<ProfileYamlForm>,
): void {
  setForm((prev) => (prev ? { ...prev, ...patch } : prev));
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isFormValid(form: ProfileYamlForm | null): boolean {
  if (!form) return false;
  const c = form.candidate;
  const comp = form.compensation;
  const loc = form.location;
  if (!c.full_name.trim()) return false;
  if (!c.email.trim() || !isEmail(c.email)) return false;
  if (!c.location.trim()) return false;
  if (!form.target_roles.primary.length) return false;
  if (!comp.target_range.trim()) return false;
  if (!comp.minimum.trim()) return false;
  if (!loc.country.trim()) return false;
  if (!loc.city.trim()) return false;
  if (!loc.timezone.trim()) return false;
  return true;
}

/** Build the wire payload accepted by the existing /api/onboarding/profile
 * zod schema. The schema is .strict(), so we only emit fields it knows
 * about; arrays default to []. */
function toServerPayload(form: ProfileYamlForm): ProfileYaml {
  // The Zod schema accepts the full shape (including the slim archetypes
  // and dashboard fields). The TS ProfileYaml interface is the narrower
  // public type used by api.writeProfile; we cast safely because every
  // optional we carry is already valid against the schema.
  const payload = {
    candidate: {
      full_name: form.candidate.full_name.trim(),
      email: form.candidate.email.trim(),
      phone: form.candidate.phone,
      location: form.candidate.location.trim(),
      linkedin: form.candidate.linkedin,
      portfolio_url: form.candidate.portfolio_url,
      github: form.candidate.github,
      twitter: form.candidate.twitter,
      canva_resume_design_id: form.candidate.canva_resume_design_id,
    },
    target_roles: {
      primary: form.target_roles.primary,
      archetypes: form.target_roles.archetypes
        .filter((a) => a.name.trim())
        .map((a) => ({
          name: a.name.trim(),
          level: (a.level || '').trim(),
          fit: a.fit,
        })),
    },
    narrative: {
      headline: form.narrative.headline,
      exit_story: form.narrative.exit_story,
      superpowers: form.narrative.superpowers,
      proof_points: form.narrative.proof_points
        .filter((p) => p.name.trim())
        .map((p) => ({
          name: p.name.trim(),
          url: p.url,
          hero_metric: p.hero_metric,
        })),
      // Dashboard demo block: only include when at least one field is set.
      // Backend zod treats narrative.dashboard as optional; the writer
      // drops empty blocks before serialization.
      ...(form.narrative.dashboard.url.trim() || form.narrative.dashboard.password.trim()
        ? {
            dashboard: {
              url: form.narrative.dashboard.url,
              password: form.narrative.dashboard.password,
            },
          }
        : {}),
    },
    compensation: {
      target_range: form.compensation.target_range,
      currency: form.compensation.currency,
      minimum: form.compensation.minimum,
      location_flexibility: form.compensation.location_flexibility,
    },
    location: {
      country: form.location.country,
      city: form.location.city,
      timezone: form.location.timezone,
      visa_status: form.location.visa_status,
      onsite_availability: form.location.onsite_availability,
    },
  };

  return payload as unknown as ProfileYaml;
}

// ---------------------------------------------------------------------------
// Field components
// ---------------------------------------------------------------------------

function Field({
  label,
  required,
  value,
  onChange,
  type,
  placeholder,
  error,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  error?: string | null;
}) {
  return (
    <div className="onb-field">
      <label className={`onb-field__label${required ? ' onb-field__label--required' : ''}`}>
        {label}
      </label>
      <div className="onb-field__control">
        <input
          type={type ?? 'text'}
          className={`onb-input${error ? ' onb-input--invalid' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        {error ? (
          <span className="onb-error">
            # {label.toLowerCase()} · {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SelectField<T extends string>({
  label,
  required,
  value,
  options,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="onb-field">
      <label className={`onb-field__label${required ? ' onb-field__label--required' : ''}`}>
        {label}
      </label>
      <div className="onb-field__control">
        <select
          className="onb-select"
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proof points sub-form
// ---------------------------------------------------------------------------

function ProofPointsList({
  values,
  onChange,
}: {
  values: ProofPoint[];
  onChange: (next: ProofPoint[]) => void;
}) {
  const update = (i: number, patch: Partial<ProofPoint>) => {
    onChange(values.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  };
  const remove = (i: number) => onChange(values.filter((_, j) => j !== i));
  const add = () => onChange([...values, { name: '', url: '', hero_metric: '' }]);

  return (
    <div className="settings-section settings-section--divided">
      <div className="pane-profile__proof-header">
        <span className="onb-field__label">Proof points</span>
      </div>
      <ul className="pane-profile__proof-list">
        {values.map((row, i) => (
          <li className="pane-profile__proof-row" key={i}>
            <input
              className="onb-input"
              placeholder="name"
              value={row.name}
              onChange={(e) => update(i, { name: e.target.value })}
              aria-label="proof point name"
            />
            <input
              className="onb-input"
              placeholder="url (optional)"
              value={row.url}
              onChange={(e) => update(i, { url: e.target.value })}
              aria-label="proof point url"
            />
            <input
              className="onb-input"
              placeholder="hero metric (optional)"
              value={row.hero_metric}
              onChange={(e) => update(i, { hero_metric: e.target.value })}
              aria-label="proof point hero metric"
            />
            <button
              type="button"
              className="onb-chip__close"
              onClick={() => remove(i)}
              aria-label={`remove proof point ${row.name}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="onb-btn pane-profile__proof-add" onClick={add}>
        + add proof point
      </button>
    </div>
  );
}

