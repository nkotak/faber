// CompanyToggleList.tsx -- collapsible per-company enable/disable list.
//
// Companies arrive grouped by sector (matches templates/portals.example.yml
// structure). The full list is long (~120 entries); we render section
// headers as toggle-all controls so the user can flip an entire sector in
// a single click. Sections start collapsed; the user expands the ones they
// care about.

import { useState } from 'react';

export interface CompanySectionDef {
  /** sector heading */
  heading: string;
  /** list of company names belonging to the section */
  companies: string[];
  /** default-enabled summary for the eyebrow line */
  defaultEnabled: number;
}

interface Props {
  sections: CompanySectionDef[];
  /** map of company.name → enabled flag (overrides defaults). */
  overrides: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
}

/**
 * Default sector → companies. Mirrors the shape in
 * templates/portals.example.yml without duplicating the entire 900-line
 * file — the server is the source of truth on commit; this list only
 * powers the customize UI. Keep the list curated and short enough to
 * stay scannable; users who want every company can leave defaults on.
 */
export const DEFAULT_COMPANY_SECTIONS: CompanySectionDef[] = [
  {
    heading: 'AI labs · model providers',
    defaultEnabled: 8,
    companies: [
      'Anthropic',
      'OpenAI',
      'Cohere',
      'Mistral AI',
      'Hugging Face',
      'Stability AI',
      'Black Forest Labs',
      'Aleph Alpha',
    ],
  },
  {
    heading: 'AI infra · LLMOps · observability',
    defaultEnabled: 7,
    companies: [
      'LangChain',
      'Pinecone',
      'Weights & Biases',
      'Langfuse',
      'Lakera',
      'Zep AI',
      'Maxim AI',
    ],
  },
  {
    heading: 'AI agents · forward-deployed',
    defaultEnabled: 5,
    companies: ['Lindy', 'Cognigy', 'Speechmatics', 'Synthesia', 'Causaly'],
  },
  {
    heading: 'No-code · low-code · automation',
    defaultEnabled: 5,
    companies: ['n8n', 'Zapier', 'Make.com (Celonis)', 'Hightouch', 'WorkOS'],
  },
  {
    heading: 'Dev-tools · platforms',
    defaultEnabled: 9,
    companies: [
      'Supabase',
      'Resend',
      'Clerk',
      'Inngest',
      'PlanetScale',
      'Tinybird',
      'Attio',
      'Hightouch',
      'WorkOS',
    ],
  },
  {
    heading: 'AI applications',
    defaultEnabled: 6,
    companies: ['Lovable', 'Legora', 'Photoroom', 'Pigment', 'Runway', 'Perplexity'],
  },
  {
    heading: 'European tech',
    defaultEnabled: 8,
    companies: [
      'DeepL',
      'Helsing',
      'Celonis',
      'Contentful',
      'GetYourGuide',
      'HelloFresh',
      'N26',
      'Trade Republic',
    ],
  },
];

export function CompanyToggleList({ sections, overrides, onChange }: Props) {
  return (
    <div className="onb-companies">
      {sections.map((section) => (
        <CompanySection
          key={section.heading}
          section={section}
          overrides={overrides}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function CompanySection({
  section,
  overrides,
  onChange,
}: {
  section: CompanySectionDef;
  overrides: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
}) {
  const [open, setOpen] = useState(false);
  const total = section.companies.length;
  const enabledCount = section.companies.reduce(
    (n, name) => n + (isEnabled(name, overrides) ? 1 : 0),
    0,
  );

  const toggleAll = (enabled: boolean) => {
    const next = { ...overrides };
    section.companies.forEach((c) => {
      next[c] = enabled;
    });
    onChange(next);
  };

  return (
    <section className="onb-companies__section">
      <header
        className="onb-companies__section-head"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        aria-expanded={open}
      >
        <span className="onb-companies__section-glyph" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className="onb-companies__section-title">{section.heading}</span>
        <span className="onb-companies__section-count mono">
          {enabledCount}/{total}
        </span>
        <button
          type="button"
          className="onb-btn onb-btn--ghost onb-companies__section-toggle"
          onClick={(e) => {
            e.stopPropagation();
            toggleAll(enabledCount < total);
          }}
        >
          {enabledCount < total ? 'enable all' : 'disable all'}
        </button>
      </header>
      {open ? (
        <ul className="onb-companies__list">
          {section.companies.map((c) => {
            const checked = isEnabled(c, overrides);
            return (
              <li className="onb-companies__row" key={c}>
                <label className="onb-companies__row-label">
                  <input
                    type="checkbox"
                    className="onb-companies__check"
                    checked={checked}
                    onChange={(e) =>
                      onChange({ ...overrides, [c]: e.target.checked })
                    }
                  />
                  <span>{c}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function isEnabled(name: string, overrides: Record<string, boolean>): boolean {
  if (Object.prototype.hasOwnProperty.call(overrides, name)) {
    return overrides[name];
  }
  // default-on: every company is enabled in the template unless explicitly
  // disabled. The user only toggles companies they want to suppress.
  return true;
}
