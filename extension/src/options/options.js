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
  async function saveProfile(profile) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: profile });
  }

  // src/options/options.ts
  var FIELDS = [
    "fullName",
    "firstName",
    "lastName",
    "email",
    "phone",
    "location",
    "profileUrl",
    "linkedInUrl",
    "portfolioUrl",
    "githubUrl",
    "workAuthorization",
    "yearsOfExperience",
    "desiredSalary",
    "startDate"
  ];
  async function loadIntoForm() {
    const profile = await getProfile();
    for (const key of FIELDS) {
      const el = document.getElementById(key);
      if (el) {
        const value = profile[key];
        if (typeof value === "string") {
          el.value = value;
        }
      }
    }
    const sponsorEl = document.getElementById(
      "sponsorshipRequired"
    );
    if (sponsorEl) {
      sponsorEl.checked = Boolean(profile.sponsorshipRequired);
    }
  }
  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const profile = {
      fullName: "",
      firstName: "",
      lastName: "",
      email: ""
    };
    for (const key of FIELDS) {
      const value = data.get(key);
      if (typeof value === "string" && value.length > 0) {
        profile[key] = value;
      }
    }
    profile.sponsorshipRequired = (form.querySelector("#sponsorshipRequired")?.checked ?? false) || void 0;
    await saveProfile(profile);
    const saved = document.getElementById("saved");
    saved?.classList.remove("hidden");
    setTimeout(() => saved?.classList.add("hidden"), 2e3);
  }
  document.getElementById("profile-form")?.addEventListener("submit", (e) => {
    void handleSubmit(e);
  });
  void loadIntoForm();
})();
//# sourceMappingURL=options.js.map
