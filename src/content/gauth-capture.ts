import { ext } from '../shared/browser';
import { getSettings } from '../shared/storage';
import { extractGauthFromDocument, renderGauthBanner } from './gauth-capture-core';

let scanned = false;
let scanning = false;
let observer: MutationObserver | undefined;

async function tryScan(): Promise<void> {
  if (scanned || scanning) return;
  scanning = true;
  try {
    const captured = await extractGauthFromDocument(document);
    if (!captured) return;
    scanned = true;
    observer?.disconnect();
    const settings = await getSettings();
    renderGauthBanner(document, settings.language, captured);
  } catch {
    // Ignore transient scan or storage errors during teardown
  } finally {
    scanning = false;
  }
}

if (document.body) {
  observer = new MutationObserver(() => {
    void tryScan();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

void tryScan();

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
