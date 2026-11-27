import { ext } from '../shared/browser';
import { getSettings } from '../shared/storage';
import { extractGauthFromDocument, renderGauthBanner } from './gauth-capture-core';

let scanned = false;

async function tryScan(): Promise<void> {
  if (scanned) return;
  const captured = await extractGauthFromDocument(document);
  if (!captured) return;
  scanned = true;
  const settings = await getSettings();
  renderGauthBanner(document, settings.language, captured);
}

void tryScan();

if (document.body) {
  const observer = new MutationObserver(() => {
    void tryScan();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

ext.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
  if (msg?.type === 'EXTRACT_GAUTH_FROM_PAGE') {
    void (async () => {
      try {
        const data = await extractGauthFromDocument(document);
        if (data) sendResponse({ ok: true, data });
        else sendResponse({ ok: false, error: 'no_qr_found' });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : 'scan_failed' });
      }
    })();
    return true;
  }
  return false;
});
