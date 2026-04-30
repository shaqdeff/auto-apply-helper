import type {
  AutofillResponse,
  ClickApplyResponse,
  ExtractJobResponse,
  RuntimeMessage,
} from '../shared/types';
import { autofillForm, clickApplyButton } from './filler';
import { extractJob } from './scraper';

chrome.runtime.onMessage.addListener(
  (
    message: RuntimeMessage,
    _sender,
    sendResponse: (response: unknown) => void,
  ): boolean => {
    try {
      if (message.type === 'EXTRACT_JOB') {
        const job = extractJob();
        const response: ExtractJobResponse = { job };
        sendResponse(response);
        return false;
      }

      if (message.type === 'AUTOFILL') {
        const result = autofillForm(message.profile);
        const response: AutofillResponse = { result };
        sendResponse(response);
        return false;
      }

      if (message.type === 'CLICK_APPLY') {
        const clicked = clickApplyButton();
        const response: ClickApplyResponse = { clicked };
        sendResponse(response);
        return false;
      }
    } catch (err) {
      sendResponse({ error: (err as Error).message });
    }
    return false;
  },
);
