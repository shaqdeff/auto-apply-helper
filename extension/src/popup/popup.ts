import { getProfile, isProfileComplete } from '../shared/profile';
import type {
  AutofillResponse,
  ClickApplyResponse,
  ExtractJobResponse,
  JobData,
  RuntimeMessage,
} from '../shared/types';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element ${id} not found`);
  return el as T;
};

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return tab.id;
}

function sendMessage<T>(tabId: number, message: RuntimeMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response as T);
      }
    });
  });
}

function setStatus(text: string, kind: 'loading' | 'error' = 'loading'): void {
  const status = $('status');
  status.classList.remove('hidden');
  status.classList.toggle('status--error', kind === 'error');
  status.querySelector('.status__text')!.textContent = text;
}

function hideStatus(): void {
  $('status').classList.add('hidden');
}

function renderJob(job: JobData): void {
  $('job-title').textContent = job.title ?? 'Unknown title';
  $('job-company').textContent = job.companyName ?? '—';
  $('job-location').textContent = job.location ?? '';
  $('job-confidence').textContent = job.confidence;

  const preview = job.description
    ? job.description.slice(0, 280) + (job.description.length > 280 ? '…' : '')
    : '';
  $('job-preview').textContent = preview;

  $('job').classList.remove('hidden');
}

function renderResult(filledFields: string[], errors: string[]): void {
  const summary = $('result-summary');
  const list = $('result-fields');

  if (filledFields.length === 0) {
    summary.textContent =
      errors.length > 0
        ? `No fields filled. ${errors.length} errors.`
        : 'No matching form fields found on this page.';
  } else {
    summary.textContent = `Filled ${filledFields.length} field${filledFields.length === 1 ? '' : 's'}.`;
  }

  list.innerHTML = '';
  for (const field of filledFields) {
    const li = document.createElement('li');
    li.textContent = field;
    list.appendChild(li);
  }

  $('result').classList.remove('hidden');
}

async function init(): Promise<void> {
  $('open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  $('open-options-warning').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  const profile = await getProfile();

  let tabId: number;
  try {
    tabId = await getActiveTabId();
  } catch {
    setStatus('Cannot read active tab.', 'error');
    return;
  }

  // Try to extract the job
  let job: JobData | null = null;
  try {
    const response = await sendMessage<ExtractJobResponse>(tabId, {
      type: 'EXTRACT_JOB',
    });
    job = response.job;
  } catch (err) {
    setStatus(
      `This site is not supported, or the page hasn't loaded. (${(err as Error).message})`,
      'error',
    );
    return;
  }

  hideStatus();
  renderJob(job);
  $('actions').classList.remove('hidden');

  // Profile check
  if (!isProfileComplete(profile)) {
    $('profile-warning').classList.remove('hidden');
    $<HTMLButtonElement>('autofill').disabled = true;
  }

  $('autofill').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>('autofill');
    btn.disabled = true;
    btn.textContent = 'Filling…';

    try {
      const response = await sendMessage<AutofillResponse>(tabId, {
        type: 'AUTOFILL',
        profile,
      });
      renderResult(response.result.filledFields, response.result.errors);
    } catch (err) {
      setStatus(`Autofill failed: ${(err as Error).message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Autofill';
    }
  });

  $('click-apply').addEventListener('click', async () => {
    try {
      const response = await sendMessage<ClickApplyResponse>(tabId, {
        type: 'CLICK_APPLY',
      });
      if (!response.clicked) {
        setStatus('No Apply button found on this page.', 'error');
      }
    } catch (err) {
      setStatus(`Could not click Apply: ${(err as Error).message}`, 'error');
    }
  });
}

void init();
