import { getProfile, saveProfile } from '../shared/profile';
import type { UserProfile } from '../shared/types';

const FIELDS: (keyof UserProfile)[] = [
  'fullName',
  'firstName',
  'lastName',
  'email',
  'phone',
  'location',
  'profileUrl',
  'linkedInUrl',
  'portfolioUrl',
  'githubUrl',
  'workAuthorization',
  'yearsOfExperience',
  'desiredSalary',
  'startDate',
];

async function loadIntoForm(): Promise<void> {
  const profile = await getProfile();
  for (const key of FIELDS) {
    const el = document.getElementById(key) as HTMLInputElement | null;
    if (el) {
      const value = profile[key];
      if (typeof value === 'string') {
        el.value = value;
      }
    }
  }

  const sponsorEl = document.getElementById(
    'sponsorshipRequired',
  ) as HTMLInputElement | null;
  if (sponsorEl) {
    sponsorEl.checked = Boolean(profile.sponsorshipRequired);
  }
}

async function handleSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);

  const profile: UserProfile = {
    fullName: '',
    firstName: '',
    lastName: '',
    email: '',
  };

  for (const key of FIELDS) {
    const value = data.get(key);
    if (typeof value === 'string' && value.length > 0) {
      (profile as Record<string, unknown>)[key] = value;
    }
  }

  profile.sponsorshipRequired =
    (form.querySelector<HTMLInputElement>('#sponsorshipRequired')?.checked ??
      false) ||
    undefined;

  await saveProfile(profile);

  const saved = document.getElementById('saved');
  saved?.classList.remove('hidden');
  setTimeout(() => saved?.classList.add('hidden'), 2_000);
}

document.getElementById('profile-form')?.addEventListener('submit', (e) => {
  void handleSubmit(e as SubmitEvent);
});

void loadIntoForm();
