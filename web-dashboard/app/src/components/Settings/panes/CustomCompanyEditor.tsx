// CustomCompanyEditor.tsx -- list + add-form for user-defined tracked companies.
//
// Lives inside PanePortals.tsx as a section. The list shows current
// customCompanies (from portals.yml's `custom_companies` block); the form
// adds new entries. Removing an entry is destructive but bounded — the user
// can just re-add it from the form.
//
// Auto-fill: when platform + slug are both filled and careers_url is blank,
// the form derives a sensible careers_url from the platform's known URL
// shape. The user can override.

import { useState } from 'react';
import type { CustomCompany } from '../../../lib/types';

interface Props {
  values: CustomCompany[];
  onChange: (next: CustomCompany[]) => void;
}

type Platform = CustomCompany['platform'];

const PLATFORMS: { id: Platform; label: string; needsSlug: boolean; help: string }[] = [
  { id: 'ashby', label: 'Ashby', needsSlug: true, help: 'jobs.ashbyhq.com/{slug}' },
  { id: 'lever', label: 'Lever', needsSlug: true, help: 'jobs.lever.co/{slug}' },
  {
    id: 'greenhouse',
    label: 'Greenhouse',
    needsSlug: true,
    help: 'job-boards.greenhouse.io/{slug}',
  },
  { id: 'workable', label: 'Workable', needsSlug: false, help: 'apply.workable.com/{slug}' },
  { id: 'custom', label: 'Custom', needsSlug: false, help: 'any URL' },
];

function deriveCareersUrl(platform: Platform, slug: string): string {
  const s = slug.trim();
  if (!s) return '';
  switch (platform) {
    case 'ashby':
      return `https://jobs.ashbyhq.com/${s}`;
    case 'lever':
      return `https://jobs.lever.co/${s}`;
    case 'greenhouse':
      return `https://job-boards.greenhouse.io/${s}`;
    case 'workable':
      return `https://apply.workable.com/${s}/`;
    default:
      return '';
  }
}

interface DraftState {
  name: string;
  platform: Platform;
  slug: string;
  careers_url: string;
  notes: string;
  /** Whether the user has manually edited careers_url. When false, we
   * auto-fill from platform + slug as they type. */
  urlTouched: boolean;
}

const EMPTY_DRAFT: DraftState = {
  name: '',
  platform: 'ashby',
  slug: '',
  careers_url: '',
  notes: '',
  urlTouched: false,
};

export function CustomCompanyEditor({ values, onChange }: Props) {
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const platformDef = PLATFORMS.find((p) => p.id === draft.platform)!;
  const slugRequired = platformDef.needsSlug;

  const updateDraft = (patch: Partial<DraftState>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      // Auto-fill careers_url unless the user has touched it explicitly
      if (!next.urlTouched && (patch.platform || patch.slug !== undefined)) {
        const derived = deriveCareersUrl(next.platform, next.slug);
        if (derived) next.careers_url = derived;
        else next.careers_url = '';
      }
      return next;
    });
    setError(null);
  };

  const validate = (d: DraftState): string | null => {
    if (!d.name.trim()) return 'name is required';
    if (slugRequired && !d.slug.trim()) {
      return `slug is required for ${platformDef.label}`;
    }
    if (!d.careers_url.trim()) return 'careers URL is required';
    if (!/^https?:\/\//.test(d.careers_url.trim())) {
      return 'careers URL must start with http:// or https://';
    }
    const lower = d.name.trim().toLowerCase();
    if (values.some((v) => v.name.toLowerCase() === lower)) {
      return `"${d.name.trim()}" is already in your additions`;
    }
    return null;
  };

  const submit = () => {
    const err = validate(draft);
    if (err) {
      setError(err);
      return;
    }
    const next: CustomCompany = {
      name: draft.name.trim(),
      platform: draft.platform,
      slug: draft.slug.trim() || undefined,
      careers_url: draft.careers_url.trim(),
      notes: draft.notes.trim() || undefined,
      enabled: true,
    };
    onChange([...values, next]);
    setDraft(EMPTY_DRAFT);
    setError(null);
  };

  const removeAt = (idx: number) => {
    onChange(values.filter((_, i) => i !== idx));
  };

  const toggleAt = (idx: number, enabled: boolean) => {
    onChange(values.map((c, i) => (i === idx ? { ...c, enabled } : c)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="custom-companies">
      {values.length > 0 ? (
        <ul className="custom-companies__list" aria-label="Your custom companies">
          {values.map((c, i) => (
            <li key={`${c.name}-${i}`} className="custom-companies__row">
              <label className="custom-companies__row-toggle">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={(e) => toggleAt(i, e.target.checked)}
                  aria-label={`Toggle ${c.name}`}
                />
              </label>
              <div className="custom-companies__row-main">
                <span className="custom-companies__row-name">{c.name}</span>
                <span className="custom-companies__row-meta mono">
                  <span className="custom-companies__row-platform">{c.platform}</span>
                  {c.slug ? (
                    <>
                      <span className="custom-companies__row-sep" aria-hidden>·</span>
                      <span className="custom-companies__row-slug">{c.slug}</span>
                    </>
                  ) : null}
                </span>
                <a
                  href={c.careers_url}
                  target="_blank"
                  rel="noreferrer"
                  className="custom-companies__row-url mono"
                >
                  {c.careers_url}
                </a>
              </div>
              <button
                type="button"
                className="onb-chip__close custom-companies__row-remove"
                onClick={() => removeAt(i)}
                aria-label={`Remove ${c.name}`}
                title={`Remove ${c.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="onb-help custom-companies__empty">
          # no additions yet
        </p>
      )}

      <div className="custom-companies__form" onKeyDown={onKeyDown}>
        <div className="custom-companies__form-grid">
          <label className="onb-field">
            <span className="onb-field__label onb-field__label--required">name</span>
            <input
              type="text"
              className="onb-input"
              value={draft.name}
              onChange={(e) => updateDraft({ name: e.target.value })}
              placeholder="ServiceTitan"
            />
          </label>

          <label className="onb-field">
            <span className="onb-field__label onb-field__label--required">platform</span>
            <select
              className="onb-select"
              value={draft.platform}
              onChange={(e) => updateDraft({ platform: e.target.value as Platform })}
            >
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="onb-field">
            <span
              className={`onb-field__label ${slugRequired ? 'onb-field__label--required' : ''}`}
            >
              slug
            </span>
            <input
              type="text"
              className="onb-input"
              value={draft.slug}
              onChange={(e) => updateDraft({ slug: e.target.value })}
              placeholder={platformDef.needsSlug ? platformDef.help : '(not required)'}
            />
          </label>

          <label className="onb-field custom-companies__form-url">
            <span className="onb-field__label onb-field__label--required">careers URL</span>
            <input
              type="text"
              className="onb-input"
              value={draft.careers_url}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, careers_url: e.target.value, urlTouched: true }))
              }
              placeholder="https://..."
            />
          </label>

          <label className="onb-field custom-companies__form-notes">
            <span className="onb-field__label">notes</span>
            <input
              type="text"
              className="onb-input"
              value={draft.notes}
              onChange={(e) => updateDraft({ notes: e.target.value })}
              placeholder="optional context"
            />
          </label>
        </div>

        {error ? (
          <p className="onb-error custom-companies__error" role="alert">
            # {error}
          </p>
        ) : null}

        <div className="custom-companies__form-foot">
          <button
            type="button"
            className="onb-btn"
            onClick={submit}
            disabled={!draft.name.trim() || !draft.careers_url.trim()}
          >
            + add company
          </button>
        </div>
      </div>
    </div>
  );
}
