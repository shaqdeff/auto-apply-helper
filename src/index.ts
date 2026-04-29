import { simulateApplyFlow } from './automation';
import { createBrowserSession } from './core';
import { extractJobData, type JobData } from './scraper';
import { logger, retry, serializeError } from './utils';

const SAMPLE_JOB_URL = 'https://example.com/job-posting';

interface RunResult {
  extensionPopup: {
    state: 'job_detected';
    extractedJob: {
      title: string | null;
      companyName: string | null;
      descriptionPreview: string | null;
      confidence: JobData['metadata']['confidence'];
    };
    primaryAction: 'Autofill';
  };
  job: JobData;
  applySimulation: Awaited<ReturnType<typeof simulateApplyFlow>>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetUrl =
    args.find((arg) => !arg.startsWith('--')) ??
    process.env.JOB_URL ??
    SAMPLE_JOB_URL;
  const headed = args.includes('--headed') || process.env.HEADLESS === 'false';

  assertHttpUrl(targetUrl);

  logger.info('Starting job automation', {
    targetUrl,
    headless: !headed,
  });

  const session = await createBrowserSession({
    headless: !headed,
    timeoutMs: 10_000,
    navigationTimeoutMs: 35_000,
  });

  try {
    await retry(
      async () => {
        await session.page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 35_000,
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

    const job = await extractJobData(session.page);
    const applySimulation = await simulateApplyFlow(session.page, {
      waitForSignIn: headed,
      signInTimeoutMs: 120_000,
    });
    const result: RunResult = {
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

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await session.close();
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

void main().catch((error) => {
  logger.error('Automation failed', {
    error: serializeError(error),
  });

  process.exitCode = 1;
});
