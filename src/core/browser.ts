import { chromium } from "playwright";
import { logger, serializeError } from "../utils";
import type { BrowserConfig, BrowserSession } from "./types";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

const DEFAULT_VIEWPORT = {
  width: 1440,
  height: 1000
};

export async function createBrowserSession(config: BrowserConfig = {}): Promise<BrowserSession> {
  const browser = await chromium.launch({
    headless: config.headless ?? true,
    slowMo: config.slowMoMs ?? 0
  });

  const context = await browser.newContext({
    locale: config.locale ?? "en-US",
    userAgent: config.userAgent ?? DEFAULT_USER_AGENT,
    viewport: config.viewport ?? DEFAULT_VIEWPORT
  });

  const timeoutMs = config.timeoutMs ?? 10_000;
  const navigationTimeoutMs = config.navigationTimeoutMs ?? 30_000;

  context.setDefaultTimeout(timeoutMs);
  context.setDefaultNavigationTimeout(navigationTimeoutMs);

  if (config.blockResourceTypes?.length) {
    const blockedTypes = new Set(config.blockResourceTypes);

    await context.route("**/*", async (route) => {
      if (blockedTypes.has(route.request().resourceType())) {
        await route.abort();
        return;
      }

      await route.continue();
    });
  }

  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(navigationTimeoutMs);

  // Job boards often show alert dialogs for redirects or expired postings.
  // Dismissing them keeps the automation from hanging indefinitely.
  page.on("dialog", (dialog) => {
    dialog.dismiss().catch((error: unknown) => {
      logger.warn("Failed to dismiss browser dialog", { error: serializeError(error) });
    });
  });

  page.on("pageerror", (error) => {
    logger.warn("Page emitted an error", { error: serializeError(error) });
  });

  return {
    browser,
    context,
    page,
    close: async () => {
      try {
        await context.close();
      } catch (error) {
        logger.warn("Failed to close browser context cleanly", { error: serializeError(error) });
      } finally {
        await browser.close();
      }
    }
  };
}
