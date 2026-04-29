export type ExtractionConfidence = "high" | "medium" | "low";

export interface JobData {
  title: string | null;
  companyName: string | null;
  description: string | null;
  sourceUrl: string;
  scrapedAt: string;
  metadata: {
    confidence: ExtractionConfidence;
    extractionNotes: string[];
  };
}

export interface JobExtractionOptions {
  timeoutMs?: number;
  maxDescriptionLength?: number;
}

export interface JsonLdJobPosting {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  hiringOrganization?: string | {
    name?: string;
  };
}
