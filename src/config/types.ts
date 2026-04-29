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
  resumePath?: string;
  coverLetterPath?: string;
  workAuthorization?: string;
  sponsorshipRequired?: boolean;
  yearsOfExperience?: string;
  desiredSalary?: string;
  startDate?: string;
}

export interface AppConfig {
  profile: UserProfile;
  settings: AppSettings;
}

export interface AppSettings {
  headless: boolean;
  verbose: boolean;
  timeoutMs: number;
  navigationTimeoutMs: number;
  signInTimeoutMs: number;
  cookieDir: string;
  jobStorePath: string;
  /** Maximum concurrent batch jobs (sequential = 1). */
  batchConcurrency: number;
}
