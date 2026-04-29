import type { Frame, Locator, Page } from 'playwright';

export interface ErrorSnapshot {
  name: string;
  message: string;
  stack?: string;
}

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  backoffFactor?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, nextDelayMs: number) => void;
}

export interface LocatorCandidate {
  name: string;
  locator: Locator;
}

export interface LocatorActionResult {
  success: boolean;
  candidateName?: string;
  reason?: string;
  error?: ErrorSnapshot;
}

export interface ReadTextOptions {
  timeoutMs?: number;
  visibleOnly?: boolean;
}

export interface CollectTextOptions extends ReadTextOptions {
  maxItems?: number;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogMeta = Record<string, unknown>;

export const logger = {
  debug: (message: string, meta?: LogMeta) => writeLog('debug', message, meta),
  info: (message: string, meta?: LogMeta) => writeLog('info', message, meta),
  warn: (message: string, meta?: LogMeta) => writeLog('warn', message, meta),
  error: (message: string, meta?: LogMeta) => writeLog('error', message, meta),
};

export function serializeError(error: unknown): ErrorSnapshot {
  if (error instanceof Error) {
    const snapshot: ErrorSnapshot = {
      name: error.name,
      message: error.message,
    };

    if (error.stack) {
      snapshot.stack = error.stack;
    }

    return snapshot;
  }

  return {
    name: 'UnknownError',
    message: String(error),
  };
}

export function compactText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

export function truncateText(
  value: string | null,
  maxLength: number,
): string | null {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}...`;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 500;
  const backoffFactor = options.backoffFactor ?? 1.5;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const hasAttemptsRemaining = attempt < attempts;
      const canRetry = options.shouldRetry?.(error, attempt) ?? true;

      if (!hasAttemptsRemaining || !canRetry) {
        throw error;
      }

      const nextDelayMs = Math.round(delayMs * backoffFactor ** (attempt - 1));
      options.onRetry?.(error, attempt, nextDelayMs);
      await sleep(nextDelayMs);
    }
  }

  throw lastError;
}

export async function waitForPageReady(
  page: Page | Frame,
  timeoutMs = 10_000,
): Promise<void> {
  // Frame doesn't have waitForLoadState — only Page does
  if (
    'waitForLoadState' in page &&
    typeof page.waitForLoadState === 'function'
  ) {
    await (page as Page)
      .waitForLoadState('domcontentloaded', { timeout: timeoutMs })
      .catch((error: unknown) => {
        logger.debug('Timed out waiting for DOMContentLoaded', {
          error: serializeError(error),
        });
      });

    // Some job boards keep analytics/network connections open forever.
    // Treat networkidle as a best-effort signal, not a hard requirement.
    await (page as Page)
      .waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 5_000) })
      .catch((error: unknown) => {
        logger.debug('Timed out waiting for network idle', {
          error: serializeError(error),
        });
      });
  }
}

const BOT_CHALLENGE_SIGNALS = [
  'checking if the site connection is secure',
  'verify you are human',
  'just a moment',
  'attention required',
  'please wait while we verify',
  'ddos protection by',
  'enable javascript and cookies',
  'cf-challenge',
  'please complete the security check',
];

/**
 * Detects Cloudflare / bot-protection challenge pages and waits for the user
 * or browser session to resolve them. Returns `true` if a challenge was
 * detected and resolved, `false` if none was detected or it timed out.
 */
export async function waitForBotChallenge(
  page: Page | Frame,
  maxWaitMs = 30_000,
): Promise<boolean> {
  if (!(await isBotChallengePage(page))) {
    return false;
  }

  logger.info(
    'Bot-protection challenge detected — complete it in the browser if prompted.',
    { maxWaitMs },
  );

  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await sleep(2_000);

    if (!(await isBotChallengePage(page))) {
      logger.info('Bot-protection challenge resolved');
      await sleep(1_500);
      await waitForPageReady(page, 10_000);
      return true;
    }
  }

  logger.warn('Bot-protection challenge did not resolve in time', {
    maxWaitMs,
  });
  return false;
}

export async function isBotChallengePage(page: Page | Frame): Promise<boolean> {
  // Check the page title
  const title = await ('title' in page && typeof page.title === 'function'
    ? (page as Page).title().catch(() => '')
    : Promise.resolve(''));
  const lowerTitle = title.toLowerCase();

  if (BOT_CHALLENGE_SIGNALS.some((signal) => lowerTitle.includes(signal))) {
    return true;
  }

  // Check visible body text (first 2000 chars to keep it fast)
  const bodySnippet = await page
    .locator('body')
    .innerText({ timeout: 2_000 })
    .then((text) => text.slice(0, 2_000).toLowerCase())
    .catch(() => '');

  if (BOT_CHALLENGE_SIGNALS.some((signal) => bodySnippet.includes(signal))) {
    return true;
  }

  // Check for Cloudflare-specific elements
  const hasCfChallenge = await page
    .locator(
      '#cf-challenge-running, #challenge-running, .cf-browser-verification, iframe[src*="challenges.cloudflare.com"]',
    )
    .first()
    .isVisible({ timeout: 1_000 })
    .catch(() => false);

  return hasCfChallenge;
}

/**
 * Waits until the page URL stops changing. Useful for SPAs that auto-navigate
 * through wizard steps after sign-in or other actions.
 */
export async function waitForUrlStable(
  page: Page | Frame,
  stabilityMs = 2_000,
  maxWaitMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  let lastUrl = page.url();
  let stableSince = Date.now();

  while (Date.now() < deadline) {
    await sleep(500);

    const currentUrl = page.url();
    if (currentUrl !== lastUrl) {
      logger.debug('URL changed during stability wait', {
        from: lastUrl,
        to: currentUrl,
      });
      lastUrl = currentUrl;
      stableSince = Date.now();
    }

    if (Date.now() - stableSince >= stabilityMs) {
      return lastUrl;
    }
  }

  return lastUrl;
}

export async function readLocatorText(
  locator: Locator,
  options: ReadTextOptions = {},
): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? 1_500;
  const visibleOnly = options.visibleOnly ?? true;
  const target = locator.first();

  const count = await locator.count().catch(() => 0);
  if (count === 0) {
    return null;
  }

  const state = visibleOnly ? 'visible' : 'attached';
  await target.waitFor({ state, timeout: timeoutMs }).catch(() => null);

  if (visibleOnly) {
    const isVisible = await target.isVisible().catch(() => false);
    if (!isVisible) {
      return null;
    }
  }

  const text = await target
    .textContent({ timeout: timeoutMs })
    .catch(() => null);
  return compactText(text);
}

export async function collectLocatorTexts(
  locator: Locator,
  options: CollectTextOptions = {},
): Promise<string[]> {
  const maxItems = options.maxItems ?? 5;
  const count = Math.min(await locator.count().catch(() => 0), maxItems);
  const texts: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const text = await readLocatorText(locator.nth(index), options);

    if (text) {
      texts.push(text);
    }
  }

  return texts;
}

export async function getMetaContent(
  page: Page,
  selectors: string[],
): Promise<string | null> {
  for (const selector of selectors) {
    const content = await page
      .locator(selector)
      .first()
      .getAttribute('content', { timeout: 1_000 })
      .catch(() => null);

    const normalized = compactText(content);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export async function clickFirstAvailable(
  candidates: LocatorCandidate[],
  timeoutMs = 2_500,
): Promise<LocatorActionResult> {
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const target = candidate.locator.first();
      await target.waitFor({ state: 'visible', timeout: timeoutMs });

      const isEnabled = await target.isEnabled().catch(() => false);
      if (!isEnabled) {
        continue;
      }

      await target.click({ timeout: timeoutMs });
      return {
        success: true,
        candidateName: candidate.name,
      };
    } catch (error) {
      lastError = error;
      logger.debug('Locator click candidate failed', {
        candidate: candidate.name,
        error: serializeError(error),
      });
    }
  }

  const result: LocatorActionResult = {
    success: false,
    reason: 'No visible, enabled locator matched.',
  };

  if (lastError) {
    result.error = serializeError(lastError);
  }

  return result;
}

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

export async function fillFirstAvailable(
  candidates: LocatorCandidate[],
  value: string,
  timeoutMs = 2_500,
): Promise<LocatorActionResult> {
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const target = candidate.locator.first();
      await target.waitFor({ state: 'visible', timeout: timeoutMs });

      // Skip inputs that can't be filled (radio, checkbox, file, etc.)
      const inputType = await target
        .getAttribute('type', { timeout: 1_000 })
        .catch(() => null);
      if (inputType && UNFILLABLE_INPUT_TYPES.has(inputType.toLowerCase())) {
        logger.debug('Skipping unfillable input type', {
          candidate: candidate.name,
          type: inputType,
        });
        continue;
      }

      const isEditable = await target.isEditable().catch(() => false);
      if (!isEditable) {
        continue;
      }

      await target.fill(value, { timeout: timeoutMs });
      return {
        success: true,
        candidateName: candidate.name,
      };
    } catch (error) {
      lastError = error;
      logger.debug('Locator fill candidate failed', {
        candidate: candidate.name,
        error: serializeError(error),
      });
    }
  }

  const result: LocatorActionResult = {
    success: false,
    reason: 'No visible, editable locator matched.',
  };

  if (lastError) {
    result.error = serializeError(lastError);
  }

  return result;
}

let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export async function selectFirstAvailable(
  candidates: LocatorCandidate[],
  value: string,
  timeoutMs = 2_500,
): Promise<LocatorActionResult> {
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const target = candidate.locator.first();
      await target.waitFor({ state: 'visible', timeout: timeoutMs });

      // Try selecting by value first, then by label text
      const optionCount = await target
        .locator('option')
        .count()
        .catch(() => 0);
      if (optionCount === 0) {
        continue;
      }

      try {
        await target.selectOption({ value }, { timeout: timeoutMs });
      } catch {
        await target.selectOption({ label: value }, { timeout: timeoutMs });
      }

      return {
        success: true,
        candidateName: candidate.name,
      };
    } catch (error) {
      lastError = error;
      logger.debug('Locator select candidate failed', {
        candidate: candidate.name,
        error: serializeError(error),
      });
    }
  }

  const result: LocatorActionResult = {
    success: false,
    reason: 'No visible select element matched.',
  };

  if (lastError) {
    result.error = serializeError(lastError);
  }

  return result;
}

export async function checkFirstAvailable(
  candidates: LocatorCandidate[],
  shouldCheck: boolean,
  timeoutMs = 2_500,
): Promise<LocatorActionResult> {
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const target = candidate.locator.first();
      await target.waitFor({ state: 'visible', timeout: timeoutMs });

      const isChecked = await target.isChecked().catch(() => false);
      if (isChecked !== shouldCheck) {
        await target.setChecked(shouldCheck, { timeout: timeoutMs });
      }

      return {
        success: true,
        candidateName: candidate.name,
      };
    } catch (error) {
      lastError = error;
      logger.debug('Locator check candidate failed', {
        candidate: candidate.name,
        error: serializeError(error),
      });
    }
  }

  const result: LocatorActionResult = {
    success: false,
    reason: 'No visible checkbox matched.',
  };

  if (lastError) {
    result.error = serializeError(lastError);
  }

  return result;
}

export async function uploadFile(
  page: Page,
  candidates: LocatorCandidate[],
  filePath: string,
  timeoutMs = 5_000,
): Promise<LocatorActionResult> {
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const target = candidate.locator.first();
      await target.waitFor({ state: 'attached', timeout: timeoutMs });
      await target.setInputFiles(filePath, { timeout: timeoutMs });

      return {
        success: true,
        candidateName: candidate.name,
      };
    } catch (error) {
      lastError = error;
      logger.debug('Locator file upload candidate failed', {
        candidate: candidate.name,
        error: serializeError(error),
      });
    }
  }

  const result: LocatorActionResult = {
    success: false,
    reason: 'No file input matched.',
  };

  if (lastError) {
    result.error = serializeError(lastError);
  }

  return result;
}

export function getFrames(page: Page): Frame[] {
  return page.frames();
}

function writeLog(level: LogLevel, message: string, meta?: LogMeta): void {
  if (level === 'debug' && !verboseEnabled && process.env.DEBUG !== 'true') {
    return;
  }

  const payload = {
    level,
    timestamp: new Date().toISOString(),
    message,
    meta,
  };

  process.stderr.write(`${JSON.stringify(payload)}\n`);
}
