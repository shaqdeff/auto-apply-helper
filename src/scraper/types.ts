export type ExtractionConfidence = 'high' | 'medium' | 'low';

export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export type EmploymentType =
  | 'full-time'
  | 'part-time'
  | 'contract'
  | 'internship'
  | 'temporary'
  | 'unknown';

export interface SalaryRange {
  min?: number;
  max?: number;
  currency?: string;
  period?: string;
}

export interface JobData {
  title: string | null;
  companyName: string | null;
  description: string | null;
  location: string | null;
  workMode: WorkMode;
  employmentType: EmploymentType;
  salary: SalaryRange | null;
  datePosted: string | null;
  applicationDeadline: string | null;
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
  '@type'?: string | string[];
  title?: string;
  description?: string;
  hiringOrganization?:
    | string
    | {
        name?: string;
      };
  jobLocation?: JsonLdLocation | JsonLdLocation[];
  jobLocationType?: string;
  employmentType?: string | string[];
  baseSalary?: JsonLdSalary;
  datePosted?: string;
  validThrough?: string;
}

export interface JsonLdLocation {
  '@type'?: string;
  address?:
    | string
    | {
        addressLocality?: string;
        addressRegion?: string;
        addressCountry?: string;
      };
}

export interface JsonLdSalary {
  '@type'?: string;
  currency?: string;
  value?:
    | number
    | {
        '@type'?: string;
        minValue?: number;
        maxValue?: number;
        unitText?: string;
      };
}
