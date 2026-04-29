# auto-apply-helper

Production-style TypeScript project that uses Playwright to extract job posting data and simulate the safe beginning of an application flow.

The tool:

- Opens a job posting page.
- Extracts title, company name, and description.
- Prints structured JSON to stdout.
- Clicks an Apply button or link when present.
- Fills dummy name and email fields.
- Does not submit applications.

## Project Structure

```text
auto-apply-helper/
  package.json
  tsconfig.json
  src/
    index.ts
    core/
      browser.ts
      index.ts
      types.ts
    scraper/
      extractJob.ts
      index.ts
      types.ts
    automation/
      applyFlow.ts
      index.ts
      types.ts
    utils/
      helpers.ts
      index.ts
```

## Setup

```bash
npm install
npx playwright install chromium
```

## Run

Use any public job posting URL:

```bash
npm run dev -- https://example.com/job-posting
```

Run with a visible browser:

```bash
npm run dev -- --headed https://example.com/job-posting
```

You can also use an environment variable:

```bash
JOB_URL=https://example.com/job-posting npm run dev
```

## Validate

```bash
npm run typecheck
npm run build
```

## Notes For Interviews

- The scraper prioritizes JSON-LD `JobPosting` structured data when available, then falls back to visible page locators.
- Locators use accessible roles, labels, attributes, and text fallbacks instead of brittle single-site selectors.
- Navigation and browser setup include retries, timeouts, dialog handling, and graceful cleanup.
- Application automation stops after filling dummy fields, which keeps the project useful for demos without actually submitting anything.
