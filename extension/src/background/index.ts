// The background service worker is intentionally minimal — most logic
// runs in the popup or the content script. We only listen for install events
// to open the options page on first install.

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

export {};
