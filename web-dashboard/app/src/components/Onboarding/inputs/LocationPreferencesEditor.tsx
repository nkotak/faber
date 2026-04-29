// LocationPreferencesEditor.tsx -- structured editor for `location_filter` in
// config/profile.yml. Used by the Settings → Location Filter pane and (future)
// the onboarding flow.
//
// Shape mirrors the LocationFilter type in lib/types.ts. The component owns
// only display state (advanced collapsed, autocomplete focus); semantic state
// flows through `value` / `onChange`.
//
// Visual hierarchy:
//   1. Master toggle (enabled)
//   2. Region presets (US-only / US+Canada / Remote-only / EU / Reset)
//   3. Three location sections: Remote, Hybrid, On-site
//   4. Advanced (collapsible): unknown_policy + custom_aliases
//
// Reuses existing form classes from OnboardingForms.css (.onb-section,
// .onb-grid, .onb-input, .onb-chip, etc.) and the KeywordChipInput primitive.

import { useState } from 'react';
import { KeywordChipInput } from './KeywordChipInput';
import type { LocationFilter } from '../../../lib/types';
import './LocationPreferencesEditor.css';

interface Props {
  value: LocationFilter;
  onChange: (next: LocationFilter) => void;
  ariaLabel?: string;
}

// Known canonical locations matching config/location-aliases.json keys. Used
// for autocomplete and as the chip-add suggestion list. Curated to keep the
// dropdown short and biased toward real-world target markets.
const CANONICAL_HYBRID = [
  'NYC', 'NJ', 'Bay Area', 'Boston', 'Seattle', 'Los Angeles', 'Austin',
  'Chicago', 'Denver', 'DC Metro', 'Toronto', 'Vancouver', 'London', 'Paris',
  'Berlin', 'Munich', 'Amsterdam', 'Madrid', 'Barcelona', 'Stockholm',
  'Dublin', 'Singapore', 'Tokyo', 'Sydney', 'Bangalore', 'Mumbai',
];

// Region tokens accepted by location-filter.mjs detectRemote(). 'global'
// matches "Remote — Worldwide" specifically, NOT a wildcard.
const REGIONS = [
  { id: 'us', label: 'US', help: 'Remote — US, Remote — Americas (US-flavored)' },
  { id: 'americas', label: 'Americas', help: 'Remote — Americas, North America, LATAM' },
  { id: 'emea', label: 'EMEA', help: 'Remote — Europe, EU, EMEA, UK' },
  { id: 'apac', label: 'APAC', help: 'Remote — Asia-Pacific, Asia' },
  { id: 'global', label: 'Global', help: 'Remote — Worldwide / Anywhere only' },
] as const;

const BARE_POLICIES = [
  { id: 'allow', label: 'Allow', help: 'Treat bare "Remote" as US-Remote' },
  { id: 'deny', label: 'Deny', help: 'Reject any "Remote" without a region' },
  { id: 'unknown', label: 'Defer', help: 'Apply unknown-location policy' },
] as const;

const UNKNOWN_POLICIES = [
  { id: 'allow', label: 'Allow', help: 'Keep, mark as unknown' },
  { id: 'deny', label: 'Deny', help: 'Drop empty/unknown locations' },
  { id: 'ask', label: 'Ask', help: 'Keep with marker for review' },
] as const;

// ---------------------------------------------------------------------------

function defaultRemote() {
  return { enabled: true, accept_regions: [] as string[], bare_remote_policy: 'allow' as const };
}

function presetUsOnly(prev: LocationFilter): LocationFilter {
  return {
    ...prev,
    enabled: true,
    remote: { enabled: true, accept_regions: ['us', 'americas', 'global'], bare_remote_policy: 'allow' },
    hybrid: { locations: ['NYC', 'NJ'] },
    onsite: { locations: ['NYC'] },
    unknown_policy: 'ask',
  };
}

function presetUsCanada(prev: LocationFilter): LocationFilter {
  return {
    ...prev,
    enabled: true,
    remote: { enabled: true, accept_regions: ['us', 'americas', 'global'], bare_remote_policy: 'allow' },
    hybrid: { locations: ['NYC', 'NJ', 'Toronto', 'Vancouver'] },
    onsite: { locations: [] },
    unknown_policy: 'ask',
  };
}

function presetRemoteOnly(prev: LocationFilter): LocationFilter {
  return {
    ...prev,
    enabled: true,
    remote: { enabled: true, accept_regions: ['us', 'americas', 'global'], bare_remote_policy: 'allow' },
    hybrid: { locations: [] },
    onsite: { locations: [] },
    unknown_policy: 'ask',
  };
}

function presetEu(prev: LocationFilter): LocationFilter {
  return {
    ...prev,
    enabled: true,
    remote: { enabled: true, accept_regions: ['emea', 'global'], bare_remote_policy: 'unknown' },
    hybrid: { locations: ['London', 'Berlin', 'Amsterdam', 'Paris'] },
    onsite: { locations: [] },
    unknown_policy: 'ask',
  };
}

function presetReset(prev: LocationFilter): LocationFilter {
  return {
    ...prev,
    enabled: false,
    remote: defaultRemote(),
    hybrid: { locations: [] },
    onsite: { locations: [] },
    unknown_policy: 'ask',
  };
}

// Compare current value to a preset's output to highlight active preset chip.
function presetMatches(v: LocationFilter, target: LocationFilter): boolean {
  if (v.enabled !== target.enabled) return false;
  if ((v.unknown_policy ?? 'ask') !== target.unknown_policy) return false;
  const sortedEq = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
  const tr = target.remote!;
  const vr = v.remote ?? defaultRemote();
  if (tr.enabled !== vr.enabled) return false;
  if (!sortedEq(tr.accept_regions, vr.accept_regions ?? [])) return false;
  if (tr.bare_remote_policy !== vr.bare_remote_policy) return false;
  if (!sortedEq(target.hybrid?.locations ?? [], v.hybrid?.locations ?? [])) return false;
  if (!sortedEq(target.onsite?.locations ?? [], v.onsite?.locations ?? [])) return false;
  return true;
}

// ---------------------------------------------------------------------------

export function LocationPreferencesEditor({ value, onChange, ariaLabel }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [aliasDraft, setAliasDraft] = useState({ name: '', variants: '' });

  const enabled = value.enabled ?? false;
  const remote = value.remote ?? defaultRemote();
  const hybrid = value.hybrid?.locations ?? [];
  const onsite = value.onsite?.locations ?? [];
  const unknownPolicy = value.unknown_policy ?? 'ask';
  const aliases = value.custom_aliases ?? {};

  // ---------- mutations ----------

  const setEnabled = (next: boolean) => onChange({ ...value, enabled: next });

  const setRemote = (patch: Partial<typeof remote>) =>
    onChange({ ...value, remote: { ...remote, ...patch } });

  const toggleRegion = (id: string) => {
    const set = new Set(remote.accept_regions ?? []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setRemote({ accept_regions: Array.from(set) });
  };

  const setHybrid = (locations: string[]) =>
    onChange({ ...value, hybrid: { locations } });

  const setOnsite = (locations: string[]) =>
    onChange({ ...value, onsite: { locations } });

  const setUnknown = (next: 'allow' | 'deny' | 'ask') =>
    onChange({ ...value, unknown_policy: next });

  const addAlias = () => {
    const name = aliasDraft.name.trim();
    const variants = aliasDraft.variants
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!name || variants.length === 0) return;
    onChange({
      ...value,
      custom_aliases: { ...aliases, [name]: variants },
    });
    setAliasDraft({ name: '', variants: '' });
  };

  const removeAlias = (name: string) => {
    const next = { ...aliases };
    delete next[name];
    onChange({ ...value, custom_aliases: next });
  };

  // ---------- presets ----------

  const presets = [
    { id: 'us-only', label: 'US-only', apply: presetUsOnly },
    { id: 'us-canada', label: 'US + Canada', apply: presetUsCanada },
    { id: 'remote-only', label: 'Remote-only', apply: presetRemoteOnly },
    { id: 'eu', label: 'EU', apply: presetEu },
    { id: 'reset', label: 'Reset', apply: presetReset },
  ] as const;

  return (
    <div
      className={`loc-prefs ${enabled ? 'loc-prefs--on' : 'loc-prefs--off'}`}
      role="group"
      aria-label={ariaLabel ?? 'Location filter preferences'}
    >
      {/* Master toggle */}
      <div className="loc-prefs__toggle">
        <label className="loc-prefs__toggle-label">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            aria-label="Enable location filter"
          />
          <span className="loc-prefs__toggle-track" aria-hidden="true">
            <span className="loc-prefs__toggle-knob" />
          </span>
          <span className="loc-prefs__toggle-text">
            <strong>Location filter</strong>
            <span className="onb-help">
              {enabled
                ? 'on — scans drop jobs that don\'t match below'
                : 'off — all jobs pass'}
            </span>
          </span>
        </label>
      </div>

      {/* Region presets */}
      <div className="loc-prefs__presets" aria-label="Quick presets">
        <span className="onb-field__label">presets</span>
        <div className="loc-prefs__preset-row">
          {presets.map((p) => {
            const next = p.apply(value);
            const active = enabled && presetMatches(value, next);
            return (
              <button
                key={p.id}
                type="button"
                className={`loc-prefs__preset ${active ? 'loc-prefs__preset--active' : ''}`}
                onClick={() => onChange(next)}
                aria-pressed={active}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={`loc-prefs__body ${enabled ? '' : 'loc-prefs__body--dim'}`}
        // `inert` on a dimmed body removes its descendants from focus order
        // AND from the accessibility tree — better than aria-hidden alone,
        // which doesn't block keyboard tabbing into disabled chip inputs.
        // @ts-expect-error: `inert` is HTML-valid; React's types lag.
        inert={!enabled ? '' : undefined}
      >
        {/* Remote section */}
        <section className="loc-prefs__section">
          <header className="loc-prefs__section-head">
            <h4 className="loc-prefs__section-title">Remote</h4>
            <label className="loc-prefs__inline-toggle">
              <input
                type="checkbox"
                checked={remote.enabled !== false}
                onChange={(e) => setRemote({ enabled: e.target.checked })}
                disabled={!enabled}
              />
              <span>accept remote</span>
            </label>
          </header>

          <div className="loc-prefs__row">
            <span className="onb-field__label">accepted regions</span>
            <div className="loc-prefs__chips" role="group" aria-label="Accepted remote regions">
              {REGIONS.map((r) => {
                const active = (remote.accept_regions ?? []).includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`loc-prefs__token ${active ? 'loc-prefs__token--on' : ''}`}
                    onClick={() => toggleRegion(r.id)}
                    aria-pressed={active}
                    title={r.help}
                    disabled={!enabled || remote.enabled === false}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="loc-prefs__row">
            <span className="onb-field__label">bare "Remote"</span>
            <RadioRow
              name="bare-remote"
              options={BARE_POLICIES}
              value={remote.bare_remote_policy ?? 'allow'}
              onChange={(v) => setRemote({ bare_remote_policy: v as 'allow' | 'deny' | 'unknown' })}
              disabled={!enabled || remote.enabled === false}
            />
          </div>
        </section>

        {/* Hybrid section */}
        <section className="loc-prefs__section">
          <header className="loc-prefs__section-head">
            <h4 className="loc-prefs__section-title">Hybrid</h4>
            <span className="onb-help">on-site some days, remote others</span>
          </header>
          <div className="loc-prefs__row">
            <span className="onb-field__label">accepted locations</span>
            <KeywordChipInput
              ariaLabel="Hybrid locations"
              values={hybrid}
              onChange={setHybrid}
              placeholder="type a city — e.g. NYC, NJ, Bay Area"
            />
          </div>
          <Suggestions
            current={hybrid}
            onAdd={(loc) => setHybrid([...hybrid, loc])}
            disabled={!enabled}
          />
        </section>

        {/* On-site section */}
        <section className="loc-prefs__section">
          <header className="loc-prefs__section-head">
            <h4 className="loc-prefs__section-title">On-site</h4>
            <span className="onb-help">full-time in office, no remote allowed</span>
          </header>
          <div className="loc-prefs__row">
            <span className="onb-field__label">accepted locations</span>
            <KeywordChipInput
              ariaLabel="On-site locations"
              values={onsite}
              onChange={setOnsite}
              placeholder="empty = no on-site jobs"
            />
          </div>
        </section>

        {/* Advanced */}
        <details
          className="loc-prefs__advanced"
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="onb-help"># advanced</summary>
          <div className="loc-prefs__advanced-body">
            <div className="loc-prefs__row">
              <span className="onb-field__label">empty / unknown locations</span>
              <RadioRow
                name="unknown-policy"
                options={UNKNOWN_POLICIES}
                value={unknownPolicy}
                onChange={(v) => setUnknown(v as 'allow' | 'deny' | 'ask')}
                disabled={!enabled}
              />
            </div>

            <div className="loc-prefs__row">
              <span className="onb-field__label">custom aliases</span>
              <p className="onb-help">
                canonical name → comma-separated variants. extends the built-in
                map (NYC, NJ, Bay Area, etc.).
              </p>
              <ul className="loc-prefs__alias-list">
                {Object.entries(aliases).map(([name, variants]) => (
                  <li key={name} className="loc-prefs__alias-item">
                    <span className="loc-prefs__alias-name">{name}</span>
                    <span className="loc-prefs__alias-variants">{variants.join(', ')}</span>
                    <button
                      type="button"
                      className="onb-chip__close"
                      onClick={() => removeAlias(name)}
                      aria-label={`Remove alias ${name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="loc-prefs__alias-form">
                <input
                  className="onb-input"
                  placeholder="canonical (e.g. Tri-State)"
                  value={aliasDraft.name}
                  onChange={(e) => setAliasDraft({ ...aliasDraft, name: e.target.value })}
                  disabled={!enabled}
                />
                <input
                  className="onb-input"
                  placeholder="variants, comma-separated"
                  value={aliasDraft.variants}
                  onChange={(e) => setAliasDraft({ ...aliasDraft, variants: e.target.value })}
                  disabled={!enabled}
                />
                <button
                  type="button"
                  className="onb-btn"
                  onClick={addAlias}
                  disabled={!enabled || !aliasDraft.name.trim() || !aliasDraft.variants.trim()}
                >
                  + add
                </button>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RadioRowProps {
  name: string;
  options: readonly { id: string; label: string; help?: string }[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

function RadioRow({ name, options, value, onChange, disabled }: RadioRowProps) {
  return (
    <div className="loc-prefs__radios" role="radiogroup">
      {options.map((opt) => (
        <label
          key={opt.id}
          className={`loc-prefs__radio ${value === opt.id ? 'loc-prefs__radio--on' : ''}`}
          title={opt.help}
        >
          <input
            type="radio"
            name={name}
            checked={value === opt.id}
            onChange={() => onChange(opt.id)}
            disabled={disabled}
          />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

interface SuggestionsProps {
  current: string[];
  onAdd: (loc: string) => void;
  disabled?: boolean;
}

function Suggestions({ current, onAdd, disabled }: SuggestionsProps) {
  const set = new Set(current);
  const remaining = CANONICAL_HYBRID.filter((c) => !set.has(c)).slice(0, 8);
  if (remaining.length === 0) return null;
  return (
    <div className="loc-prefs__suggestions">
      <span className="onb-help">suggestions</span>
      <div className="loc-prefs__suggest-row">
        {remaining.map((c) => (
          <button
            key={c}
            type="button"
            className="loc-prefs__suggest"
            onClick={() => onAdd(c)}
            disabled={disabled}
          >
            + {c}
          </button>
        ))}
      </div>
    </div>
  );
}
