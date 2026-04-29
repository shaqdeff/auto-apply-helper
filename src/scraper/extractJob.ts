import type { Locator, Page } from "playwright";
import {
  collectLocatorTexts,
  compactText,
  getMetaContent,
  readLocatorText,
  truncateText,
  waitForPageReady
} from "../utils";
import type { ExtractionConfidence, JobData, JobExtractionOptions, JsonLdJobPosting } from "./types";

interface DescriptionCandidate {
  name: string;
  locator: Locator;
  maxItems?: number;
}

interface JsonLdExtraction {
  title: string | null;
  companyName: string | null;
  description: string | null;
  notes: string[];
}

const DESCRIPTION_TERMS = [
  "responsibilities",
  "requirements",
  "qualifications",
  "experience",
  "benefits",
  "about the role",
  "what you will do"
];

const INVALID_COMPANY_TEXTS = new Set([
  "apply",
  "apply now",
  "view job",
  "log in",
  "login",
  "sign in",
  "sign up"
]);

export async function extractJobData(
  page: Page,
  options: JobExtractionOptions = {}
): Promise<JobData> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxDescriptionLength = options.maxDescriptionLength ?? 8_000;

  await waitForPageReady(page, timeoutMs);

  const notes: string[] = [];
  const jsonLd = await extractJsonLdJobPosting(page);
  notes.push(...jsonLd.notes);

  const visibleTitle = await extractTitle(page, timeoutMs);
  const visibleCompany = await extractCompanyName(page, timeoutMs);
  const visibleDescription = await extractDescription(page, timeoutMs);

  const title = jsonLd.title ?? visibleTitle;
  const companyName = jsonLd.companyName ?? visibleCompany;
  const description = truncateText(jsonLd.description ?? visibleDescription, maxDescriptionLength);

  if (!jsonLd.title && visibleTitle) {
    notes.push("Title extracted from visible page content.");
  }

  if (!jsonLd.companyName && visibleCompany) {
    notes.push("Company name extracted from visible page content.");
  }

  if (!jsonLd.description && visibleDescription) {
    notes.push("Description extracted from visible page content.");
  }

  return {
    title,
    companyName,
    description,
    sourceUrl: page.url(),
    scrapedAt: new Date().toISOString(),
    metadata: {
      confidence: getConfidence(title, companyName, description),
      extractionNotes: notes
    }
  };
}

async function extractTitle(page: Page, timeoutMs: number): Promise<string | null> {
  const candidates = [
    page.locator('[data-testid*="job-title" i], [class*="job-title" i], [id*="job-title" i], [itemprop="title"]'),
    page.getByRole("heading", { level: 1 }),
    page.locator("h1")
  ];

  for (const locator of candidates) {
    const text = await readLocatorText(locator, { timeoutMs });
    if (text) {
      return text;
    }
  }

  const metaTitle = await getMetaContent(page, [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]'
  ]);

  return metaTitle ?? compactText(await page.title().catch(() => null));
}

async function extractCompanyName(page: Page, timeoutMs: number): Promise<string | null> {
  const companyLinks = await collectLocatorTexts(page.locator('a[href*="/companies/"]'), {
    maxItems: 8,
    timeoutMs,
    visibleOnly: true
  });
  const linkedCompany = companyLinks.find(isValidCompanyName);
  if (linkedCompany) {
    return linkedCompany;
  }

  const candidates = [
    page.locator(
      '[data-testid*="company" i], [class*="company" i], [id*="company" i], [itemprop="hiringOrganization"]'
    ),
    page.locator('a[href*="company" i], a[href*="organization" i], a[href*="employer" i]'),
    page.locator('[aria-label*="company" i], [aria-label*="employer" i]')
  ];

  for (const locator of candidates) {
    const texts = await collectLocatorTexts(locator, {
      maxItems: 8,
      timeoutMs,
      visibleOnly: true
    });
    const text = texts.find(isValidCompanyName);

    if (text) {
      return text;
    }
  }

  const visibleTitle = await extractTitle(page, timeoutMs);
  return extractCompanyFromTitle(visibleTitle);
}

async function extractDescription(page: Page, timeoutMs: number): Promise<string | null> {
  const candidates: DescriptionCandidate[] = [
    {
      name: "semantic job description",
      locator: page.locator(
        '[data-testid*="job-description" i], [class*="job-description" i], [id*="job-description" i], [itemprop="description"]'
      ),
      maxItems: 4
    },
    {
      name: "description section",
      locator: page.locator('section:has-text("Description"), section:has-text("Responsibilities"), section:has-text("Requirements")'),
      maxItems: 4
    },
    {
      name: "article",
      locator: page.locator("article"),
      maxItems: 2
    },
    {
      name: "main",
      locator: page.locator("main"),
      maxItems: 1
    }
  ];

  let bestText: string | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const texts = await collectLocatorTexts(candidate.locator, {
      maxItems: candidate.maxItems ?? 3,
      timeoutMs,
      visibleOnly: true
    });

    for (const text of texts) {
      const score = scoreDescription(text);

      if (score > bestScore) {
        bestText = text;
        bestScore = score;
      }
    }
  }

  if (bestScore >= 80) {
    return bestText;
  }

  return extractDescriptionFromBodyText(page);
}

async function extractJsonLdJobPosting(page: Page): Promise<JsonLdExtraction> {
  const notes: string[] = [];
  const scripts = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? "").filter(Boolean))
    .catch(() => []);

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script) as unknown;
      const posting = findJobPosting(parsed);

      if (posting) {
        notes.push("JobPosting JSON-LD found and used as primary structured source.");

        return {
          title: compactText(posting.title),
          companyName: extractOrganizationName(posting),
          description: await htmlToText(page, posting.description),
          notes
        };
      }
    } catch {
      notes.push("A JSON-LD script was present but could not be parsed.");
    }
  }

  return {
    title: null,
    companyName: null,
    description: null,
    notes
  };
}

function findJobPosting(value: unknown): JsonLdJobPosting | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findJobPosting(item);
      if (match) {
        return match;
      }
    }

    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (matchesJobPostingType(value["@type"])) {
    return value as JsonLdJobPosting;
  }

  for (const nestedValue of Object.values(value)) {
    const match = findJobPosting(nestedValue);
    if (match) {
      return match;
    }
  }

  return null;
}

function matchesJobPostingType(typeValue: unknown): boolean {
  if (Array.isArray(typeValue)) {
    return typeValue.some(matchesJobPostingType);
  }

  return typeof typeValue === "string" && typeValue.toLowerCase() === "jobposting";
}

function extractOrganizationName(posting: JsonLdJobPosting): string | null {
  const organization = posting.hiringOrganization;

  if (typeof organization === "string") {
    return compactText(organization);
  }

  return compactText(organization?.name);
}

async function htmlToText(page: Page, value: string | null | undefined): Promise<string | null> {
  const raw = compactText(value);
  if (!raw) {
    return null;
  }

  const text = await page
    .evaluate((html) => {
      const template = document.createElement("template");
      template.innerHTML = html;
      return template.content.textContent ?? html;
    }, raw)
    .catch(() => raw.replace(/<[^>]+>/g, " "));

  return compactText(text);
}

function scoreDescription(text: string): number {
  const normalized = text.toLowerCase();
  const termScore = DESCRIPTION_TERMS.reduce((score, term) => {
    return normalized.includes(term) ? score + 40 : score;
  }, 0);

  return Math.min(text.length, 2_000) + termScore;
}

async function extractDescriptionFromBodyText(page: Page): Promise<string | null> {
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 1_500 })
    .catch(() => null);
  const text = compactText(bodyText);

  if (!text) {
    return null;
  }

  const lowerText = text.toLowerCase();
  const startIndex = lowerText.indexOf("about the role");
  if (startIndex < 0) {
    return null;
  }

  const endMarkers = [
    "apply now other jobs",
    "other jobs at",
    "hundreds of yc startups",
    "work at a startup jobs internships"
  ];
  const markerIndexes = endMarkers
    .map((marker) => lowerText.indexOf(marker, startIndex + "about the role".length))
    .filter((index) => index > startIndex);
  const endIndex = markerIndexes.length > 0 ? Math.min(...markerIndexes) : text.length;
  const description = compactText(text.slice(startIndex, endIndex));

  return description && scoreDescription(description) >= 80 ? description : null;
}

function extractCompanyFromTitle(title: string | null): string | null {
  const match = title?.match(/\bat\s+(.+?)(?:\([^)]*\))?$/i);
  const company = compactText(match?.[1]);

  return company && isValidCompanyName(company) ? company : null;
}

function isValidCompanyName(value: string | null | undefined): value is string {
  const text = compactText(value);
  return Boolean(text && text.length <= 160 && !INVALID_COMPANY_TEXTS.has(text.toLowerCase()));
}

function getConfidence(
  title: string | null,
  companyName: string | null,
  description: string | null
): ExtractionConfidence {
  if (title && companyName && description) {
    return "high";
  }

  if (title && description) {
    return "medium";
  }

  return "low";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
