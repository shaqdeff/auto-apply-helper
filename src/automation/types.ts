import type { ErrorSnapshot } from '../utils';

export interface ApplicantProfile {
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

export interface ApplyFlowOptions {
  timeoutMs?: number;
  popupTimeoutMs?: number;
  applicant?: Partial<ApplicantProfile>;
  /** When true and a sign-in page is detected, poll until the user completes sign-in before continuing. */
  waitForSignIn?: boolean;
  /** Maximum time (ms) to wait for the user to complete sign-in. Defaults to 120 000 (2 minutes). */
  signInTimeoutMs?: number;
  /** Maximum number of multi-step "Next" / "Continue" pages to navigate. Defaults to 5. */
  maxFormSteps?: number;
  /** Whether to search iframes for application forms. Defaults to true. */
  searchIframes?: boolean;
}

export type ApplyFlowStatus =
  | 'apply_control_not_found'
  | 'apply_clicked'
  | 'blocked_by_bot_protection'
  | 'application_detected'
  | 'sign_in_required'
  | 'waiting_for_sign_in'
  | 'fields_filled';

export interface ApplyFlowResult {
  attempted: boolean;
  status: ApplyFlowStatus;
  applyClicked: boolean;
  applyControlDetected: boolean;
  filledFields: string[];
  sourcePageUrl: string;
  applicationPageUrl?: string;
  userMessage?: string;
  submitControlsDetected: number;
  submitAttempted: false;
  skippedReason?: string;
  errors: ErrorSnapshot[];
}
