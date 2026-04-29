import * as fs from 'node:fs';
import * as path from 'node:path';
import { simulateApplyFlow } from './automation';
import { loadConfig, initProfile, type AppConfig } from './config';
import { createBrowserSession, type BrowserSession } from './core';
import { extractJobData, type JobData } from './scraper';
import {
  hasBeenApplied,
  loadJobStore,
  recordJob,
  saveJobStore,
  type JobStore,
} from './store';
import {
  logger,
  isBotChallengePage,
  retry,
  serializeError,
  setVerbose,
  waitForBotChallenge,
} from './utils';

const SAMPLE_JOB_URL = 'https://example.com/job-posting';

interface RunResult {
  extensionPopup: {
    state: 'job_detected' | 'blocked';
    extractedJob: {
      title: string | null;
      companyName: string | null;
      descriptionPreview: string | null;
      confidence: JobData['metadata']['confidence'];
    };
    primaryAction: 'Autofill' | null;
    message?: string;
  };
  job: JobData;
  applySimulation: Awaited<ReturnType<typeof simulateApplyFlow>>;
}

function parseArgs(argv: string[]): {
  urls: string[];
  headed: boolean;
  verbose: boolean;
  batchFile: string | null;
  initProfileFlag: boolean;
  skipApplied: boolean;
  challengeTimeoutMs: number | null;
} {
  const args = argv.slice(2);
  const urls: string[] = [];
  let batchFile: string | null = null;
  let challengeTimeoutMs: number | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--batch' && args[i + 1]) {
      batchFile = args[i + 1]!;
      i += 1;
    } else if (arg === '--challenge-timeout-ms' && args[i + 1]) {
      const parsedTimeout = Number(args[i + 1]);
      if (Number.isFinite(parsedTimeout) && parsedTimeout >= 0) {
        challengeTimeoutMs = parsedTimeout;
      }
      i += 1;
    } else if (!arg.startsWith('--')) {
      urls.push(arg);
    }
  }

  return {
    urls,
    headed: args.includes('--headed') || process.env.HEADLESS === 'false',
    verbose:
      args.includes('--verbose') ||
      args.includes('--debug') ||
      process.env.DEBUG === 'true',
    batchFile,
    initProfileFlag: args.includes('--init-profile'),
    skipApplied: !args.includes('--no-skip'),
    challengeTimeoutMs,
  };
}

function loadBatchUrls(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

async function processUrl(
  session: BrowserSession,
  targetUrl: string,
  config: AppConfig,
  challengeTimeoutOverrideMs: number | null,
): Promise<RunResult> {
  await retry(
    async () => {
      await session.page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.settings.navigationTimeoutMs,
      });
    },
    {
      attempts: 3,
      delayMs: 1_000,
      backoffFactor: 1.8,
      onRetry: (error, attempt, nextDelayMs) => {
        logger.warn('Navigation failed, retrying', {
          attempt,
          nextDelayMs,
          error: serializeError(error),
        });
      },
    },
  );

  // Wait for Cloudflare / bot-protection challenges to resolve.
  // In headed mode with system Chrome, these usually auto-resolve.
  // Give extra time in case manual CAPTCHA interaction is needed.
  const challengeTimeoutMs =
    challengeTimeoutOverrideMs ?? (config.settings.headless ? 15_000 : 60_000);
  const challengeResolved = await waitForBotChallenge(
    session.page,
    challengeTimeoutMs,
  );
  if (!challengeResolved && (await isBotChallengePage(session.page))) {
    return createBlockedByBotProtectionResult(targetUrl);
  }

  const job = await extractJobData(session.page);
  const applySimulation = await simulateApplyFlow(session.page, {
    waitForSignIn: !config.settings.headless,
    signInTimeoutMs: config.settings.signInTimeoutMs,
    applicant: config.profile,
  });

  return {
    extensionPopup: {
      state: 'job_detected',
      extractedJob: {
        title: job.title,
        companyName: job.companyName,
        descriptionPreview: getDescriptionPreview(job.description),
        confidence: job.metadata.confidence,
      },
      primaryAction: 'Autofill',
    },
    job,
    applySimulation,
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.initProfileFlag) {
    const profilePath = initProfile();
    logger.info('Profile initialized', { path: profilePath });
    process.stdout.write(`Profile created at: ${profilePath}\n`);
    return;
  }

  if (parsed.verbose) {
    setVerbose(true);
  }

  const config = loadConfig({
    headless: !parsed.headed,
    verbose: parsed.verbose,
  });

  // Build URL list: positional args + batch file + env var fallback
  let urls = [...parsed.urls];
  if (parsed.batchFile) {
    urls.push(...loadBatchUrls(parsed.batchFile));
  }
  if (urls.length === 0) {
    const envUrl = process.env.JOB_URL;
    urls = [envUrl ?? SAMPLE_JOB_URL];
  }

  for (const url of urls) {
    assertHttpUrl(url);
  }

  // Load job store for deduplication
  const jobStore: JobStore = loadJobStore(config.settings.jobStorePath);
  const results: RunResult[] = [];

  // Resolve cookie path from the first URL's hostname
  const cookieDir = config.settings.cookieDir;
  const cookiePath = path.join(cookieDir, 'cookies.json');

  const session = await createBrowserSession({
    headless: config.settings.headless,
    timeoutMs: config.settings.timeoutMs,
    navigationTimeoutMs: config.settings.navigationTimeoutMs,
    cookiePath,
  });

  try {
    for (const targetUrl of urls) {
      if (parsed.skipApplied && hasBeenApplied(jobStore, targetUrl)) {
        logger.info('Skipping previously applied job', { url: targetUrl });
        continue;
      }

      logger.info('Processing job', {
        url: targetUrl,
        index: results.length + 1,
        total: urls.length,
      });

      try {
        const result = await processUrl(
          session,
          targetUrl,
          config,
          parsed.challengeTimeoutMs,
        );
        results.push(result);

        recordJob(jobStore, targetUrl, {
          title: result.job.title,
          companyName: result.job.companyName,
          status: getJobRecordStatus(result),
        });
      } catch (error) {
        logger.error('Failed to process job', {
          url: targetUrl,
          error: serializeError(error),
        });

        recordJob(jobStore, targetUrl, {
          title: null,
          companyName: null,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Output all results
    const output = results.length === 1 ? results[0] : results;
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await session.close();
    saveJobStore(config.settings.jobStorePath, jobStore);
  }
}

function assertHttpUrl(value: string): void {
  const url = new URL(value);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(
      `Only http and https URLs are supported. Received: ${value}`,
    );
  }
}

function getDescriptionPreview(description: string | null): string | null {
  if (!description) {
    return null;
  }

  const trimmed = description.trim();
  return trimmed.length > 280 ? `${trimmed.slice(0, 280).trim()}...` : trimmed;
}

function getJobRecordStatus(
  result: RunResult,
): 'scraped' | 'autofilled' | 'blocked' {
  if (result.applySimulation.status === 'blocked_by_bot_protection') {
    return 'blocked';
  }

  return result.applySimulation.filledFields.length > 0
    ? 'autofilled'
    : 'scraped';
}

function createBlockedByBotProtectionResult(targetUrl: string): RunResult {
  const job: JobData = {
    title: null,
    companyName: null,
    description: null,
    location: null,
    workMode: 'unknown',
    employmentType: 'unknown',
    salary: null,
    datePosted: null,
    applicationDeadline: null,
    sourceUrl: targetUrl,
    scrapedAt: new Date().toISOString(),
    metadata: {
      confidence: 'low',
      extractionNotes: [
        'Bot-protection challenge was still present, so job extraction was skipped.',
      ],
    },
  };

  return {
    extensionPopup: {
      state: 'blocked',
      extractedJob: {
        title: null,
        companyName: null,
        descriptionPreview: null,
        confidence: 'low',
      },
      primaryAction: null,
      message:
        'Bot-protection challenge is still open. Complete it in the browser, then run the command again.',
    },
    job,
    applySimulation: {
      attempted: false,
      status: 'blocked_by_bot_protection',
      applyClicked: false,
      applyControlDetected: false,
      filledFields: [],
      sourcePageUrl: targetUrl,
      submitControlsDetected: 0,
      submitAttempted: false,
      skippedReason:
        'The page was a bot-protection challenge, not a job application page.',
      errors: [],
    },
  };
}

void main().catch((error) => {
  logger.error('Automation failed', {
    error: serializeError(error),
  });

  process.exitCode = 1;
});
