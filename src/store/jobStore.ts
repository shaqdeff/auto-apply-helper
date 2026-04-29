import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils';
import type { JobRecord, JobStore } from './types';

export function loadJobStore(filePath: string): JobStore {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as JobStore;
  } catch {
    return {};
  }
}

export function saveJobStore(filePath: string, store: JobStore): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

export function hasBeenApplied(store: JobStore, url: string): boolean {
  const record = store[url];
  return record?.status === 'applied';
}

export function recordJob(
  store: JobStore,
  url: string,
  partial: Pick<JobRecord, 'title' | 'companyName' | 'status'> & {
    error?: string;
  },
): void {
  const now = new Date().toISOString();
  const existing = store[url];

  store[url] = {
    url,
    title: partial.title,
    companyName: partial.companyName,
    status: partial.status,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
    ...(partial.error ? { error: partial.error } : {}),
  };

  logger.debug('Job recorded', { url, status: partial.status });
}
