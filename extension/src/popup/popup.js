"use strict";
(() => {
  // src/shared/profile.ts
  var STORAGE_KEY = "autoApply.profile";
  var DEFAULT_PROFILE = {
    fullName: "",
    firstName: "",
    lastName: "",
    email: ""
  };
  async function getProfile() {
    const stored = await chrome.storage.sync.get(STORAGE_KEY);
    const profile = stored[STORAGE_KEY];
    return { ...DEFAULT_PROFILE, ...profile };
  }
  function isProfileComplete(profile) {
    return Boolean(profile.fullName && profile.email);
  }

  // src/popup/popup.ts
  var $ = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element ${id} not found`);
    return el;
  };
  async function getActiveTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    return tab.id;
  }
  function sendMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  }
  function setStatus(text, kind = "loading") {
    const status = $("status");
    status.classList.remove("hidden");
    status.classList.toggle("status--error", kind === "error");
    status.querySelector(".status__text").textContent = text;
  }
  function hideStatus() {
    $("status").classList.add("hidden");
  }
  function renderJob(job) {
    $("job-title").textContent = job.title ?? "Unknown title";
    $("job-company").textContent = job.companyName ?? "\u2014";
    $("job-location").textContent = job.location ?? "";
    $("job-confidence").textContent = job.confidence;
    const preview = job.description ? job.description.slice(0, 280) + (job.description.length > 280 ? "\u2026" : "") : "";
    $("job-preview").textContent = preview;
    $("job").classList.remove("hidden");
  }
  function renderResult(filledFields, errors) {
    const summary = $("result-summary");
    const list = $("result-fields");
    if (filledFields.length === 0) {
      summary.textContent = errors.length > 0 ? `No fields filled. ${errors.length} errors.` : "No matching form fields found on this page.";
    } else {
      summary.textContent = `Filled ${filledFields.length} field${filledFields.length === 1 ? "" : "s"}.`;
    }
    list.innerHTML = "";
    for (const field of filledFields) {
      const li = document.createElement("li");
      li.textContent = field;
      list.appendChild(li);
    }
    $("result").classList.remove("hidden");
  }
  async function init() {
    $("open-options").addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
    $("open-options-warning").addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
    const profile = await getProfile();
    let tabId;
    try {
      tabId = await getActiveTabId();
    } catch {
      setStatus("Cannot read active tab.", "error");
      return;
    }
    let job = null;
    try {
      const response = await sendMessage(tabId, {
        type: "EXTRACT_JOB"
      });
      job = response.job;
    } catch (err) {
      setStatus(
        `This site is not supported, or the page hasn't loaded. (${err.message})`,
        "error"
      );
      return;
    }
    hideStatus();
    renderJob(job);
    $("actions").classList.remove("hidden");
    if (!isProfileComplete(profile)) {
      $("profile-warning").classList.remove("hidden");
      $("autofill").disabled = true;
    }
    $("autofill").addEventListener("click", async () => {
      const btn = $("autofill");
      btn.disabled = true;
      btn.textContent = "Filling\u2026";
      try {
        const response = await sendMessage(tabId, {
          type: "AUTOFILL",
          profile
        });
        renderResult(response.result.filledFields, response.result.errors);
      } catch (err) {
        setStatus(`Autofill failed: ${err.message}`, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Autofill";
      }
    });
    $("click-apply").addEventListener("click", async () => {
      try {
        const response = await sendMessage(tabId, {
          type: "CLICK_APPLY"
        });
        if (!response.clicked) {
          setStatus("No Apply button found on this page.", "error");
        }
      } catch (err) {
        setStatus(`Could not click Apply: ${err.message}`, "error");
      }
    });
  }
  void init();
})();
//# sourceMappingURL=popup.js.map
