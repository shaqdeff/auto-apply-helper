import type { Browser, BrowserContext, Page, ViewportSize } from 'playwright';

export interface BrowserConfig {
  headless?: boolean;
  slowMoMs?: number;
  timeoutMs?: number;
  navigationTimeoutMs?: number;
  userAgent?: string;
  locale?: string;
  viewport?: ViewportSize;
  blockResourceTypes?: string[];
  /** Path to a JSON file for persisting cookies across sessions. */
  cookiePath?: string;
  /**
   * When true, launch the system Chrome/Chromium via `channel: 'chrome'` and
   * use a persistent user-data directory to reduce bot-detection fingerprints.
   * Defaults to true when headless is false.
   */
  useSystemBrowser?: boolean;
  /** Directory for the persistent browser profile. Defaults to ~/.auto-apply/browser-profile. */
  userDataDir?: string;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}
