import type { Locator, Page } from "playwright";

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

type LogLevel = "debug" | "info" | "warn" | "error";
type LogMeta = Record<string, unknown>;

export const logger = {
  debug: (message: string, meta?: LogMeta) => {
    if (process.env.DEBUG === "true") {
      writeLog("debug", message, meta);
    }
  },
  info: (message: string, meta?: LogMeta) => writeLog("info", message, meta),
  warn: (message: string, meta?: LogMeta) => writeLog("warn", message, meta),
  error: (message: string, meta?: LogMeta) => writeLog("error", message, meta)
};

export function serializeError(error: unknown): ErrorSnapshot {
  if (error instanceof Error) {
    const snapshot: ErrorSnapshot = {
      name: error.name,
      message: error.message
    };

    if (error.stack) {
      snapshot.stack = error.stack;
    }

    return snapshot;
  }

  return {
    name: "UnknownError",
    message: String(error)
  };
}

export function compactText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function truncateText(value: string | null, maxLength: number): string | null {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}...`;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
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

export async function waitForPageReady(page: Page, timeoutMs = 10_000): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch((error: unknown) => {
    logger.debug("Timed out waiting for DOMContentLoaded", { error: serializeError(error) });
  });

  // Some job boards keep analytics/network connections open forever.
  // Treat networkidle as a best-effort signal, not a hard requirement.
  await page
    .waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 5_000) })
    .catch((error: unknown) => {
      logger.debug("Timed out waiting for network idle", { error: serializeError(error) });
    });
}

export async function readLocatorText(
  locator: Locator,
  options: ReadTextOptions = {}
): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? 1_500;
  const visibleOnly = options.visibleOnly ?? true;
  const target = locator.first();

  const count = await locator.count().catch(() => 0);
  if (count === 0) {
    return null;
  }

  const state = visibleOnly ? "visible" : "attached";
  await target.waitFor({ state, timeout: timeoutMs }).catch(() => null);

  if (visibleOnly) {
    const isVisible = await target.isVisible().catch(() => false);
    if (!isVisible) {
      return null;
    }
  }

  const text = await target.textContent({ timeout: timeoutMs }).catch(() => null);
  return compactText(text);
}

export async function collectLocatorTexts(
  locator: Locator,
  options: CollectTextOptions = {}
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

export async function getMetaContent(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const content = await page
      .locator(selector)
      .first()
      .getAttribute("content", { timeout: 1_000 })
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
  timeoutMs = 2_500
): Promise<LocatorActionResult> {
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const target = candidate.locator.first();
      await target.waitFor({ state: "visible", timeout: timeoutMs });

      const isEnabled = await target.isEnabled().catch(() => false);
      if (!isEnabled) {
        continue;
      }

      await target.click({ timeout: timeoutMs });
      return {
        success: true,
        candidateName: candidate.name
      };
    } catch (error) {
      lastError = error;
      logger.debug("Locator click candidate failed", {
        candidate: candidate.name,
        error: serializeError(error)
      });
    }
  }

  const result: LocatorActionResult = {
    success: false,
    reason: "No visible, enabled locator matched."
  };

  if (lastError) {
    result.error = serializeError(lastError);
  }

  return result;
}

export async function fillFirstAvailable(
  candidates: LocatorCandidate[],
  value: string,
  timeoutMs = 2_500
): Promise<LocatorActionResult> {
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const target = candidate.locator.first();
      await target.waitFor({ state: "visible", timeout: timeoutMs });

      const isEditable = await target.isEditable().catch(() => false);
      if (!isEditable) {
        continue;
      }

      await target.fill(value, { timeout: timeoutMs });
      return {
        success: true,
        candidateName: candidate.name
      };
    } catch (error) {
      lastError = error;
      logger.debug("Locator fill candidate failed", {
        candidate: candidate.name,
        error: serializeError(error)
      });
    }
  }

  const result: LocatorActionResult = {
    success: false,
    reason: "No visible, editable locator matched."
  };

  if (lastError) {
    result.error = serializeError(lastError);
  }

  return result;
}

function writeLog(level: LogLevel, message: string, meta?: LogMeta): void {
  const payload = {
    level,
    timestamp: new Date().toISOString(),
    message,
    meta
  };

  process.stderr.write(`${JSON.stringify(payload)}\n`);
}
