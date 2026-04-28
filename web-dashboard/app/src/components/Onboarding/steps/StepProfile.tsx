// StepProfile.tsx -- step 2: structured config/profile.yml form.
//
// Two-column field grid (label + control). Auto-fills from the parse job's
// profileSeed payload — but ONLY for empty fields, never clobbering work
// the user has already done. The fill is one-shot on first mount; subsequent
// seed changes do not overwrite typed data.

import { useEffect, useMemo, useState } from 'react';
import type { Dispatch } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type { ProfileYaml } from '../../../lib/types';
import { saveProfileDraft, clearProfileDraft } from '../lib/persistence';
import type { Action, OnboardingState, StepProfileDraft } from '../lib/types';

interface Props {
  state: OnboardingState;
  dispatch: Dispatch<Action>;
  onCommitted: () => void;
  onValidityChange: (valid: boolean) => void;
}

const CURRENCIES: ProfileYaml['compensation']['currency'][] = [
  'USD',
  'GBP',
  'EUR',
  'CAD',
  'AUD',
];

// IANA timezone list. Modern browsers (Chrome 99+/Firefox 93+/Safari 15.4+)
// expose ~600 zones via Intl.supportedValuesOf('timeZone'). We use a guarded
// fallback list of common zones for older runtimes so the form never breaks.
// Native <select> handles 600 entries fine — browsers do type-ahead within
// open dropdowns, so users can hit "L" then arrows to find Europe/London.
const TIMEZONES: readonly string[] = (() => {
  try {
    const intl = Intl as unknown as {
      supportedValuesOf?: (k: string) => string[];
    };
    if (typeof intl.supportedValuesOf === 'function') {
      return intl.supportedValuesOf('timeZone');
    }
  } catch {
    // fall through to the curated list below
  }
  return [
    'America/New_York', 'America/Chicago', 'America/Denver',
    'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
    'America/Toronto', 'America/Vancouver', 'America/Mexico_City',
    'America/Sao_Paulo', 'America/Buenos_Aires',
    'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin',
    'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Stockholm',
    'Europe/Warsaw', 'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore',
    'Asia/Seoul', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Tel_Aviv',
    'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland',
    'Africa/Johannesburg', 'Africa/Cairo', 'Africa/Lagos',
    'UTC',
  ];
})();

// Compensation tiers used by Target min / Target max / Minimum dropdowns.
// Wide-enough range to cover from new-grad to staff-plus; equal $25K steps up
// to $300K, $50K up to $500K, then doubling. The labels are the persisted
// values (saved into profile.yml as "$XK-$YK" / "$ZK").
const COMP_TIERS = [
  '$50K', '$75K', '$100K', '$125K', '$150K', '$175K', '$200K',
  '$225K', '$250K', '$275K', '$300K', '$350K', '$400K', '$450K',
  '$500K', '$600K', '$750K', '$1M+',
] as const;
type CompTier = typeof COMP_TIERS[number];

function compToInt(tier: string): number {
  // '$1M+' → 1000; '$200K' → 200; '' → -1 so it sorts before any real tier.
  if (!tier) return -1;
  if (tier.endsWith('M+')) return 1000;
  const m = tier.match(/^\$(\d+)K$/);
  return m ? Number(m[1]) : -1;
}

function parseRange(range: string | undefined | null): { min: string; max: string } {
  if (!range) return { min: '', max: '' };
  // Split on the FIRST '-'. This must tolerate partial states ("$200K-",
  // "-$300K") so a half-filled selection round-trips through dispatch+rerender
  // without erasing what the user just picked. The previous regex required
  // both sides to match — so picking only Target min wrote target_range='',
  // which on re-render parsed back to {min:'', max:''} and snapped the
  // dropdown to its placeholder. See StepProfile bug analysis for full trace.
  const idx = range.indexOf('-');
  if (idx === -1) return { min: '', max: '' };
  return {
    min: range.slice(0, idx).trim(),
    max: range.slice(idx + 1).trim(),
  };
}

function formatRange(min: string, max: string): string {
  // Partial state allowed: "$200K-" (max not picked), "-$300K" (min not picked),
  // "$200K-$300K" (both). Empty when neither is picked. validateDraft enforces
  // both-required for "valid" — this just preserves the user's in-flight pick.
  if (!min && !max) return '';
  return `${min}-${max}`;
}

export function StepProfile({
  state,
  dispatch,
  onCommitted,
  onValidityChange,
}: Props) {
  const draft = state.profile;
  const [hydrated, setHydrated] = useState(false);

  // One-shot hydration from CV-derived seed: only fill empty fields. After
  // the first commit-or-touch, we never overwrite again.
  useEffect(() => {
    if (hydrated) return;
    const seed = state.profileSeed;
    if (!seed) return;
    const tz =
      typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : '';
    const proposed: Partial<ProfileYaml> = {
      candidate: {
        full_name: draft.candidate?.full_name ?? seed.fullName ?? '',
        email: draft.candidate?.email ?? seed.email ?? '',
        phone: draft.candidate?.phone ?? seed.phone ?? '',
        location: draft.candidate?.location ?? seed.location ?? '',
        linkedin: draft.candidate?.linkedin ?? seed.linkedin ?? '',
        portfolio_url: draft.candidate?.portfolio_url ?? seed.portfolioUrl ?? '',
        github: draft.candidate?.github ?? seed.github ?? '',
      },
      target_roles: {
        primary: draft.target_roles?.primary?.length
          ? draft.target_roles.primary
          : seed.targetRoles ?? [],
      },
      narrative: {
        exit_story: draft.narrative?.exit_story ?? seed.exitStory ?? '',
        superpowers:
          draft.narrative?.superpowers?.length
            ? draft.narrative.superpowers
            : seed.superpowers ?? [],
      },
      location: {
        country: draft.location?.country ?? '',
        city: draft.location?.city ?? '',
        timezone: draft.location?.timezone ?? tz,
        visa_status: draft.location?.visa_status ?? '',
      },
    };
    dispatch({ type: 'PROFILE_PATCH', patch: proposed });
    setHydrated(true);
    // intentionally only depend on seed/hydrated; we don't want to refire
    // when the user starts typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.profileSeed, hydrated]);

  // Persist on every patch
  useEffect(() => {
    if (!hydrated) return;
    saveProfileDraft(draft);
  }, [draft, hydrated]);

  const { valid, missing } = validateDraft(draft);
  useEffect(() => onValidityChange(valid), [valid, onValidityChange]);

  const writeMutation = useMutation({
    mutationFn: (payload: ProfileYaml) => api.writeProfile(payload),
    onSuccess: () => {
      clearProfileDraft();
      dispatch({ type: 'PROFILE_COMMITTED' });
      onCommitted();
    },
  });

  // Build a complete payload only on submit; the form holds Partial<ProfileYaml>
  const payload = useMemo<ProfileYaml | null>(
    () => (valid ? toPayload(draft) : null),
    [valid, draft],
  );

  const submit = () => {
    if (!payload) return;
    writeMutation.mutate(payload);
  };

  // Listen for the form-submit signal the modal raises on Enter / Mod+→.
  useEffect(() => {
    const handler = () => submit();
    document.addEventListener('onboarding:submit-current-step', handler);
    return () =>
      document.removeEventListener('onboarding:submit-current-step', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  return (
    <form
      className="onb-step-profile"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/* candidate */}
      <section className="onb-section">
        <h3 className="onb-section__title">candidate</h3>
        <div className="onb-grid">
          <Field
            label="Full name"
            required
            value={draft.candidate?.full_name ?? ''}
            onChange={(v) =>
              dispatch({
                type: 'PROFILE_PATCH',
                patch: { candidate: { ...draft.candidate, full_name: v } as ProfileYaml['candidate'] },
              })
            }
          />
          <Field
            label="Email"
            required
            type="email"
            value={draft.candidate?.email ?? ''}
            error={
              draft.candidate?.email && !isEmail(draft.candidate.email)
                ? 'invalid format'
                : null
            }
            onChange={(v) =>
              dispatch({
                type: 'PROFILE_PATCH',
                patch: { candidate: { ...draft.candidate, email: v } as ProfileYaml['candidate'] },
              })
            }
          />
          <Field
            label="Phone"
            value={draft.candidate?.phone ?? ''}
            onChange={(v) =>
              dispatch({
                type: 'PROFILE_PATCH',
                patch: { candidate: { ...draft.candidate, phone: v } as ProfileYaml['candidate'] },
              })
            }
          />
          <Field
            label="Location"
            required
            value={draft.candidate?.location ?? ''}
            placeholder="City, Country"
            onChange={(v) =>
              dispatch({
                type: 'PROFILE_PATCH',
                patch: { candidate: { ...draft.candidate, location: v } as ProfileYaml['candidate'] },
              })
            }
          />
          <Field
            label="LinkedIn"
            value={draft.candidate?.linkedin ?? ''}
            placeholder="linkedin.com/in/you"
            onChange={(v) =>
              dispatch({
                type: 'PROFILE_PATCH',
                patch: { candidate: { ...draft.candidate, linkedin: v } as ProfileYaml['candidate'] },
              })
            }
          />
          <Field
            label="Portfolio"
            value={draft.candidate?.portfolio_url ?? ''}
            placeholder="https://you.dev"
            onChange={(v) =>
              dispatch({
                type: 'PROFILE_PATCH',
                patch: { candidate: { ...draft.candidate, portfolio_url: v } as ProfileYaml['candidate'] },
              })
            }
          />
          <Field
            label="GitHub"
            value={draft.candidate?.github ?? ''}
            placeholder="github.com/you"
            onChange={(v) =>
              dispatch({
                type: 'PROFILE_PATCH',
                patch: { candidate: { ...draft.candidate, github: v } as ProfileYaml['candidate'] },
              })
            }
          />
        </div>
      </section>

      {/* compensation */}
      <section className="onb-section">
        <h3 className="onb-section__title">compensation</h3>
        <div className="onb-grid">
          <SelectField
            label="Target min"
            required
            placeholder="— select —"
            value={parseRange(draft.compensation?.target_range).min}
            options={COMP_TIERS}
            onChange={(v) => {
              const cur = parseRange(draft.compensation?.target_range);
              dispatch({
                type: 'PROFILE_PATCH',
                patch: {
                  compensation: {
                    ...draft.compensation,
                    target_range: formatRange(v, cur.max),
                  } as ProfileYaml['compensation'],
                },
              });
            }}
          />
          <SelectField
            label="Target max"
            required
            placeholder="— select —"
            value={parseRange(draft.compensation?.target_range).max}
            // Disable max options below the selected min so the range is sane.
            options={COMP_TIERS.filter((o) => {
              const min = parseRange(draft.compensation?.target_range).min;
              return !min || compToInt(o) >= compToInt(min);
            }) as readonly CompTier[]}
            onChange={(v) => {
              const cur = parseRange(draft.compensation?.target_range);
              dispatch({
                type: 'PROFILE_PATCH',
                patch: {
                  compensation: {
                    ...draft.compensation,
                    target_range: formatRange(cur.min, v),
                  } as ProfileYaml['compensation'],
                },
              });
            }}
          />
          <SelectField
            label="Currency"
            required
            value={draft.compensation?.currency ?? 'USD'}
            options={CURRENCIES}
            onChange={(v) =>
              dispatch({
                type: 'PROFILE_PATCH',
                patch: {
                  compensation: {
                    ...draft.compensation,
                    currency: v as ProfileYaml['compensation']['currency'],
                  } as ProfileYaml['compensation'],
                },
              })
            }
          />
          <SelectField
            label="Minimum"
            required
            placeholder="— select —"
            value={draft.compensation?.minimum ?? ''}
            // Walk-away can't exceed the target min (otherwise the floor is
            // higher than the desired floor — would make every offer reject).
            options={COMP_TIERS.filter((o) => {
              const tMin = parseRange(draft.compensation?.target_range).min;
              return !tMin || compToInt(o) <= compToInt(tMin);
            }) as readonly CompTier[]}
            onChange={(v) =>
              dispatch({
                type: 'PROFILE_PATCH',
                patch: {
                  compensation: {
                    ...draft.compensation,
                    minimum: v,
                  } as ProfileYaml['compensation'],
                },
              })
            }
          />
          <Field
            label="Flexibility"
            value={draft.compensation?.location_flexibility ?? ''}
            placeholder="Remote preferred, 1 wk/mo on-site possible"
            onChange={(v) =>
              dispatch({
                type: 'PROFILE_PATCH',
                patch: {
                  compensation: {
                    ...draft.compensation,
                    location_flexibility: v,
                  } as ProfileYaml['compensation'],
                },
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
            value={draft.location?.country ?? ''}
            onChange={(v) =>
              dispatch({
                type: 'PROFILE_PATCH',
                patch: { location: { ...draft.location, country: v } as ProfileYaml['location'] },
              })
            }
          />
          <Field
            label="City"
            required
            value={draft.location?.city ?? ''}
            onChange={(v) =>
              dispatch({
                type: 'PROFILE_PATCH',
                patch: { location: { ...draft.location, city: v } as ProfileYaml['location'] },
              })
            }
          />
          <SelectField
            label="Timezone"
            required
            placeholder="— select —"
            value={draft.location?.timezone ?? ''}
            options={TIMEZONES}
            onChange={(v) =>
              dispatch({
                type: 'PROFILE_PATCH',
                patch: { location: { ...draft.location, timezone: v } as ProfileYaml['location'] },
              })
            }
          />
          <Field
            label="Visa status"
            value={draft.location?.visa_status ?? ''}
            placeholder="No sponsorship needed"
            onChange={(v) =>
              dispatch({
                type: 'PROFILE_PATCH',
                patch: { location: { ...draft.location, visa_status: v } as ProfileYaml['location'] },
              })
            }
          />
        </div>
      </section>

      {missing.length > 0 ? (
        <p className="onb-help" role="status">
          # to continue, fill: {missing.join(', ')}
        </p>
      ) : null}

      {writeMutation.isError ? (
        <p className="onb-error" role="alert">
          # write failed · {String(writeMutation.error)}
        </p>
      ) : null}
    </form>
  );
}

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
      <label
        className={`onb-field__label${
          required ? ' onb-field__label--required' : ''
        }`}
      >
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
  placeholder,
}: {
  label: string;
  required?: boolean;
  value: T | '';
  options: readonly T[];
  onChange: (v: T) => void;
  placeholder?: string;
}) {
  return (
    <div className="onb-field">
      <label
        className={`onb-field__label${
          required ? ' onb-field__label--required' : ''
        }`}
      >
        {label}
      </label>
      <div className="onb-field__control">
        <select
          className="onb-select"
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
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

function isEmail(v: string): boolean {
  // Permissive RFC-ish check; the server does the strict one.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Validate the draft and return a list of missing-required-field labels.
 *  Used both to gate the Next button and to surface a single-line hint at the
 *  bottom of the form so users know exactly what's blocking them. */
function validateDraft(draft: StepProfileDraft): {
  valid: boolean;
  missing: string[];
} {
  const c = draft.candidate;
  const comp = draft.compensation;
  const loc = draft.location;
  const range = parseRange(comp?.target_range);
  const missing: string[] = [];
  if (!c?.full_name?.trim()) missing.push('full name');
  if (!c?.email?.trim() || !isEmail(c?.email ?? '')) missing.push('email');
  if (!c?.location?.trim()) missing.push('location');
  if (!range.min) missing.push('target min');
  if (!range.max) missing.push('target max');
  if (!comp?.currency) missing.push('currency');
  if (!comp?.minimum?.trim()) missing.push('minimum');
  if (!loc?.country?.trim()) missing.push('country');
  if (!loc?.city?.trim()) missing.push('city');
  if (!loc?.timezone?.trim()) missing.push('timezone');
  return { valid: missing.length === 0, missing };
}

function toPayload(draft: StepProfileDraft): ProfileYaml {
  const c: Partial<ProfileYaml['candidate']> = draft.candidate ?? {};
  return {
    candidate: {
      full_name: c.full_name ?? '',
      email: c.email ?? '',
      phone: c.phone,
      location: c.location ?? '',
      linkedin: c.linkedin,
      portfolio_url: c.portfolio_url,
      github: c.github,
    },
    target_roles: {
      primary: draft.target_roles?.primary ?? [],
    },
    narrative: {
      exit_story: draft.narrative?.exit_story,
      superpowers: draft.narrative?.superpowers,
    },
    compensation: {
      target_range: draft.compensation?.target_range ?? '',
      currency: draft.compensation?.currency ?? 'USD',
      minimum: draft.compensation?.minimum ?? '',
      location_flexibility: draft.compensation?.location_flexibility,
    },
    location: {
      country: draft.location?.country ?? '',
      city: draft.location?.city ?? '',
      timezone: draft.location?.timezone ?? '',
      visa_status: draft.location?.visa_status,
    },
  };
}
