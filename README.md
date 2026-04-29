# auto-apply-helper

Production-style TypeScript project that uses Playwright to extract job posting data and simulate the safe beginning of an application flow.

The tool:

- Opens a job posting page.
- Simulates an extension popup that shows extracted title, company name, description preview, and confidence.
- Prints structured JSON to stdout.
- Clicks or detects an Apply button/link when present.
- Detects sign-in redirects and reports: `Please sign in, then reopen extension.`
- Fills dummy name, email, phone, location, and profile URL fields when available.
- Does not submit applications.

## Demo Flow

1. User visits a job page.
2. User opens the extension popup.
3. Popup shows extracted job title, company, description preview, and confidence.
4. User clicks `Autofill`.
5. The helper clicks or detects `Apply`.
6. If the site redirects to sign-in, the result shows `Please sign in, then reopen extension.`
7. On an application page, the helper fills supported profile fields.
8. The helper never submits the application.

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

When a site shows bot protection, use a visible browser and complete the check manually:

```bash
npm run dev -- --headed --verbose --challenge-timeout-ms 120000 https://example.com/job-posting
```

To fail fast instead of waiting on a challenge page:

```bash
npm run dev -- --headed --challenge-timeout-ms 0 https://example.com/job-posting
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
- Application automation records detected submit controls but never clicks them, which keeps the project useful for demos without submitting anything.
