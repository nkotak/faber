#!/usr/bin/env node

/**
 * generate-cv.mjs — Per-role tailored CV generator for faber
 *
 * Pipeline:
 *   cv.md (structured parse) + profile.yml + JD (keyword extraction)
 *     → tailored HTML (bullet/skills reorder + <strong> emphasis)
 *     → renderHtmlToPdf() from generate-pdf.mjs → 1-page PDF
 *
 * Hard guarantees:
 *   - Never fabricates content. Every rendered bullet is traceable verbatim to cv.md.
 *     Enforced at runtime by assertNoFabrication().
 *   - Every template placeholder replaced globally via .replaceAll().
 *   - Exits non-zero if the rendered PDF is not exactly 1 page.
 *
 * Usage:
 *   node generate-cv.mjs --out=<pdf-path> \
 *     [--slug=<company-slug>] \
 *     [--report=<reports/xxx.md>] \
 *     [--url=<jd-url>] \
 *     [--jd=<jd.txt>] \
 *     [--skip-tailoring] \
 *     [--margin=0.4in]
 *
 * JD source resolution (first one that matches):
 *   --jd=<file>      Read JD text from a file
 *   --url=<url>      Fetch JD directly from a URL
 *   --report=<file>  Read report, extract **URL:**, fetch that URL
 *   (none)           No tailoring — canonical cv.md ordering
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { parseArgs } from 'util';
import { renderHtmlToPdf } from './generate-pdf.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// ==========================================================================
// CLI
// ==========================================================================

const { values: args } = parseArgs({
  options: {
    out:              { type: 'string' },
    slug:             { type: 'string' },
    report:           { type: 'string' },
    url:              { type: 'string' },
    jd:               { type: 'string' },
    'skip-tailoring': { type: 'boolean', default: false },
    margin:           { type: 'string', default: '0.25in' },
  },
  strict: false,
});

if (!args.out) {
  console.error('Usage: node generate-cv.mjs --out=<pdf-path> [--slug=<slug>] [--report=<report.md>] [--url=<url>] [--jd=<jd.txt>] [--skip-tailoring] [--margin=0.4in]');
  process.exit(1);
}

// ==========================================================================
// Profile parser — minimal YAML for the candidate: block only
// ==========================================================================

function parseProfile() {
  const text = readFileSync(join(ROOT, 'config/profile.yml'), 'utf-8');
  const candidate = {};
  let inCandidate = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (/^candidate:\s*$/.test(line)) { inCandidate = true; continue; }
    if (!inCandidate) continue;
    if (/^[^\s#]/.test(line)) { inCandidate = false; continue; }  // new top-level key
    if (/^\s*#/.test(line)) continue;  // comment
    const m = line.match(/^\s+(\w+):\s*(.*)$/);
    if (!m) continue;
    let [, key, val] = m;
    val = val.trim().replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '');
    candidate[key] = val;
  }
  return candidate;
}

// ==========================================================================
// CV parser — cv.md → structured tree
// ==========================================================================

/**
 * Split a comma-separated list while respecting parenthesis depth so that
 * "Reinforcement learning (PPO, reward shaping), LLM architecture (YOCO, BitNet, GRPO)"
 * splits into exactly 2 items, not 6.
 */
function splitRespectingParens(str) {
  const items = [];
  let depth = 0;
  let buf = '';
  for (const ch of str) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      const trimmed = buf.trim();
      if (trimmed) items.push(trimmed);
      buf = '';
    } else {
      buf += ch;
    }
  }
  const trimmed = buf.trim();
  if (trimmed) items.push(trimmed);
  return items;
}

function parseCv() {
  const text = readFileSync(join(ROOT, 'cv.md'), 'utf-8');
  const lines = text.split('\n');

  const cv = {
    name: '',
    core_skills: [],   // [{category, items: string[]}]
    experience: [],    // [{role, company, location, dates, bullets: string[]}]
    education: [],     // [{degree, school, year}]
  };

  let section = null;
  let currentJob = null;

  const flushJob = () => {
    if (currentJob) {
      cv.experience.push(currentJob);
      currentJob = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // H1 name
    const h1 = line.match(/^#\s+(.+)/);
    if (h1 && !cv.name) {
      cv.name = h1[1].trim();
      continue;
    }

    // H2 section boundaries
    if (/^##\s+CORE\s+SKILLS/i.test(line))             { flushJob(); section = 'skills';     continue; }
    if (/^##\s+PROFESSIONAL\s+EXPERIENCE/i.test(line)) { flushJob(); section = 'experience'; continue; }
    if (/^##\s+EDUCATION/i.test(line))                 { flushJob(); section = 'education';  continue; }
    if (/^##\s+/.test(line))                           { flushJob(); section = null;         continue; }

    if (section === 'skills') {
      const m = line.match(/^\*\*([^:*]+):\*\*\s*(.+)$/);
      if (m) {
        const items = splitRespectingParens(m[2]);
        cv.core_skills.push({ category: m[1].trim(), items });
      }
      continue;
    }

    if (section === 'experience') {
      const h3 = line.match(/^###\s+(.+)/);
      if (h3) {
        flushJob();
        const parts = h3[1].split('|').map(s => s.trim());
        currentJob = {
          role: parts[0] || '',
          company: parts[1] || '',
          location: parts[2] || '',
          dates: '',
          bullets: [],
        };
        continue;
      }

      const dates = line.match(/^\*\*([^*]+)\*\*\s*$/);
      if (dates && currentJob && !currentJob.dates) {
        currentJob.dates = dates[1].trim();
        continue;
      }

      const bullet = line.match(/^-\s+(.+)$/);
      if (bullet && currentJob) {
        currentJob.bullets.push(bullet[1].trim());
      }
      continue;
    }

    if (section === 'education') {
      const edu = line.match(/^\*\*([^*]+)\*\*\s*\|\s*([^|]+)\s*\|\s*(.+)$/);
      if (edu) {
        cv.education.push({
          degree: edu[1].trim(),
          school: edu[2].trim(),
          year: edu[3].trim(),
        });
      }
      continue;
    }
  }
  flushJob();

  // Parse assertions
  if (!cv.name)                     throw new Error('cv.md parse error: no H1 name found');
  if (cv.core_skills.length === 0)  throw new Error('cv.md parse error: no CORE SKILLS entries');
  if (cv.experience.length === 0)   throw new Error('cv.md parse error: no experience entries');
  if (cv.education.length === 0)    throw new Error('cv.md parse error: no education entries');
  for (const job of cv.experience) {
    if (!job.role || !job.company)  throw new Error(`cv.md parse error: malformed job header "${job.role}|${job.company}"`);
    if (job.bullets.length === 0)   throw new Error(`cv.md parse error: job "${job.role}" has zero bullets`);
  }
  return cv;
}

// ==========================================================================
// JD fetcher and keyword extractor
// ==========================================================================

const STOPWORDS = new Set([
  'the','a','an','and','or','but','for','nor','on','at','to','from','by','with','in',
  'of','about','as','into','like','through','after','over','between','out','against',
  'during','without','before','under','around','among','is','are','was','were','be',
  'been','being','have','has','had','having','do','does','did','will','would','should',
  'could','may','might','must','shall','can','need','this','that','these','those','i',
  'you','he','she','it','we','they','them','their','what','which','who','whom','whose',
  'where','when','why','how','all','any','both','each','few','more','most','other',
  'some','such','no','not','only','own','same','so','than','too','very','just','now',
  'your','our','my','its','here','there','also','well','work','working','experience',
  'team','company','years','year','ability','able','role','roles','job','position',
  'candidate','candidates','required','preferred','including','etc','salary','benefits',
  'eligible','authorization','apply','applicants','application','applications','look',
  'looking','seeking','strong','deep','great','using','use','used','uses','new','across',
  'help','within','one','two','three','multiple','many','various','per','include',
  'includes','based','non','equal','opportunity','employment','us','make','making','made',
]);

/**
 * Detect ATS platform from URL and fetch JD via the platform's JSON API
 * when available. Falls back to plain HTML fetch otherwise.
 *
 * ATS platforms detected:
 *   - Ashby:      jobs.ashbyhq.com/{slug}/{jobId}
 *                 → api.ashbyhq.com/posting-api/job-board/{slug} (full board)
 *   - Lever:      jobs.lever.co/{slug}/{jobId}
 *                 → api.lever.co/v0/postings/{slug}/{jobId}
 *   - Greenhouse: job-boards.greenhouse.io/{slug}/jobs/{id}
 *                 → boards-api.greenhouse.io/v1/boards/{slug}/jobs/{id}?content=true
 */
async function fetchJDText(url) {
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/]+)\/([a-f0-9-]+)/i);
  if (ashbyMatch) {
    const [, slug, jobId] = ashbyMatch;
    try {
      const resp = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const job = (data.jobs || []).find(j => j.id === jobId || (j.jobUrl || '').includes(jobId));
      if (job) {
        const text = [job.title, job.department, job.team, job.location, job.descriptionPlain || stripHtmlSimple(job.descriptionHtml || '')]
          .filter(Boolean).join(' ');
        return text;
      }
      console.error(`[generate-cv] ashby: jobId ${jobId} not found on board ${slug}`);
    } catch (e) {
      console.error(`[generate-cv] ashby api fetch failed: ${e.message}`);
    }
  }

  const leverMatch = url.match(/jobs\.lever\.co\/([^/]+)\/([a-f0-9-]+)/i);
  if (leverMatch) {
    const [, slug, jobId] = leverMatch;
    try {
      const resp = await fetch(`https://api.lever.co/v0/postings/${slug}/${jobId}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (resp.ok) {
        const job = await resp.json();
        const text = [job.text, job.categories?.team, job.categories?.location, job.descriptionPlain, job.additionalPlain]
          .filter(Boolean).join(' ');
        return text;
      }
    } catch (e) {
      console.error(`[generate-cv] lever api fetch failed: ${e.message}`);
    }
  }

  const ghMatch = url.match(/(?:job-boards|boards)\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i);
  if (ghMatch) {
    const [, slug, jobId] = ghMatch;
    try {
      const resp = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}?content=true`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (resp.ok) {
        const job = await resp.json();
        const text = [job.title, job.location?.name, stripHtmlSimple(job.content || '')]
          .filter(Boolean).join(' ');
        return text;
      }
    } catch (e) {
      console.error(`[generate-cv] greenhouse api fetch failed: ${e.message}`);
    }
  }

  // Fallback: plain HTML fetch and strip tags
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    return stripHtmlSimple(html);
  } catch (e) {
    console.error(`[generate-cv] fetchJDText failed for ${url}: ${e.message}`);
    return null;
  }
}

function stripHtmlSimple(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKeywords(text, topN = 150) {
  if (!text) return new Map();

  // Tokenize — matches words starting with alphanumerics, including tech terms
  // like "c++", "node.js", "gpt-4", "0-to-1". Also picks up numbers when attached
  // to meaningful text ("15s", "10b").
  const tokens = (text.toLowerCase().match(/[a-z0-9][a-z0-9+.\-/]*[a-z0-9+]|[a-z]/g) || [])
    .filter(t => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));

  const counts = new Map();
  const bump = (k, v) => counts.set(k, (counts.get(k) || 0) + v);

  for (const t of tokens) bump(t, 1);
  for (let i = 0; i < tokens.length - 1; i++) bump(`${tokens[i]} ${tokens[i + 1]}`, 1);
  for (let i = 0; i < tokens.length - 2; i++) bump(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`, 1);

  // Low thresholds — we want rare but informative terms like "computer vision"
  // and "reinforcement learning" to survive. The binary+IDF scoring in
  // scoreText() handles the noise.
  const filtered = [...counts.entries()].filter(([k, v]) => {
    const spaces = (k.match(/ /g) || []).length;
    if (spaces === 2) return v >= 1;    // trigrams: any occurrence
    if (spaces === 1) return v >= 1;    // bigrams: any occurrence
    return v >= 2;                       // unigrams: need some repetition
  });

  filtered.sort((a, b) => b[1] - a[1]);
  return new Map(filtered.slice(0, topN));
}

// ==========================================================================
// Tailoring: IDF-weighted scoring, reordering, emphasis
// ==========================================================================

/**
 * Compute inverse-document-frequency for every JD keyword against the cv.md
 * bullet corpus. Common terms (matching many bullets) get downweighted;
 * rare terms (matching few bullets) get amplified. This prevents generic
 * words like "product" from dominating the ranking.
 */
function computeIdf(cvTree, keywords) {
  const allBullets = cvTree.experience.flatMap(j => j.bullets.map(b => b.toLowerCase()));
  const N = allBullets.length;
  const idf = new Map();
  for (const kw of keywords.keys()) {
    let df = 0;
    for (const b of allBullets) if (b.includes(kw)) df++;
    // Keywords that don't match any bullet still get the max idf so the
    // <strong> emphasis pass can still surface them (e.g., "generative models"
    // should still be emphasized even if it appears in only one bullet).
    // Formula: log((N+1)/(df+1)) + 1 — monotonically decreasing in df, bounded [1, log(N+1)+1].
    idf.set(kw, Math.log((N + 1) / (df + 1)) + 1);
  }
  return idf;
}

/**
 * Score a text against the JD keyword set.
 *
 * Uses *binary presence* for each keyword, weighted by IDF against cv.md
 * bullets. Binary (not term-frequency) matters because a PM JD can mention
 * "product" 50 times — we don't want that to 50x the score of every bullet
 * containing "product". A keyword either matches this text or it doesn't.
 *
 * Multi-word phrases (bigrams/trigrams) get a phrase-length bonus because they
 * carry more semantic weight than bare unigrams.
 */
function scoreText(text, keywords, idfMap) {
  if (!keywords.size) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords.keys()) {
    if (lower.includes(kw)) {
      const idf = idfMap.get(kw) || 1;
      const phraseBonus = 1 + (kw.match(/ /g) || []).length;  // unigram=1, bigram=2, trigram=3
      score += idf * phraseBonus;
    }
  }
  return score;
}

function tailorJob(job, keywords, idfMap) {
  const scored = job.bullets.map((b, i) => ({ b, i, s: scoreText(b, keywords, idfMap) }));
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return { ...job, bullets: scored.map(x => x.b) };
}

function tailorSkills(skills, keywords, idfMap) {
  const tailored = skills.map((cat, origIdx) => {
    const scored = cat.items.map((item, i) => ({ item, i, s: scoreText(item, keywords, idfMap) }));
    scored.sort((a, b) => b.s - a.s || a.i - b.i);
    return {
      category: cat.category,
      items: scored.map(x => x.item),
      totalScore: scored.reduce((acc, x) => acc + x.s, 0),
      origIdx,
    };
  });
  tailored.sort((a, b) => b.totalScore - a.totalScore || a.origIdx - b.origIdx);
  return tailored.map(({ category, items }) => ({ category, items }));
}

/**
 * Wrap keyword matches in <strong>. Only emphasizes keywords that are:
 *   - length >= 5 (avoids "api", "llm" getting bolded on every match)
 *   - rare in cv.md (idf >= 2.5, i.e., matching ≤ ~3 of 15 bullets)
 * This prevents over-bolding common words like "product", "platform", "management".
 */
function emphasize(text, keywords, idfMap) {
  if (!keywords.size) return escapeHtml(text);

  const topKeywords = [...keywords.keys()]
    .filter(k => k.length >= 5)
    .filter(k => (idfMap.get(k) || 0) >= 2.5)
    .sort((a, b) => b.length - a.length);

  const lower = text.toLowerCase();
  const used = new Array(text.length).fill(false);
  const matches = [];

  for (const kw of topKeywords) {
    let from = 0;
    while (from < lower.length) {
      const idx = lower.indexOf(kw, from);
      if (idx === -1) break;
      const end = idx + kw.length;
      const beforeOk = idx === 0 || /[^\w]/.test(text[idx - 1]);
      const afterOk = end === text.length || /[^\w]/.test(text[end]);
      let overlap = false;
      for (let j = idx; j < end; j++) if (used[j]) { overlap = true; break; }
      if (beforeOk && afterOk && !overlap) {
        matches.push({ start: idx, end });
        for (let j = idx; j < end; j++) used[j] = true;
      }
      from = end;
    }
  }

  if (matches.length === 0) return escapeHtml(text);
  matches.sort((a, b) => a.start - b.start);

  let out = '';
  let pos = 0;
  for (const { start, end } of matches) {
    out += escapeHtml(text.slice(pos, start));
    out += '<strong>' + escapeHtml(text.slice(start, end)) + '</strong>';
    pos = end;
  }
  out += escapeHtml(text.slice(pos));
  return out;
}

// ==========================================================================
// HTML rendering
// ==========================================================================

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderContactLine(profile) {
  const parts = [];
  if (profile.location) parts.push(escapeHtml(profile.location));
  if (profile.email)    parts.push(escapeHtml(profile.email));
  if (profile.phone) {
    const pretty = profile.phone
      .replace(/^\+1[- ]?/, '')
      .replace(/^(\d{3})[- ]?(\d{3})[- ]?(\d{4})$/, '($1) $2-$3');
    parts.push(escapeHtml(pretty));
  }
  if (profile.linkedin) {
    const clean = profile.linkedin.replace(/^https?:\/\//, '');
    parts.push(`<a href="${escapeHtml('https://' + clean)}">${escapeHtml(clean)}</a>`);
  }
  if (profile.github) {
    const clean = profile.github.replace(/^https?:\/\//, '');
    parts.push(`<a href="${escapeHtml('https://' + clean)}">${escapeHtml(clean)}</a>`);
  }
  return parts.join('<span class="sep"> | </span>');
}

function renderExperience(jobs, keywords, idfMap) {
  return jobs.map(job => {
    const headerParts = [job.role, job.company, job.location, job.dates]
      .filter(Boolean)
      .map(escapeHtml);
    const headerHtml = headerParts.join('<span class="sep"> | </span>');
    const bulletsHtml = job.bullets
      .map(b => `<li>${emphasize(b, keywords, idfMap)}</li>`)
      .join('\n      ');
    return `  <div class="job">
    <div class="job-header">${headerHtml}</div>
    <ul>
      ${bulletsHtml}
    </ul>
  </div>`;
  }).join('\n');
}

function renderEducation(edu) {
  return edu.map(e => {
    return `  <div class="edu-item"><span class="edu-degree">${escapeHtml(e.degree)}</span><span class="sep"> | </span>${escapeHtml(e.school)}<span class="sep"> | </span>${escapeHtml(e.year)}</div>`;
  }).join('\n');
}

function renderSkills(skills, keywords, idfMap) {
  return skills.map(cat => {
    const itemsHtml = cat.items.map(item => emphasize(item, keywords, idfMap)).join(', ');
    return `  <div class="skill-category"><span class="skill-label">${escapeHtml(cat.category)}:</span> <span class="skill-list">${itemsHtml}</span></div>`;
  }).join('\n');
}

// ==========================================================================
// Anti-fabrication check: rendered <li> plain-text must equal cv.md bullet
// ==========================================================================

function normalizeWs(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function assertNoFabrication(cvTree, renderedHtml) {
  const cvBullets = new Set();
  for (const job of cvTree.experience) {
    for (const b of job.bullets) cvBullets.add(normalizeWs(b));
  }

  const renderedBullets = [];
  const re = /<li>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = re.exec(renderedHtml)) !== null) {
    renderedBullets.push(normalizeWs(stripHtml(m[1])));
  }

  if (renderedBullets.length === 0) {
    throw new Error('Anti-fabrication check: no bullets found in rendered HTML');
  }

  for (const rb of renderedBullets) {
    if (!cvBullets.has(rb)) {
      const preview = [...cvBullets].slice(0, 3).map(b => `"${b.slice(0, 70)}..."`).join('\n    ');
      throw new Error(`Anti-fabrication check FAILED — rendered bullet not in cv.md:\n  rendered: "${rb.slice(0, 100)}..."\n  cv.md has ${cvBullets.size} bullets, e.g.:\n    ${preview}`);
    }
  }

  return renderedBullets.length;
}

// ==========================================================================
// Main
// ==========================================================================

async function main() {
  const profile = parseProfile();
  const cv = parseCv();

  // Resolve JD source
  let jdText = null;
  let jdSource = 'none (canonical cv.md ordering)';

  if (!args['skip-tailoring']) {
    if (args.jd) {
      jdText = readFileSync(args.jd, 'utf-8');
      jdSource = `file:${args.jd}`;
    } else if (args.url) {
      jdText = await fetchJDText(args.url);
      jdSource = args.url;
    } else if (args.report) {
      const reportText = readFileSync(args.report, 'utf-8');
      const urlMatch = reportText.match(/\*\*URL:\*\*\s*(\S+)/);
      if (urlMatch) {
        jdText = await fetchJDText(urlMatch[1]);
        jdSource = urlMatch[1];
      } else {
        console.error(`[generate-cv] ${args.report}: no **URL:** line — canonical ordering`);
      }
    }
  }

  const keywords = extractKeywords(jdText);
  const idfMap = computeIdf(cv, keywords);

  console.error(`[generate-cv] JD source: ${jdSource}`);
  console.error(`[generate-cv] Keywords extracted: ${keywords.size}`);
  if (keywords.size > 0) {
    // Show keywords that actually match at least one bullet — those are the only ones that affect reordering
    const matching = [...keywords.keys()].filter(kw => {
      return cv.experience.some(j => j.bullets.some(b => b.toLowerCase().includes(kw)));
    });
    console.error(`[generate-cv] Keywords matching cv.md bullets: ${matching.length}`);
    if (matching.length > 0) {
      const preview = matching.slice(0, 10).map(k => {
        const idf = idfMap.get(k) || 1;
        return `${k}[idf=${idf.toFixed(1)}]`;
      }).join(', ');
      console.error(`[generate-cv] Top matches: ${preview}`);
    }
  }

  // Tailor (IDF-weighted scoring)
  const tailoredExperience = cv.experience.map(job => tailorJob(job, keywords, idfMap));
  const tailoredSkills = tailorSkills(cv.core_skills, keywords, idfMap);

  // Render sections
  const experienceHtml = renderExperience(tailoredExperience, keywords, idfMap);
  const educationHtml  = renderEducation(cv.education);
  const skillsHtml     = renderSkills(tailoredSkills, keywords, idfMap);
  const contactHtml    = renderContactLine(profile);

  // Load template and substitute (replaceAll — never positional)
  const template = readFileSync(join(ROOT, 'templates/cv-template-classic.html'), 'utf-8');
  const displayName = profile.full_name || cv.name;

  const html = template
    .replaceAll('{{NAME}}', escapeHtml(displayName))
    .replaceAll('{{CONTACT_LINE}}', contactHtml)
    .replaceAll('{{EXPERIENCE_HTML}}', experienceHtml)
    .replaceAll('{{EDUCATION_HTML}}', educationHtml)
    .replaceAll('{{SKILLS_HTML}}', skillsHtml);

  // Verify placeholders resolved
  const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
  if (leftover) {
    throw new Error(`Template has unresolved placeholders: ${[...new Set(leftover)].join(', ')}`);
  }

  // Anti-fabrication check
  const bulletCount = assertNoFabrication(cv, html);
  console.error(`[generate-cv] Anti-fabrication OK (${bulletCount} bullets verified)`);

  // Write HTML to temp
  const slug = args.slug || 'cv';
  const tmpHtml = join(tmpdir(), `cv-${slug}-${Date.now()}.html`);
  writeFileSync(tmpHtml, html);

  // Render PDF by importing renderHtmlToPdf directly (no subprocess)
  const outPath = resolve(args.out);
  console.error(`[generate-cv] Rendering: ${tmpHtml} → ${outPath}`);

  // Auto-retry with progressively tighter margins if the first attempt is 2 pages.
  // This handles the edge case where certain tailorings push content over one page.
  const marginFallback = [args.margin, '0.2in', '0.15in'];
  let result;
  let usedMargin;
  for (const m of marginFallback) {
    result = await renderHtmlToPdf({
      inputPath: tmpHtml,
      outputPath: outPath,
      format: 'letter',
      margin: m,
      quiet: true,
    });
    usedMargin = m;
    if (result.pageCount === 1) break;
    console.error(`[generate-cv]   margin=${m} → ${result.pageCount} pages, trying tighter`);
  }

  console.error(`[generate-cv]   Pages: ${result.pageCount}, Size: ${(result.size / 1024).toFixed(1)} KB, margin: ${usedMargin}`);

  if (result.pageCount !== 1) {
    console.error(`[generate-cv] ❌ HARD FAIL — PDF is ${result.pageCount} pages even at tightest margin: ${outPath}`);
    process.exit(2);
  }

  console.log(`[generate-cv] ✅ ${outPath}`);
}

main().catch(err => {
  console.error(`[generate-cv] FATAL: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
