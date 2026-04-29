import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { chromium, type Cookie } from 'playwright';
import { logger, serializeError } from '../utils';
import type { BrowserConfig, BrowserSession } from './types';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const DEFAULT_VIEWPORT = {
  width: 1440,
  height: 1000,
};

const DEFAULT_USER_DATA_DIR = path.join(
  os.homedir(),
  '.auto-apply',
  'browser-profile',
);

export async function createBrowserSession(
  config: BrowserConfig = {},
): Promise<BrowserSession> {
  const headless = config.headless ?? true;
  const useSystemBrowser = config.useSystemBrowser ?? !headless;

  if (useSystemBrowser) {
    return createPersistentSession(config, headless);
  }

  return createStandardSession(config, headless);
}

/**
 * Uses `launchPersistentContext` with the system Chrome channel.
 * This produces a real browser profile that persists logins, cookies, and
 * local-storage across runs and avoids most bot-detection fingerprints
 * (no navigator.webdriver flag, no automation-controlled banner).
 */
async function createPersistentSession(
  config: BrowserConfig,
  headless: boolean,
): Promise<BrowserSession> {
  const userDataDir = config.userDataDir ?? DEFAULT_USER_DATA_DIR;
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless,
    chromiumSandbox: !headless,
    slowMo: config.slowMoMs ?? 0,
    locale: config.locale ?? 'en-US',
    viewport: config.viewport ?? DEFAULT_VIEWPORT,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    ignoreDefaultArgs: headless
      ? ['--enable-automation']
      : ['--enable-automation', '--no-sandbox'],
  });

  const timeoutMs = config.timeoutMs ?? 10_000;
  const navigationTimeoutMs = config.navigationTimeoutMs ?? 30_000;

  context.setDefaultTimeout(timeoutMs);
  context.setDefaultNavigationTimeout(navigationTimeoutMs);

  if (config.blockResourceTypes?.length) {
    const blockedTypes = new Set(config.blockResourceTypes);
    await context.route('**/*', async (route) => {
      if (blockedTypes.has(route.request().resourceType())) {
        await route.abort();
        return;
      }
      await route.continue();
    });
  }

  // Persistent contexts start with one page already open
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(navigationTimeoutMs);

  setupPageHandlers(page);

  logger.info('Launched persistent browser session (system Chrome)', {
    userDataDir,
    headless,
  });

  return {
    browser: null as never, // persistent contexts don't expose a separate Browser
    context,
    page,
    close: async () => {
      try {
        if (config.cookiePath) {
          await saveCookies(context, config.cookiePath);
        }
        await context.close();
      } catch (error) {
        logger.warn('Failed to close browser context cleanly', {
          error: serializeError(error),
        });
      }
    },
  };
}

async function createStandardSession(
  config: BrowserConfig,
  headless: boolean,
): Promise<BrowserSession> {
  const browser = await chromium.launch({
    headless,
    slowMo: config.slowMoMs ?? 0,
  });

  const context = await browser.newContext({
    locale: config.locale ?? 'en-US',
    userAgent: config.userAgent ?? DEFAULT_USER_AGENT,
    viewport: config.viewport ?? DEFAULT_VIEWPORT,
  });

  const timeoutMs = config.timeoutMs ?? 10_000;
  const navigationTimeoutMs = config.navigationTimeoutMs ?? 30_000;

  context.setDefaultTimeout(timeoutMs);
  context.setDefaultNavigationTimeout(navigationTimeoutMs);

  // Restore cookies from a previous session
  if (config.cookiePath) {
    const cookies = loadCookies(config.cookiePath);
    if (cookies.length > 0) {
      await context.addCookies(cookies);
      logger.info('Restored saved cookies', { count: cookies.length });
    }
  }

  if (config.blockResourceTypes?.length) {
    const blockedTypes = new Set(config.blockResourceTypes);

    await context.route('**/*', async (route) => {
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

  setupPageHandlers(page);

  return {
    browser,
    context,
    page,
    close: async () => {
      try {
        // Persist cookies before closing
        if (config.cookiePath) {
          await saveCookies(context, config.cookiePath);
        }

        await context.close();
      } catch (error) {
        logger.warn('Failed to close browser context cleanly', {
          error: serializeError(error),
        });
      } finally {
        await browser.close();
      }
    },
  };
}

function setupPageHandlers(page: import('playwright').Page): void {
  page.on('dialog', (dialog) => {
    dialog.dismiss().catch((error: unknown) => {
      logger.warn('Failed to dismiss browser dialog', {
        error: serializeError(error),
      });
    });
  });

  page.on('pageerror', (error) => {
    logger.warn('Page emitted an error', { error: serializeError(error) });
  });
}

function loadCookies(filePath: string): Cookie[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Cookie[];
  } catch {
    return [];
  }
}

async function saveCookies(
  context: import('playwright').BrowserContext,
  filePath: string,
): Promise<void> {
  try {
    const cookies = await context.cookies();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify(cookies, null, 2) + '\n',
      'utf-8',
    );
    logger.info('Saved cookies', { count: cookies.length, path: filePath });
  } catch (error) {
    logger.warn('Failed to save cookies', { error: serializeError(error) });
  }
}
