import type { AutofillResult, UserProfile } from '../shared/types';

const UNFILLABLE_INPUT_TYPES = new Set([
  'radio',
  'checkbox',
  'file',
  'submit',
  'button',
  'image',
  'reset',
  'hidden',
]);

interface FieldSpec {
  name: string;
  value: string | undefined;
  selectors: string[];
  labelPatterns: RegExp[];
}

export function autofillForm(profile: UserProfile): AutofillResult {
  const result: AutofillResult = {
    filledFields: [],
    errors: [],
    applyControlDetected: hasFormFields(),
    submitControlsDetected: countSubmitControls(),
  };

  const fields: FieldSpec[] = [
    {
      name: 'fullName',
      value: profile.fullName,
      selectors: ['input[autocomplete="name"]'],
      labelPatterns: [/full name|legal name|your name/i, /^name$/i],
    },
    {
      name: 'firstName',
      value: profile.firstName,
      selectors: ['input[autocomplete="given-name"]'],
      labelPatterns: [/first name|given name/i],
    },
    {
      name: 'lastName',
      value: profile.lastName,
      selectors: ['input[autocomplete="family-name"]'],
      labelPatterns: [/last name|family name|surname/i],
    },
    {
      name: 'email',
      value: profile.email,
      selectors: ['input[type="email"]', 'input[autocomplete="email"]'],
      labelPatterns: [/email|e-mail/i],
    },
    {
      name: 'phone',
      value: profile.phone,
      selectors: ['input[type="tel"]', 'input[autocomplete="tel"]'],
      labelPatterns: [/phone number|mobile number|telephone/i],
    },
    {
      name: 'location',
      value: profile.location,
      selectors: ['input[autocomplete="address-level2"]'],
      labelPatterns: [/location|city|address/i],
    },
    {
      name: 'linkedInUrl',
      value: profile.linkedInUrl,
      selectors: [],
      labelPatterns: [/linkedin/i],
    },
    {
      name: 'githubUrl',
      value: profile.githubUrl,
      selectors: [],
      labelPatterns: [/github/i],
    },
    {
      name: 'portfolioUrl',
      value: profile.portfolioUrl,
      selectors: [],
      labelPatterns: [/portfolio|website|personal site/i],
    },
  ];

  // Try fullName first; if successful, skip first/last
  const fullNameSpec = fields.find((f) => f.name === 'fullName')!;
  const firstNameSpec = fields.find((f) => f.name === 'firstName')!;
  const lastNameSpec = fields.find((f) => f.name === 'lastName')!;

  const fullNameFilled = fillField(fullNameSpec, result);
  if (fullNameFilled) {
    fields.splice(fields.indexOf(firstNameSpec), 1);
    fields.splice(fields.indexOf(lastNameSpec), 1);
  }

  for (const field of fields) {
    if (field.name === 'fullName') continue; // already handled
    fillField(field, result);
  }

  return result;
}

function fillField(spec: FieldSpec, result: AutofillResult): boolean {
  if (!spec.value) return false;

  const candidates = collectCandidates(spec);
  for (const el of candidates) {
    if (!isFillable(el)) continue;
    try {
      setInputValue(el, spec.value);
      if (!result.filledFields.includes(spec.name)) {
        result.filledFields.push(spec.name);
      }
      return true;
    } catch (err) {
      result.errors.push(`${spec.name}: ${(err as Error).message}`);
    }
  }
  return false;
}

function collectCandidates(spec: FieldSpec): HTMLInputElement[] {
  const seen = new Set<HTMLInputElement>();
  const found: HTMLInputElement[] = [];

  // 1. Direct selectors
  for (const sel of spec.selectors) {
    document.querySelectorAll<HTMLInputElement>(sel).forEach((el) => {
      if (!seen.has(el)) {
        seen.add(el);
        found.push(el);
      }
    });
  }

  // 2. Match by associated <label> text
  const labels = Array.from(document.querySelectorAll('label'));
  for (const label of labels) {
    const labelText = (label.textContent ?? '').trim();
    if (!spec.labelPatterns.some((p) => p.test(labelText))) continue;

    const targetId = label.getAttribute('for');
    if (targetId) {
      const el = document.getElementById(targetId);
      if (el && el instanceof HTMLInputElement && !seen.has(el)) {
        seen.add(el);
        found.push(el);
      }
    }

    // Input nested inside the label
    const nested = label.querySelector<HTMLInputElement>('input, textarea');
    if (nested && !seen.has(nested as HTMLInputElement)) {
      seen.add(nested as HTMLInputElement);
      found.push(nested as HTMLInputElement);
    }
  }

  // 3. Match by name/id/placeholder attributes
  const allInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input, textarea'),
  );
  for (const el of allInputs) {
    if (seen.has(el)) continue;
    const haystack = `${el.name} ${el.id} ${el.placeholder}`.toLowerCase();
    if (spec.labelPatterns.some((p) => p.test(haystack))) {
      seen.add(el);
      found.push(el);
    }
  }

  return found;
}

function isFillable(el: HTMLInputElement): boolean {
  if (el.disabled || el.readOnly) return false;
  const type = (el.type || '').toLowerCase();
  if (UNFILLABLE_INPUT_TYPES.has(type)) return false;
  // Skip hidden / off-screen elements
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return true;
}

/**
 * Sets an input's value AND dispatches input + change events so React,
 * Vue, Angular and other frameworks register the change.
 */
function setInputValue(el: HTMLInputElement, value: string): void {
  // React tracks input values via a hidden setter. Use the native setter to
  // bypass React's internal value caching.
  const proto = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  const setter = descriptor?.set;

  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function hasFormFields(): boolean {
  return Boolean(
    document.querySelector(
      'input[type="email"], input[type="tel"], input[autocomplete="name"], input[autocomplete="given-name"]',
    ),
  );
}

function countSubmitControls(): number {
  return document.querySelectorAll(
    'button[type="submit"], input[type="submit"]',
  ).length;
}

export function clickApplyButton(): boolean {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('button, a, [role="button"]'),
  );

  const applyPattern = /^(easy apply|apply now|apply|start application)$/i;

  for (const el of candidates) {
    const text = (el.textContent ?? '').trim();
    if (applyPattern.test(text)) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        el.click();
        return true;
      }
    }
  }

  // Fallback: aria-label / data-testid
  const aria = document.querySelector<HTMLElement>(
    '[aria-label*="apply" i], [data-testid*="apply" i]',
  );
  if (aria) {
    aria.click();
    return true;
  }

  return false;
}
