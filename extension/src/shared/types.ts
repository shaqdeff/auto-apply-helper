export interface UserProfile {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  location?: string;
  profileUrl?: string;
  linkedInUrl?: string;
  portfolioUrl?: string;
  githubUrl?: string;
  workAuthorization?: string;
  sponsorshipRequired?: boolean;
  yearsOfExperience?: string;
  desiredSalary?: string;
  startDate?: string;
}

export interface JobData {
  title: string | null;
  companyName: string | null;
  description: string | null;
  location: string | null;
  sourceUrl: string;
  scrapedAt: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface AutofillResult {
  filledFields: string[];
  errors: string[];
  applyControlDetected: boolean;
  submitControlsDetected: number;
}

export type RuntimeMessage =
  | { type: 'EXTRACT_JOB' }
  | { type: 'AUTOFILL'; profile: UserProfile }
  | { type: 'CLICK_APPLY' };

export interface ExtractJobResponse {
  job: JobData;
}

export interface AutofillResponse {
  result: AutofillResult;
}

export interface ClickApplyResponse {
  clicked: boolean;
}
