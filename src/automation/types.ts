import type { ErrorSnapshot } from "../utils";

export interface ApplicantProfile {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface ApplyFlowOptions {
  timeoutMs?: number;
  popupTimeoutMs?: number;
  applicant?: Partial<ApplicantProfile>;
}

export interface ApplyFlowResult {
  attempted: boolean;
  applyClicked: boolean;
  filledFields: string[];
  sourcePageUrl: string;
  applicationPageUrl?: string;
  skippedReason?: string;
  errors: ErrorSnapshot[];
}
