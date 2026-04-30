# Auto Apply Helper — Chrome Extension

A Manifest V3 Chrome extension that extracts job posting data and autofills application forms on supported job boards.

## Supported sites

- Work at a Startup (workatastartup.com)
- Greenhouse (greenhouse.io, job-boards.greenhouse.io)
- Lever (lever.co)
- Wellfound / AngelList (wellfound.com)
- LinkedIn Jobs (linkedin.com/jobs)
- Ashby (ashbyhq.com)

Add more sites by editing `host_permissions` and `content_scripts.matches` in `manifest.json`.

## Install

```bash
cd extension
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. The first time you install, the options page will open — fill in your profile and save.

## Usage

1. Navigate to a job posting on a supported site.
2. Click the extension icon in the toolbar.
3. The popup shows the extracted job (title, company, location, preview).
4. Click **Autofill** to fill the application form with your saved profile.
5. Click **Click Apply** if the page only shows an "Apply" button (no form yet).
6. Review the form and submit manually — the extension never submits for you.

## Develop

```bash
npm run watch       # rebuild on save
npm run typecheck   # check types without building
```

After making changes, click the reload icon next to the extension in `chrome://extensions/`.

## Architecture

```
extension/
  manifest.json              MV3 manifest
  src/
    background/index.ts      Service worker (opens options on install)
    content/
      index.ts               Listens for messages from popup
      scraper.ts             Extracts JSON-LD + visible page data
      filler.ts              Fills inputs, dispatches React-compatible events
    popup/
      popup.html             Popup UI shell
      popup.css              Popup styles
      popup.ts               Reads job, sends fill commands
    options/
      options.html           Profile editor
      options.css            Options styles
      options.ts             Reads/writes chrome.storage.sync
    shared/
      profile.ts             Storage layer for the user profile
      types.ts               Shared TypeScript interfaces
  dist/
    content.js               Bundled content script (manifest reference)
    background.js            Bundled service worker (manifest reference)
  icons/                     16/48/128 px placeholder PNGs
```

## How it differs from the CLI

The CLI version (top-level `src/`) uses Playwright to drive a real browser. The extension runs _inside_ the user's browser, so it uses native DOM APIs:

| CLI (Playwright)              | Extension (DOM)                                   |
| ----------------------------- | ------------------------------------------------- |
| `page.locator().fill()`       | Native setter + `input`/`change` events           |
| `page.getByLabel()`           | `document.querySelector('label')` matched by text |
| `chromium.launch()`           | Already in the user's browser                     |
| Hardcoded profile in code     | `chrome.storage.sync`                             |
| JSON to stdout                | Popup UI                                          |
| `--headed` flag               | Always headed                                     |
| Cloudflare bypass workarounds | Not needed — user is already authed               |

## Safety

- The extension **never submits** application forms.
- All profile data lives in `chrome.storage.sync` (synced across the user's signed-in Chrome profiles only).
- No network requests — everything runs locally on the page.
