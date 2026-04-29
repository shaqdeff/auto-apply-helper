import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger } from '../utils';
import type { AppConfig, AppSettings, UserProfile } from './types';

const CONFIG_DIR = path.join(os.homedir(), '.auto-apply');
const PROFILE_PATH = path.join(CONFIG_DIR, 'profile.json');
const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.json');

const DEFAULT_PROFILE: UserProfile = {
  fullName: 'Alex Applicant',
  firstName: 'Alex',
  lastName: 'Applicant',
  email: 'alex.applicant@example.com',
  phone: '555-0100',
  location: 'San Francisco, CA',
  profileUrl: 'https://example.com/alex-applicant',
  linkedInUrl: 'https://www.linkedin.com/in/alex-applicant',
  portfolioUrl: 'https://example.com/portfolio',
};

const DEFAULT_SETTINGS: AppSettings = {
  headless: true,
  verbose: false,
  timeoutMs: 10_000,
  navigationTimeoutMs: 35_000,
  signInTimeoutMs: 120_000,
  cookieDir: path.join(CONFIG_DIR, 'cookies'),
  jobStorePath: path.join(CONFIG_DIR, 'jobs.json'),
  batchConcurrency: 1,
};

export function loadConfig(overrides?: Partial<AppSettings>): AppConfig {
  const profile = loadJsonFile<Partial<UserProfile>>(PROFILE_PATH);
  const settings = loadJsonFile<Partial<AppSettings>>(SETTINGS_PATH);

  const mergedProfile: UserProfile = { ...DEFAULT_PROFILE, ...profile };
  const mergedSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    ...overrides,
  };

  if (profile) {
    logger.info('Loaded user profile', { path: PROFILE_PATH });
  } else {
    logger.warn('No user profile found — using defaults', {
      expected: PROFILE_PATH,
      hint: 'Run with --init-profile to create one.',
    });
  }

  return { profile: mergedProfile, settings: mergedSettings };
}

export function initProfile(): string {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  if (fs.existsSync(PROFILE_PATH)) {
    return PROFILE_PATH;
  }

  fs.writeFileSync(
    PROFILE_PATH,
    JSON.stringify(DEFAULT_PROFILE, null, 2) + '\n',
    'utf-8',
  );
  return PROFILE_PATH;
}

function loadJsonFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
