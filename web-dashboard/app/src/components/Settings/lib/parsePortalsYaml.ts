// Settings/lib/parsePortalsYaml.ts -- defensive JSON -> PortalsForm.
//
// portals.yml has two surfaces we render: title_filter (positive/negative
// keyword arrays) and tracked_companies (an array of {name, enabled}).
// The form folds the company array into a flat overrides map keyed by
// company name. Settings is always in customize mode; useDefaults is
// hardcoded false here.

import type { PortalsForm } from './types';

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/**
 * Convert the parsed JSON body of `portals.yml` into a PortalsForm.
 * Never throws; missing keys yield empty arrays / overrides.
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

  return {
    useDefaults: false,
    positiveKeywords: asStringArray(titleFilter.positive),
    negativeKeywords: asStringArray(titleFilter.negative),
    companyOverrides: overrides,
  };
}
