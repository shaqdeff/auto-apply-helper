import * as fs from 'node:fs';
import type { Frame, Page } from 'playwright';
import {
  checkFirstAvailable,
  clickFirstAvailable,
  fillFirstAvailable,
  logger,
  selectFirstAvailable,
  serializeError,
  sleep,
  uploadFile,
  waitForPageReady,
  waitForUrlStable,
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
  const maxFormSteps = options.maxFormSteps ?? 5;
  const searchIframes = options.searchIframes ?? true;
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

  // Check main page and iframes for an existing application form
  const formTarget = await findFormTarget(page, timeoutMs, searchIframes);
  if (formTarget) {
    result.status = 'application_detected';
    result.applyControlDetected = true;
    result.applicationPageUrl = page.url();
    await fillApplicationPage(
      formTarget,
      applicant,
      timeoutMs,
      waitForSignIn,
      signInTimeoutMs,
      maxFormSteps,
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
    // Wait for the application page to fully settle (SPA routing)
    await waitForUrlStable(applicationPage, 2_000, 10_000);
    await waitForPageReady(applicationPage, timeoutMs);
    result.applicationPageUrl = applicationPage.url();

    // Check if application is in an iframe within the new page
    const formPage =
      (await findFormTarget(applicationPage, timeoutMs, searchIframes)) ??
      applicationPage;
    await fillApplicationPage(
      formPage,
      applicant,
      timeoutMs,
      waitForSignIn,
      signInTimeoutMs,
      maxFormSteps,
      result,
    );
  } catch (error) {
    result.errors.push(serializeError(error));
  }

  return result;
}

async function fillApplicationPage(
  page: Page | Frame,
  applicant: ApplicantProfile,
  timeoutMs: number,
  waitForSignIn: boolean,
  signInTimeoutMs: number,
  maxFormSteps: number,
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
    // Wait for the SPA to settle on the actual application page
    const stableUrl = await waitForUrlStable(page, 2_000, 15_000);
    await waitForPageReady(page, timeoutMs);
    logger.info('Application page stabilized after sign-in', {
      url: stableUrl,
    });
    result.applicationPageUrl = page.url();
    result.submitControlsDetected = await countSubmitControls(page);
  }

  // Fill fields on the current step, then navigate through multi-step forms.
  // Track visited URLs to detect SPA-driven step changes.
  const visitedSteps = new Set<string>();

  for (let step = 0; step <= maxFormSteps; step += 1) {
    const stepUrl = page.url();

    // Avoid re-processing a step we already visited
    if (visitedSteps.has(stepUrl)) {
      logger.debug('Already visited this step URL, stopping', {
        url: stepUrl,
      });
      break;
    }

    visitedSteps.add(stepUrl);
    logger.info('Filling form step', {
      step: step + 1,
      url: stepUrl,
    });

    const fieldsBefore = result.filledFields.length;
    await fillApplicantFields(page, applicant, timeoutMs, result);
    await fillExtendedFields(page, applicant, timeoutMs, result);
    const fieldsAfter = result.filledFields.length;

    logger.debug('Step fill complete', {
      step: step + 1,
      fieldsFilledThisStep: fieldsAfter - fieldsBefore,
    });

    // Check if the SPA auto-navigated to a new step during filling
    const currentUrl = page.url();
    if (currentUrl !== stepUrl) {
      logger.info('SPA auto-navigated during fill', {
        from: stepUrl,
        to: currentUrl,
      });
      // Wait for the new step to settle before continuing
      await waitForUrlStable(page, 1_500, 8_000);
      await waitForPageReady(page, timeoutMs);
      continue;
    }

    if (step < maxFormSteps) {
      const advanced = await advanceFormStep(page, timeoutMs);
      if (!advanced) {
        break;
      }

      logger.info('Advanced to next form step', { step: step + 2 });
      // Wait for the next step to load
      await waitForUrlStable(page, 1_500, 8_000);
      await waitForPageReady(page, timeoutMs);
      result.submitControlsDetected = await countSubmitControls(page);
    }
  }

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
  page: Page | Frame,
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

async function findFormTarget(
  page: Page,
  timeoutMs: number,
  searchIframes: boolean,
): Promise<Page | Frame | null> {
  if (await hasApplicationForm(page, timeoutMs)) {
    return page;
  }

  if (searchIframes) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) {
        continue;
      }

      try {
        if (await hasApplicationForm(frame, timeoutMs)) {
          logger.info('Application form found in iframe', {
            url: frame.url(),
          });
          return frame;
        }
      } catch {
        // Frame may have been detached
      }
    }
  }

  return null;
}

async function advanceFormStep(
  page: Page | Frame,
  timeoutMs: number,
): Promise<boolean> {
  const nextCandidates: LocatorCandidate[] = [
    {
      name: 'next button by role',
      locator: page.getByRole('button', {
        name: /^(next|continue|save & continue|save and continue|proceed)$/i,
      }),
    },
    {
      name: 'next button by text',
      locator: page.locator(
        'button:has-text("Next"), button:has-text("Continue"), button:has-text("Save & Continue"), a:has-text("Next")',
      ),
    },
  ];

  // Don't click if we see a submit button but no next button
  const submitCount = await countSubmitControls(page);
  if (submitCount > 0) {
    // Check if there's also a next/continue button — if not, we're on the final step
    for (const candidate of nextCandidates) {
      const visible = await candidate.locator
        .first()
        .isVisible({ timeout: Math.min(timeoutMs, 1_000) })
        .catch(() => false);
      if (visible) {
        const clickResult = await clickFirstAvailable([candidate], timeoutMs);
        if (clickResult.success) {
          await sleep(1_500);
          return true;
        }
      }
    }
    return false;
  }

  const clickResult = await clickFirstAvailable(nextCandidates, timeoutMs);
  if (clickResult.success) {
    await sleep(1_500);
    return true;
  }

  return false;
}

async function fillExtendedFields(
  page: Page | Frame,
  applicant: ApplicantProfile,
  timeoutMs: number,
  result: ApplyFlowResult,
): Promise<void> {
  // Resume upload
  if (applicant.resumePath && fs.existsSync(applicant.resumePath)) {
    const resumeCandidates: LocatorCandidate[] = [
      {
        name: 'resume file input by label',
        locator: page.locator(
          'input[type="file"][name*="resume" i], input[type="file"][id*="resume" i], input[type="file"][name*="cv" i], input[type="file"][id*="cv" i]',
        ),
      },
      {
        name: 'resume file input generic',
        locator: page.locator('input[type="file"]'),
      },
    ];

    const resumeResult = await uploadFile(
      page as Page,
      resumeCandidates,
      applicant.resumePath,
      timeoutMs,
    );
    if (resumeResult.success) {
      result.filledFields.push('resume');
      logger.info('Resume uploaded', { path: applicant.resumePath });
    }
  }

  // Cover letter upload
  if (applicant.coverLetterPath && fs.existsSync(applicant.coverLetterPath)) {
    const coverLetterCandidates: LocatorCandidate[] = [
      {
        name: 'cover letter file input',
        locator: page.locator(
          'input[type="file"][name*="cover" i], input[type="file"][id*="cover" i]',
        ),
      },
    ];

    const coverResult = await uploadFile(
      page as Page,
      coverLetterCandidates,
      applicant.coverLetterPath,
      timeoutMs,
    );
    if (coverResult.success) {
      result.filledFields.push('coverLetter');
    }
  }

  // GitHub URL
  await fillOptionalField(
    page,
    getGithubCandidates(page),
    applicant.githubUrl,
    'githubUrl',
    timeoutMs,
    result,
  );

  // Work authorization (dropdown)
  if (applicant.workAuthorization) {
    const workAuthCandidates: LocatorCandidate[] = [
      {
        name: 'work auth select',
        locator: page.locator(
          'select[name*="authorization" i], select[id*="authorization" i], select[name*="work_auth" i], select[name*="visa" i]',
        ),
      },
      {
        name: 'work auth by label',
        locator: page.getByLabel(
          /work authorization|authorized to work|visa status/i,
        ),
      },
    ];

    const selectResult = await selectFirstAvailable(
      workAuthCandidates,
      applicant.workAuthorization,
      timeoutMs,
    );
    if (selectResult.success) {
      result.filledFields.push('workAuthorization');
    } else {
      // Try filling as text input instead
      const fillResult = await fillFirstAvailable(
        workAuthCandidates,
        applicant.workAuthorization,
        timeoutMs,
      );
      if (fillResult.success) {
        result.filledFields.push('workAuthorization');
      }
    }
  }

  // Sponsorship required (checkbox)
  if (applicant.sponsorshipRequired !== undefined) {
    const sponsorshipCandidates: LocatorCandidate[] = [
      {
        name: 'sponsorship checkbox',
        locator: page.locator(
          'input[type="checkbox"][name*="sponsor" i], input[type="checkbox"][id*="sponsor" i]',
        ),
      },
      {
        name: 'sponsorship by label',
        locator: page.getByLabel(/sponsor|visa sponsor/i),
      },
    ];

    const checkResult = await checkFirstAvailable(
      sponsorshipCandidates,
      applicant.sponsorshipRequired,
      timeoutMs,
    );
    if (checkResult.success) {
      result.filledFields.push('sponsorshipRequired');
    }
  }

  // Years of experience
  await fillOptionalField(
    page,
    getYearsOfExperienceCandidates(page),
    applicant.yearsOfExperience,
    'yearsOfExperience',
    timeoutMs,
    result,
  );

  // Desired salary
  await fillOptionalField(
    page,
    getSalaryCandidates(page),
    applicant.desiredSalary,
    'desiredSalary',
    timeoutMs,
    result,
  );

  // Start date
  await fillOptionalField(
    page,
    getStartDateCandidates(page),
    applicant.startDate,
    'startDate',
    timeoutMs,
    result,
  );
}

async function fillApplicantFields(
  page: Page | Frame,
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
  page: Page | Frame,
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
  page: Page | Frame,
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

async function isSignInPage(
  page: Page | Frame,
  timeoutMs: number,
): Promise<boolean> {
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

async function countSubmitControls(page: Page | Frame): Promise<number> {
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

function getFullNameCandidates(page: Page | Frame): LocatorCandidate[] {
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

function getFirstNameCandidates(page: Page | Frame): LocatorCandidate[] {
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

function getLastNameCandidates(page: Page | Frame): LocatorCandidate[] {
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

function getEmailCandidates(page: Page | Frame): LocatorCandidate[] {
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

function getPhoneCandidates(page: Page | Frame): LocatorCandidate[] {
  return [
    {
      name: 'phone by tel type',
      locator: page.locator('input[type="tel"]'),
    },
    {
      name: 'phone label (text inputs only)',
      locator: page
        .getByLabel(/phone number|mobile number|telephone/i)
        .locator('visible=true'),
    },
    {
      name: 'phone attributes',
      locator: page.locator(
        'input[type="tel"], input[autocomplete="tel"], input:not([type="radio"]):not([type="checkbox"])[name*="phone" i], input:not([type="radio"]):not([type="checkbox"])[id*="phone" i], input:not([type="radio"]):not([type="checkbox"])[placeholder*="phone" i]',
      ),
    },
  ];
}

function getLocationCandidates(page: Page | Frame): LocatorCandidate[] {
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

function getProfileUrlCandidates(page: Page | Frame): LocatorCandidate[] {
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

function getLinkedInCandidates(page: Page | Frame): LocatorCandidate[] {
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

function getPortfolioCandidates(page: Page | Frame): LocatorCandidate[] {
  return [
    {
      name: 'portfolio label',
      locator: page.getByLabel(/portfolio|work samples/i),
    },
    {
      name: 'portfolio attributes',
      locator: page.locator(
        'input[name*="portfolio" i], input[id*="portfolio" i], input[placeholder*="portfolio" i]',
      ),
    },
  ];
}

function getGithubCandidates(page: Page | Frame): LocatorCandidate[] {
  return [
    {
      name: 'github label',
      locator: page.getByLabel(/github/i),
    },
    {
      name: 'github attributes',
      locator: page.locator(
        'input[name*="github" i], input[id*="github" i], input[placeholder*="github" i]',
      ),
    },
  ];
}

function getYearsOfExperienceCandidates(
  page: Page | Frame,
): LocatorCandidate[] {
  return [
    {
      name: 'experience label',
      locator: page.getByLabel(/years of experience|experience/i),
    },
    {
      name: 'experience attributes',
      locator: page.locator(
        'input[name*="experience" i], input[id*="experience" i], select[name*="experience" i], select[id*="experience" i]',
      ),
    },
  ];
}

function getSalaryCandidates(page: Page | Frame): LocatorCandidate[] {
  return [
    {
      name: 'salary label',
      locator: page.getByLabel(/salary|compensation|desired pay/i),
    },
    {
      name: 'salary attributes',
      locator: page.locator(
        'input[name*="salary" i], input[id*="salary" i], input[name*="compensation" i], input[id*="compensation" i]',
      ),
    },
  ];
}

function getStartDateCandidates(page: Page | Frame): LocatorCandidate[] {
  return [
    {
      name: 'start date label',
      locator: page.getByLabel(/start date|available|availability/i),
    },
    {
      name: 'start date attributes',
      locator: page.locator(
        'input[name*="start_date" i], input[id*="start_date" i], input[name*="available" i], input[id*="available" i]',
      ),
    },
  ];
}
