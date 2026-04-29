export interface JobRecord {
  url: string;
  title: string | null;
  companyName: string | null;
  status: 'scraped' | 'autofilled' | 'applied' | 'blocked' | 'skipped' | 'error';
  firstSeen: string;
  lastSeen: string;
  error?: string;
}

export interface JobStore {
  [url: string]: JobRecord;
}
