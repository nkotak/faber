// Settings/lib/parsePortalsYaml.ts -- defensive JSON -> PortalsForm.
//
// portals.yml has three surfaces we render: title_filter (positive/negative
// keyword arrays), tracked_companies (array of {name, enabled} entries from
// the template, edited via toggles) and custom_companies (user-added entries
// with full metadata). The form folds tracked_companies into a flat overrides
// map and keeps custom_companies as a typed list for the editor.
// Settings is always in customize mode; useDefaults is hardcoded false here.

import type { CustomCompany } from '../../../lib/types';
import type { PortalsForm } from './types';

const ALLOWED_PLATFORMS = new Set([
  'ashby',
  'lever',
  'greenhouse',
  'workable',
  'custom',
]);

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/**
 * Convert the parsed JSON body of `portals.yml` into a PortalsForm.
 * Never throws; missing keys yield empty arrays / overrides / customCompanies.
 */
export function parsePortalsYaml(parsed: unknown): PortalsForm {
  const p = asRecord(parsed);
  const titleFilter = asRecord(p.title_filter);

  const overrides: Record<string, boolean> = {};
  if (Array.isArray(p.tracked_companies)) {
    for (const entry of p.tracked_companies) {
      const row = asRecord(entry);
      const name = typeof row.name === 'string' ? row.name : null;
      const enabled = typeof row.enabled === 'boolean' ? row.enabled : null;
      if (name && enabled !== null) {
        overrides[name] = enabled;
      }
    }
  }

  const customCompanies: CustomCompany[] = [];
  if (Array.isArray(p.custom_companies)) {
    for (const entry of p.custom_companies) {
      const row = asRecord(entry);
      const name = asString(row.name).trim();
      const platform = asString(row.platform).trim();
      const careers_url = asString(row.careers_url).trim();
      if (!name || !ALLOWED_PLATFORMS.has(platform) || !careers_url) continue;
      customCompanies.push({
        name,
        platform: platform as CustomCompany['platform'],
        slug: asString(row.slug).trim() || undefined,
        careers_url,
        notes: asString(row.notes).trim() || undefined,
        enabled: row.enabled !== false, // default true
      });
    }
  }

  return {
    useDefaults: false,
    positiveKeywords: asStringArray(titleFilter.positive),
    negativeKeywords: asStringArray(titleFilter.negative),
    companyOverrides: overrides,
    customCompanies,
  };
}
