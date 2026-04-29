import type { Page } from "playwright";
import {
  clickFirstAvailable,
  fillFirstAvailable,
  serializeError,
  waitForPageReady,
  type LocatorCandidate
} from "../utils";
import type { ApplicantProfile, ApplyFlowOptions, ApplyFlowResult } from "./types";

const DEFAULT_APPLICANT: ApplicantProfile = {
  fullName: "Alex Applicant",
  firstName: "Alex",
  lastName: "Applicant",
  email: "alex.applicant@example.com"
};

export async function simulateApplyFlow(
  page: Page,
  options: ApplyFlowOptions = {}
): Promise<ApplyFlowResult> {
  const timeoutMs = options.timeoutMs ?? 4_000;
  const popupTimeoutMs = options.popupTimeoutMs ?? 5_000;
  const applicant = {
    ...DEFAULT_APPLICANT,
    ...options.applicant
  };

  const result: ApplyFlowResult = {
    attempted: true,
    applyClicked: false,
    filledFields: [],
    sourcePageUrl: page.url(),
    errors: []
  };

  const popupPromise = page.waitForEvent("popup", { timeout: popupTimeoutMs }).catch(() => null);
  const clickResult = await clickFirstAvailable(getApplyButtonCandidates(page), timeoutMs);

  if (!clickResult.success) {
    result.attempted = false;
    result.skippedReason = "No visible Apply button or link was found.";

    if (clickResult.error) {
      result.errors.push(clickResult.error);
    }

    return result;
  }

  result.applyClicked = true;
  const popup = await popupPromise;
  const applicationPage = popup ?? page;

  try {
    await waitForPageReady(applicationPage, timeoutMs);
    result.applicationPageUrl = applicationPage.url();

    await fillApplicantFields(applicationPage, applicant, timeoutMs, result);
  } catch (error) {
    result.errors.push(serializeError(error));
  }

  return result;
}

async function fillApplicantFields(
  page: Page,
  applicant: ApplicantProfile,
  timeoutMs: number,
  result: ApplyFlowResult
): Promise<void> {
  const fullNameResult = await fillFirstAvailable(getFullNameCandidates(page), applicant.fullName, timeoutMs);

  if (fullNameResult.success) {
    result.filledFields.push("fullName");
  } else {
    const firstNameResult = await fillFirstAvailable(getFirstNameCandidates(page), applicant.firstName, timeoutMs);
    const lastNameResult = await fillFirstAvailable(getLastNameCandidates(page), applicant.lastName, timeoutMs);

    if (firstNameResult.success) {
      result.filledFields.push("firstName");
    }

    if (lastNameResult.success) {
      result.filledFields.push("lastName");
    }

    if (firstNameResult.error) {
      result.errors.push(firstNameResult.error);
    }

    if (lastNameResult.error) {
      result.errors.push(lastNameResult.error);
    }
  }

  const emailResult = await fillFirstAvailable(getEmailCandidates(page), applicant.email, timeoutMs);
  if (emailResult.success) {
    result.filledFields.push("email");
  } else if (emailResult.error) {
    result.errors.push(emailResult.error);
  }
}

function getApplyButtonCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: "button by accessible name",
      locator: page.getByRole("button", {
        name: /^(easy apply|apply now|apply|start application|continue)$/i
      })
    },
    {
      name: "link by accessible name",
      locator: page.getByRole("link", {
        name: /apply|apply now|easy apply|start application/i
      })
    },
    {
      name: "aria or test id apply control",
      locator: page.locator('[aria-label*="apply" i], [data-testid*="apply" i], [id*="apply" i]')
    },
    {
      name: "text fallback apply control",
      locator: page.locator('button:has-text("Apply"), a:has-text("Apply"), [role="button"]:has-text("Apply")')
    }
  ];
}

function getFullNameCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: "full name label",
      locator: page.getByLabel(/full name|legal name|your name|name/i)
    },
    {
      name: "full name attributes",
      locator: page.locator(
        'input[autocomplete="name"], input[name*="full" i][name*="name" i], input[id*="full" i][id*="name" i], input[placeholder*="full name" i]'
      )
    }
  ];
}

function getFirstNameCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: "first name label",
      locator: page.getByLabel(/first name|given name/i)
    },
    {
      name: "first name attributes",
      locator: page.locator(
        'input[autocomplete="given-name"], input[name*="first" i], input[id*="first" i], input[placeholder*="first" i]'
      )
    }
  ];
}

function getLastNameCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: "last name label",
      locator: page.getByLabel(/last name|family name|surname/i)
    },
    {
      name: "last name attributes",
      locator: page.locator(
        'input[autocomplete="family-name"], input[name*="last" i], input[id*="last" i], input[placeholder*="last" i]'
      )
    }
  ];
}

function getEmailCandidates(page: Page): LocatorCandidate[] {
  return [
    {
      name: "email label",
      locator: page.getByLabel(/email|e-mail/i)
    },
    {
      name: "email attributes",
      locator: page.locator(
        'input[type="email"], input[autocomplete="email"], input[name*="email" i], input[id*="email" i], input[placeholder*="email" i]'
      )
    }
  ];
}
