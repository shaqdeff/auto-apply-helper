import type { Browser, BrowserContext, Page, ViewportSize } from "playwright";

export interface BrowserConfig {
  headless?: boolean;
  slowMoMs?: number;
  timeoutMs?: number;
  navigationTimeoutMs?: number;
  userAgent?: string;
  locale?: string;
  viewport?: ViewportSize;
  blockResourceTypes?: string[];
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}
