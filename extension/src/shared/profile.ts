import type { UserProfile } from './types';

const STORAGE_KEY = 'autoApply.profile';

const DEFAULT_PROFILE: UserProfile = {
  fullName: '',
  firstName: '',
  lastName: '',
  email: '',
};

export async function getProfile(): Promise<UserProfile> {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  const profile = stored[STORAGE_KEY] as Partial<UserProfile> | undefined;
  return { ...DEFAULT_PROFILE, ...profile };
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: profile });
}

export function isProfileComplete(profile: UserProfile): boolean {
  return Boolean(profile.fullName && profile.email);
}
