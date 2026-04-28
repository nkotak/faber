// Settings/lib/types.ts -- internal form shapes used by the panes.
//
// These types are tailored to make form binding ergonomic. The save-side
// transformers translate them into the on-wire shapes that the existing
// onboarding write endpoints accept.

import type {
  ArchetypeSlim,
  PortalsConfig,
  ProofPoint,
  SettingsPaneId,
} from '../../../lib/types';

/** Form-friendly mirror of `config/profile.yml`. Every field is required
 * (default empty strings/arrays) so the form never has to deal with
 * `undefined`. The save transformer drops empty optionals. */
export interface ProfileYamlForm {
  candidate: {
    full_name: string;
    email: string;
    phone: string;
    location: string;
    linkedin: string;
    portfolio_url: string;
    github: string;
    twitter: string;
    canva_resume_design_id: string;
  };
  target_roles: {
    primary: string[];
    archetypes: ArchetypeSlim[];
  };
  narrative: {
    headline: string;
    exit_story: string;
    superpowers: string[];
    proof_points: ProofPoint[];
    dashboard: {
      url: string;
      password: string;
    };
  };
  compensation: {
    target_range: string;
    currency: 'USD' | 'GBP' | 'EUR' | 'CAD' | 'AUD';
    minimum: string;
    location_flexibility: string;
  };
  location: {
    country: string;
    city: string;
    timezone: string;
    visa_status: string;
    onsite_availability: string;
  };
}

/** Form-friendly mirror of `portals.yml`. Always in customize mode (the
 * defaults toggle is an onboarding concept; in Settings the user is past
 * defaults by definition). */
export type PortalsForm = PortalsConfig;

/** Settings nav item descriptor. */
export interface SettingsNavItem {
  id: SettingsPaneId;
  label: string;
  /** keyboard index 1..4 */
  idx: number;
  /** path label rendered in the header strip (relative to project root) */
  relPath: string;
}

export const SETTINGS_NAV_ITEMS: ReadonlyArray<SettingsNavItem> = [
  { id: 'cv', label: 'CV', idx: 1, relPath: 'cv.md' },
  { id: 'profile', label: 'Profile', idx: 2, relPath: 'config/profile.yml' },
  { id: 'profileMd', label: 'Profile Notes', idx: 3, relPath: 'modes/_profile.md' },
  { id: 'portals', label: 'Portals', idx: 4, relPath: 'portals.yml' },
] as const;
