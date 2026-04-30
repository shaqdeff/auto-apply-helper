import type { JobData } from '../shared/types';

const DESCRIPTION_TERMS = [
  'responsibilities',
  'requirements',
  'qualifications',
  'experience',
  'benefits',
  'about the role',
  'what you will do',
];

const INVALID_COMPANY_TEXTS = new Set([
  'apply',
  'apply now',
  'view job',
  'log in',
  'login',
  'sign in',
  'sign up',
]);

export function extractJob(): JobData {
  const jsonLd = extractJsonLd();

  const title = jsonLd?.title ?? extractTitle();
  const companyName = jsonLd?.companyName ?? extractCompanyName();
  const description = jsonLd?.description ?? extractDescription();
  const location = jsonLd?.location ?? extractLocation();

  const confidence = getConfidence(title, companyName, description);

  return {
    title,
    companyName,
    description,
    location,
    sourceUrl: location_href(),
    scrapedAt: new Date().toISOString(),
    confidence,
  };
}

function location_href(): string {
  return window.location.href;
}

interface JsonLdResult {
  title: string | null;
  companyName: string | null;
  description: string | null;
  location: string | null;
}

function extractJsonLd(): JsonLdResult | null {
  const scripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>(
      'script[type="application/ld+json"]',
    ),
  );

  for (const script of scripts) {
    const text = script.textContent;
    if (!text) continue;

    try {
      const parsed = JSON.parse(text);
      const posting = findJobPosting(parsed);
      if (posting) {
        return {
          title: compactText(posting.title),
          companyName: extractOrgName(posting.hiringOrganization),
          description: htmlToText(posting.description),
          location: extractJobLocation(posting.jobLocation),
        };
      }
    } catch {
      // skip invalid JSON
    }
  }

  return null;
}

function findJobPosting(value: unknown): any {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const t = obj['@type'];
    if (
      (typeof t === 'string' && t.toLowerCase() === 'jobposting') ||
      (Array.isArray(t) &&
        t.some(
          (x) => typeof x === 'string' && x.toLowerCase() === 'jobposting',
        ))
    ) {
      return obj;
    }
    for (const v of Object.values(obj)) {
      const found = findJobPosting(v);
      if (found) return found;
    }
  }
  return null;
}

function extractOrgName(org: unknown): string | null {
  if (typeof org === 'string') return compactText(org);
  if (org && typeof org === 'object') {
    return compactText(
      (org as Record<string, unknown>).name as string | undefined,
    );
  }
  return null;
}

function extractJobLocation(loc: unknown): string | null {
  const items = Array.isArray(loc) ? loc : loc ? [loc] : [];
  const parts: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const addr = (item as Record<string, unknown>).address;
    if (typeof addr === 'string') {
      parts.push(addr);
    } else if (addr && typeof addr === 'object') {
      const a = addr as Record<string, string | undefined>;
      const segs = [
        a.addressLocality,
        a.addressRegion,
        a.addressCountry,
      ].filter(Boolean);
      if (segs.length > 0) parts.push(segs.join(', '));
    }
  }
  return parts.length > 0 ? parts.join(' | ') : null;
}

function extractTitle(): string | null {
  const selectors = [
    '[data-testid*="job-title" i]',
    '[class*="job-title" i]',
    '[id*="job-title" i]',
    '[itemprop="title"]',
    'h1',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const text = compactText(el?.textContent);
    if (text) return text;
  }

  const ogTitle = document.querySelector<HTMLMetaElement>(
    'meta[property="og:title"]',
  )?.content;
  return compactText(ogTitle) ?? compactText(document.title);
}

function extractCompanyName(): string | null {
  // Look at /companies/ links first
  const companyLinks = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/companies/"]'),
  );
  for (const link of companyLinks.slice(0, 8)) {
    const text = compactText(link.textContent);
    if (text && isValidCompany(text)) return text;
  }

  const selectors = [
    '[data-testid*="company" i]',
    '[class*="company" i]',
    '[id*="company" i]',
    '[itemprop="hiringOrganization"]',
  ];

  for (const sel of selectors) {
    const els = Array.from(document.querySelectorAll(sel)).slice(0, 8);
    for (const el of els) {
      const text = compactText(el.textContent);
      if (text && isValidCompany(text)) return text;
    }
  }

  // Fallback: extract from title pattern "Title at Company"
  const title = extractTitle();
  const match = title?.match(/\bat\s+(.+?)(?:\([^)]*\))?$/i);
  const company = compactText(match?.[1]);
  return company && isValidCompany(company) ? company : null;
}

function extractDescription(): string | null {
  const candidates = [
    '[data-testid*="job-description" i]',
    '[class*="job-description" i]',
    '[id*="job-description" i]',
    '[itemprop="description"]',
    'article',
    'main',
  ];

  let bestText: string | null = null;
  let bestScore = 0;

  for (const sel of candidates) {
    const els = Array.from(document.querySelectorAll(sel)).slice(0, 4);
    for (const el of els) {
      const text = compactText((el as HTMLElement).innerText);
      if (!text) continue;
      const score = scoreDescription(text);
      if (score > bestScore) {
        bestScore = score;
        bestText = text;
      }
    }
  }

  return bestScore >= 80 ? bestText : null;
}

function extractLocation(): string | null {
  const selectors = [
    '[data-testid*="location" i]',
    '[class*="job-location" i]',
    '[itemprop="jobLocation"]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const text = compactText(el?.textContent);
    if (text && text.length <= 200) return text;
  }

  return null;
}

function scoreDescription(text: string): number {
  const lower = text.toLowerCase();
  const termScore = DESCRIPTION_TERMS.reduce(
    (acc, term) => (lower.includes(term) ? acc + 40 : acc),
    0,
  );
  return Math.min(text.length, 2_000) + termScore;
}

function htmlToText(html: unknown): string | null {
  const raw = compactText(html as string | undefined);
  if (!raw) return null;
  const template = document.createElement('template');
  template.innerHTML = raw;
  return compactText(template.content.textContent);
}

function isValidCompany(text: string): boolean {
  return text.length <= 160 && !INVALID_COMPANY_TEXTS.has(text.toLowerCase());
}

function compactText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function getConfidence(
  title: string | null,
  company: string | null,
  description: string | null,
): 'high' | 'medium' | 'low' {
  if (title && company && description) return 'high';
  if (title && description) return 'medium';
  return 'low';
}
