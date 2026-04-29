import type { Page } from 'playwright';
import {
  clickFirstAvailable,
  fillFirstAvailable,
  logger,
  serializeError,
  sleep,
  waitForPageReady,
  type LocatorCandidate,
} from '../utils';
import type {
  ApplicantProfile,
  ApplyFlowOptions,
  ApplyFlowResult,
} from './types';

const DEFAULT_APPLICANT: ApplicantProfile = {
  fullName: 'Alex Applicant',
  firstName: 'Alex',
  lastName: 'Applicant',
  email: 'alex.applicant@example.com',
  phone: '555-0100',
  location: 'San Francisco, CA',
  profileUrl: 'https://example.com/alex-applicant',
  linkedInUrl: 'https://www.linkedin.com/in/alex-applicant',
  portfolioUrl: 'https://example.com/portfolio',
};

export async function simulateApplyFlow(
  page: Page,
  options: ApplyFlowOptions = {},
): Promise<ApplyFlowResult> {
  const timeoutMs = options.timeoutMs ?? 4_000;
  const popupTimeoutMs = options.popupTimeoutMs ?? 5_000;
  const waitForSignIn = options.waitForSignIn ?? false;
  const signInTimeoutMs = options.signInTimeoutMs ?? 120_000;
  const applicant = {
    ...DEFAULT_APPLICANT,
    ...options.applicant,
  };

  const result: ApplyFlowResult = {
    attempted: true,
    status: 'apply_clicked',
    applyClicked: false,
    applyControlDetected: false,
    filledFields: [],
    sourcePageUrl: page.url(),
    submitControlsDetected: 0,
    submitAttempted: false,
    errors: [],
  };

  if (await hasApplicationForm(page, timeoutMs)) {
    result.status = 'application_detected';
    result.applyControlDetected = true;
    result.applicationPageUrl = page.url();
    await fillApplicationPage(
      page,
      applicant,
      timeoutMs,
      waitForSignIn,
      signInTimeoutMs,
      result,
    );
    return result;
  }

  const popupPromise = page
    .waitForEvent('popup', { timeout: popupTimeoutMs })
    .catch(() => null);
  const clickResult = await clickFirstAvailable(
    getApplyButtonCandidates(page),
    timeoutMs,
  );

  if (!clickResult.success) {
    result.attempted = false;
    result.status = 'apply_control_not_found';
    result.skippedReason = 'No visible Apply button or link was found.';

    if (clickResult.error) {
      result.errors.push(clickResult.error);
    }

    return result;
  }

  result.applyClicked = true;
  result.applyControlDetected = true;
  const popup = await popupPromise;
  const applicationPage = popup ?? page;

  try {
    await waitForPageReady(applicationPage, timeoutMs);
    result.applicationPageUrl = applicationPage.url();

    await fillApplicationPage(
      applicationPage,
      applicant,
      timeoutMs,
      waitForSignIn,
      signInTimeoutMs,
      result,
    );
  } catch (error) {
    result.errors.push(serializeError(error));
  }

  return result;
}

async function fillApplicationPage(
  page: Page,
  applicant: ApplicantProfile,
  timeoutMs: number,
  waitForSignIn: boolean,
  signInTimeoutMs: number,
  result: ApplyFlowResult,
): Promise<void> {
  result.submitControlsDetected = await countSubmitControls(page);

  if (await isSignInPage(page, timeoutMs)) {
    if (!waitForSignIn) {
      result.status = 'sign_in_required';
      result.userMessage = 'Please sign in, then reopen extension.';
      result.skippedReason =
        'Redirected to a sign-in page before the application form was available.';
      return;
    }

    result.status = 'waiting_for_sign_in';
    logger.info(
      'Sign-in page detected — waiting for you to log in in the browser…',
      {
        signInTimeoutMs,
      },
    );

    const signedIn = await waitUntilSignedIn(page, timeoutMs, signInTimeoutMs);

    if (!signedIn) {
      result.status = 'sign_in_required';
      result.userMessage =
        'Sign-in was not completed in time. Please sign in and try again.';
      result.skippedReason =
        'Timed out waiting for the user to complete sign-in.';
      return;
    }

    logger.info('Sign-in completed — continuing apply flow');
    await waitForPageReady(page, timeoutMs);
    result.applicationPageUrl = page.url();
    result.submitControlsDetected = await countSubmitControls(page);
  }

  await fillApplicantFields(page, applicant, timeoutMs, result);

  if (result.filledFields.length > 0) {
    result.status = 'fields_filled';
    result.userMessage =
      'Application fields filled. Review the form before submitting manually.';
  } else {
    result.status = 'application_detected';
    result.skippedReason =
      'Application page opened, but no supported profile fields were editable.';
  }
}

const SIGN_IN_POLL_INTERVAL_MS = 2_000;

async function waitUntilSignedIn(
  page: Page,
  detectionTimeoutMs: number,
  maxWaitMs: number,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await sleep(SIGN_IN_POLL_INTERVAL_MS);

    const stillSignIn = await isSignInPage(page, detectionTimeoutMs);
    if (!stillSignIn) {
      return true;
    }
  }

  return false;
}

async function fillApplicantFields(
  page: Page,
  applicant: ApplicantProfile,
  timeoutMs: number,
  result: ApplyFlowResult,
): Promise<void> {
  const fullNameResult = await fillFirstAvailable(
    getFullNameCandidates(page),
    applicant.fullName,
    timeoutMs,
  );

  if (fullNameResult.success) {
    result.filledFields.push('fullName');
  } else {
    const firstNameResult = await fillFirstAvailable(
      getFirstNameCandidates(page),
      applicant.firstName,
      timeoutMs,
    );
    const lastNameResult = await fillFirstAvailable(
      getLastNameCandidates(page),
      applicant.lastName,
      timeoutMs,
    );

    if (firstNameResult.success) {
      result.filledFields.push('firstName');
    }

    if (lastNameResult.success) {
      result.filledFields.push('lastName');
    }

    if (firstNameResult.error) {
      result.errors.push(firstNameResult.error);
    }

    if (lastNameResult.error) {
      result.errors.push(lastNameResult.error);
    }
  }

  const emailResult = await fillFirstAvailable(
    getEmailCandidates(page),
    applicant.email,
    timeoutMs,
  );
  if (emailResult.success) {
    result.filledFields.push('email');
  } else if (emailResult.error) {
    result.errors.push(emailResult.error);
  }

  await fillOptionalField(
    page,
    getPhoneCandidates(page),
    applicant.phone,
    'phone',
    timeoutMs,
    result,
  );
  await fillOptionalField(
    page,
    getLocationCandidates(page),
    applicant.location,
    'location',
    timeoutMs,
    result,
  );
  await fillOptionalField(
    page,
    getProfileUrlCandidates(page),
    applicant.profileUrl,
    'profileUrl',
    timeoutMs,
    result,
  );
  await fillOptionalField(
    page,
    getLinkedInCandidates(page),
    applicant.linkedInUrl,
    'linkedInUrl',
    timeoutMs,
    result,
  );
  await fillOptionalField(
    page,
    getPortfolioCandidates(page),
    applicant.portfolioUrl,
    'portfolioUrl',
    timeoutMs,
    result,
  );
}

async function fillOptionalField(
  page: Page,
  candidates: LocatorCandidate[],
  value: string | undefined,
  fieldName: string,
  timeoutMs: number,
  result: ApplyFlowResult,
): Promise<void> {
  if (!value) {
    return;
  }

  const fieldResult = await fillFirstAvailable(candidates, value, timeoutMs);
  if (fieldResult.success) {
    result.filledFields.push(fieldName);
  }
}

async function hasApplicationForm(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  return (
    (await hasVisibleCandidate(getFullNameCandidates(page), timeoutMs)) ||
    (await hasVisibleCandidate(getFirstNameCandidates(page), timeoutMs)) ||
    (await hasVisibleCandidate(getEmailCandidates(page), timeoutMs))
  );
}

async function hasVisibleCandidate(
  candidates: LocatorCandidate[],
  timeoutMs: number,
): Promise<boolean> {
  for (const candidate of candidates) {
    const isVisible = await candidate.locator
      .first()
      .isVisible({ timeout: Math.min(timeoutMs, 1_000) })
      .catch(() => false);

    if (isVisible) {
      return true;
    }
  }

  return false;
}

async function isSignInPage(page: Page, timeoutMs: number): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (/\b(login|log-in|signin|sign-in|auth|sso|oauth)\b/.test(url)) {
    return true;
  }

  const passwordVisible = await page
    .locator('input[type="password"], input[autocomplete="current-password"]')
    .first()
    .isVisible({ timeout: Math.min(timeoutMs, 1_000) })
    .catch(() => false);

  if (passwordVisible) {
    return true;
  }

  const signInControlVisible = await page
    .getByRole('button', { name: /^(sign in|log in|continue with|continue)$/i })
    .first()
    .isVisible({ timeout: Math.min(timeoutMs, 1_000) })
    .catch(() => false);

  return signInControlVisible;
}

async function countSubmitControls(page: Page): Promise<number> {
  return page
    .locator(
      'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Send application"), button:has-text("Review application")',
    )
    .count()
    .catch(() => 0);
}

function getApplyButtonCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: 'button by accessible name',
      locator: page.getByRole('button', {
        name: /^(easy apply|apply now|apply|start application|continue)$/i,
      }),
    },
    {
      name: 'link by accessible name',
      locator: page.getByRole('link', {
        name: /apply|apply now|easy apply|start application/i,
      }),
    },
    {
      name: 'aria or test id apply control',
      locator: page.locator(
        '[aria-label*="apply" i], [data-testid*="apply" i], [id*="apply" i]',
      ),
    },
    {
      name: 'text fallback apply control',
      locator: page.locator(
        'button:has-text("Apply"), a:has-text("Apply"), [role="button"]:has-text("Apply")',
      ),
    },
  ];
}

function getFullNameCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: 'full name label',
      locator: page.getByLabel(/full name|legal name|your name|name/i),
    },
    {
      name: 'full name attributes',
      locator: page.locator(
        'input[autocomplete="name"], input[name*="full" i][name*="name" i], input[id*="full" i][id*="name" i], input[placeholder*="full name" i]',
      ),
    },
  ];
}

function getFirstNameCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: 'first name label',
      locator: page.getByLabel(/first name|given name/i),
    },
    {
      name: 'first name attributes',
      locator: page.locator(
        'input[autocomplete="given-name"], input[name*="first" i], input[id*="first" i], input[placeholder*="first" i]',
      ),
    },
  ];
}

function getLastNameCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: 'last name label',
      locator: page.getByLabel(/last name|family name|surname/i),
    },
    {
      name: 'last name attributes',
      locator: page.locator(
        'input[autocomplete="family-name"], input[name*="last" i], input[id*="last" i], input[placeholder*="last" i]',
      ),
    },
  ];
}

function getEmailCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: 'email label',
      locator: page.getByLabel(/email|e-mail/i),
    },
    {
      name: 'email attributes',
      locator: page.locator(
        'input[type="email"], input[autocomplete="email"], input[name*="email" i], input[id*="email" i], input[placeholder*="email" i]',
      ),
    },
  ];
}

function getPhoneCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: 'phone label',
      locator: page.getByLabel(/phone|mobile|telephone/i),
    },
    {
      name: 'phone attributes',
      locator: page.locator(
        'input[type="tel"], input[autocomplete="tel"], input[name*="phone" i], input[id*="phone" i], input[placeholder*="phone" i]',
      ),
    },
  ];
}

function getLocationCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: 'location label',
      locator: page.getByLabel(/location|city|address/i),
    },
    {
      name: 'location attributes',
      locator: page.locator(
        'input[autocomplete="address-level2"], input[name*="location" i], input[id*="location" i], input[placeholder*="location" i], input[name*="city" i], input[id*="city" i]',
      ),
    },
  ];
}

function getProfileUrlCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: 'profile url label',
      locator: page.getByLabel(
        /profile url|website|personal site|personal url/i,
      ),
    },
    {
      name: 'profile url attributes',
      locator: page.locator(
        'input[name*="profile" i], input[id*="profile" i], input[placeholder*="profile" i], input[name*="website" i], input[id*="website" i]',
      ),
    },
  ];
}

function getLinkedInCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: 'linkedin label',
      locator: page.getByLabel(/linkedin|linked in/i),
    },
    {
      name: 'linkedin attributes',
      locator: page.locator(
        'input[name*="linkedin" i], input[id*="linkedin" i], input[placeholder*="linkedin" i], input[name*="linked_in" i], input[id*="linked_in" i]',
      ),
    },
  ];
}

function getPortfolioCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: 'portfolio label',
      locator: page.getByLabel(/portfolio|github|work samples/i),
    },
    {
      name: 'portfolio attributes',
      locator: page.locator(
        'input[name*="portfolio" i], input[id*="portfolio" i], input[placeholder*="portfolio" i], input[name*="github" i], input[id*="github" i]',
      ),
    },
  ];
}
