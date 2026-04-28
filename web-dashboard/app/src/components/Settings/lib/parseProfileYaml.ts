// Settings/lib/parseProfileYaml.ts -- defensive JSON -> ProfileYamlForm.
//
// The on-disk YAML may be hand-edited and missing keys. The parser fills
// defaults so the form never receives `undefined`. The save transformer
// drops empty optional fields before posting.
//
// Input shape: whatever YAML.parse(profile.yml) produced (validated as
// `unknown` here; we narrow with safe accessors).

import type { ProfileYamlForm } from './types';

const VALID_CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD'] as const;
const VALID_FITS = ['primary', 'secondary', 'adjacent'] as const;

type Currency = (typeof VALID_CURRENCIES)[number];
type Fit = (typeof VALID_FITS)[number];

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function asCurrency(v: unknown): Currency {
  return typeof v === 'string' && (VALID_CURRENCIES as readonly string[]).includes(v)
    ? (v as Currency)
    : 'USD';
}

function asFit(v: unknown): Fit {
  return typeof v === 'string' && (VALID_FITS as readonly string[]).includes(v)
    ? (v as Fit)
    : 'primary';
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Convert the parsed JSON body of `config/profile.yml` into a
 * ProfileYamlForm with all fields filled (empty strings or empty arrays
 * for missing ones). Never throws.
 */
export function parseProfileYaml(raw: unknown): ProfileYamlForm {
  const r = asRecord(raw);
  const candidate = asRecord(r.candidate);
  const targetRoles = asRecord(r.target_roles);
  const narrative = asRecord(r.narrative);
  const compensation = asRecord(r.compensation);
  const location = asRecord(r.location);
  const dashboard = asRecord(narrative.dashboard);

  const archetypes = Array.isArray(targetRoles.archetypes)
    ? targetRoles.archetypes.map((a) => {
        const row = asRecord(a);
        return {
          name: asString(row.name),
          level: asString(row.level),
          fit: asFit(row.fit),
        };
      })
    : [];

  const proofPoints = Array.isArray(narrative.proof_points)
    ? narrative.proof_points.map((p) => {
        const row = asRecord(p);
        return {
          name: asString(row.name),
          url: asString(row.url),
          hero_metric: asString(row.hero_metric),
        };
      })
    : [];

  return {
    candidate: {
      full_name: asString(candidate.full_name),
      email: asString(candidate.email),
      phone: asString(candidate.phone),
      location: asString(candidate.location),
      linkedin: asString(candidate.linkedin),
      portfolio_url: asString(candidate.portfolio_url),
      github: asString(candidate.github),
      twitter: asString(candidate.twitter),
      canva_resume_design_id: asString(candidate.canva_resume_design_id),
    },
    target_roles: {
      primary: asStringArray(targetRoles.primary),
      archetypes,
    },
    narrative: {
      headline: asString(narrative.headline),
      exit_story: asString(narrative.exit_story),
      superpowers: asStringArray(narrative.superpowers),
      proof_points: proofPoints,
      dashboard: {
        url: asString(dashboard.url),
        password: asString(dashboard.password),
      },
    },
    compensation: {
      target_range: asString(compensation.target_range),
      currency: asCurrency(compensation.currency),
      minimum: asString(compensation.minimum),
      location_flexibility: asString(compensation.location_flexibility),
    },
    location: {
      country: asString(location.country),
      city: asString(location.city),
      timezone: asString(location.timezone),
      visa_status: asString(location.visa_status),
      onsite_availability: asString(location.onsite_availability),
    },
  };
}
