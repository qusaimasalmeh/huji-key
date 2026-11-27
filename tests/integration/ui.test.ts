import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyDocumentLocale } from '../../src/core/i18n';
import { initAccessibleValidation, initTablist } from '../../src/shared/ui-a11y';

function createChromeMock(initialLocal: Record<string, unknown> = {}, initialSession: Record<string, unknown> = {}) {
  const localData: Record<string, unknown> = { ...initialLocal };
  const sessionData: Record<string, unknown> = { ...initialSession };
  const sendMessage = vi.fn(async (msg: { type: string }) => {
    if (msg.type === 'GET_CREDENTIALS_STATUS') {
      return { ok: true, data: { status: 'unconfigured' } };
    }
    return { ok: true, data: true };
  });

  const chromeMock = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) {
            if (k in localData) out[k] = localData[k];
          }
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(localData, items);
        }),
        clear: vi.fn(async () => {
          for (const k of Object.keys(localData)) delete localData[k];
        })
      },
      session: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) {
            if (k in sessionData) out[k] = sessionData[k];
          }
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(sessionData, items);
        }),
        clear: vi.fn(async () => {
          for (const k of Object.keys(sessionData)) delete sessionData[k];
        })
      }
    },
    runtime: {
      sendMessage,
      openOptionsPage: vi.fn(async () => undefined)
    },
    tabs: {
      create: vi.fn(async () => ({}))
    },
    alarms: {
      create: vi.fn(async () => undefined),
      clear: vi.fn(async () => true)
    }
  };

  return { chromeMock, localData, sessionData, sendMessage };
}

describe('Popup & Options UI accessibility and RTL/LTR', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  const originalNavigator = globalThis.navigator;
  const originalPrompt = globalThis.prompt;
  const originalCreateImageBitmap = globalThis.createImageBitmap;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (globalThis.window && typeof globalThis.window.dispatchEvent === 'function') {
      try {
        globalThis.window.dispatchEvent(new globalThis.window.Event('pagehide'));
      } catch {
        // Ignore if test did not swap global window
      }
    }
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
    globalThis.prompt = originalPrompt;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true
    });
  });

  it('renders clean HTML without inline scripts or handlers and enforces UI constraints', () => {
    for (const rel of ['src/popup/popup.html', 'src/options/options.html']) {
      const html = fs.readFileSync(path.resolve(rel), 'utf8');
      expect(html).not.toMatch(/<script\b(?![^>]*\bsrc=)[^>]*>/i);
      expect(html).not.toMatch(/\bon[a-z]+\s*=/i);
    }

    const optionsHtml = fs.readFileSync(path.resolve('src/options/options.html'), 'utf8');
    const optDom = new JSDOM(optionsHtml);
    const idInput = optDom.window.document.getElementById('input-id9') as HTMLInputElement;
    const pinInput = optDom.window.document.getElementById('input-pin4') as HTMLInputElement;
    expect(idInput.type).toBe('text');
    expect(idInput.getAttribute('inputmode')).toBe('numeric');
    expect(pinInput.type).toBe('text');
    expect(pinInput.getAttribute('inputmode')).toBe('numeric');

    const wipeDialog = optDom.window.document.getElementById('wipe-dialog');
    expect(wipeDialog?.tagName.toLowerCase()).toBe('dialog');
    expect(wipeDialog?.hasAttribute('role')).toBe(false);
    expect(wipeDialog?.hasAttribute('aria-modal')).toBe(false);

    for (const cssRel of ['src/popup/popup.css', 'src/options/options.css']) {
      const css = fs.readFileSync(path.resolve(cssRel), 'utf8');
      expect(css.toLowerCase()).toContain('#f8fafc');
      expect(css.toLowerCase()).toContain('#ffffff');
      expect(css.toLowerCase()).toContain('#e2e8f0');
      expect(css.toLowerCase()).toContain('#0f172a');
      expect(css.toLowerCase()).toContain('#1d4ed8');
      expect(css.toLowerCase()).toContain('#991b1b');
      expect(css).toContain('inset-inline-start');
      expect(css).toContain('html[dir="rtl"]');
    }
  });

  it('uses EN | עב | ع switcher and switches document direction cleanly', () => {
    const html = fs.readFileSync(path.resolve('src/popup/popup.html'), 'utf8');
    expect(html).toContain('EN');
    expect(html).toContain('עב');
    expect(html).toContain('ع');

    const dom = new JSDOM(html);
    applyDocumentLocale(dom.window.document, 'he');
    expect(dom.window.document.documentElement.dir).toBe('rtl');
    applyDocumentLocale(dom.window.document, 'ar');
    expect(dom.window.document.documentElement.lang).toBe('ar');
    expect(dom.window.document.documentElement.dir).toBe('rtl');
    applyDocumentLocale(dom.window.document, 'en');
    expect(dom.window.document.documentElement.dir).toBe('ltr');
  });

  it('supports keyboard ArrowRight/ArrowLeft/Home/End and beforematch on onboarding tabs respecting RTL', () => {
    const html = fs.readFileSync(path.resolve('src/options/options.html'), 'utf8');
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const tablist = doc.querySelector('[role="tablist"]') as HTMLElement;
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]')) as HTMLButtonElement[];

    let lastPanel = '';
    initTablist(tablist, (panelId) => {
      lastPanel = panelId;
    });

    // RTL flips ArrowLeft to advance to next tab
    doc.documentElement.dir = 'rtl';
    tabs[0]?.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(lastPanel).toBe(tabs[1]?.getAttribute('data-panel'));
    expect(doc.getElementById('panel-qr')?.hasAttribute('hidden')).toBe(false);
    expect(doc.getElementById('panel-gauth')?.getAttribute('hidden')).toBe('until-found');

    // End jumps to last tab, Home jumps to first tab
    tablist.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(tabs[3]?.getAttribute('aria-selected')).toBe('true');
    tablist.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');

    // beforematch on a hidden="until-found" panel activates its corresponding tab
    doc.getElementById('panel-uri')?.dispatchEvent(new dom.window.Event('beforematch'));
    expect(tabs[2]?.getAttribute('aria-selected')).toBe('true');
    expect(lastPanel).toBe('panel-uri');
  });

  it('syncs aria-invalid, aria-describedby, and polite live announcements via initAccessibleValidation', async () => {
    vi.useFakeTimers();
    const html = fs.readFileSync(path.resolve('src/options/options.html'), 'utf8');
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const { syncField } = initAccessibleValidation(doc);
    const idInput = doc.getElementById('input-id9') as HTMLInputElement;

    expect(idInput.getAttribute('aria-invalid')).toBe('false');
    expect(idInput.getAttribute('aria-describedby')).toBe('hint-id9');

    // Blur while empty flags invalid and appends error id while preserving hint
    idInput.dispatchEvent(new dom.window.Event('blur'));
    expect(idInput.getAttribute('aria-invalid')).toBe('true');
    expect(idInput.getAttribute('aria-describedby')).toBe('hint-id9 err-id9');

    // Polite live region announces error text after debounce
    const errText = doc.getElementById('err-id9') as HTMLElement;
    errText.textContent = 'Error: Enter exactly 9 numeric digits.';
    idInput.dispatchEvent(new dom.window.Event('blur'));
    await vi.advanceTimersByTimeAsync(100);
    const announcer = doc.querySelector('[aria-live="polite"].visually-hidden');
    expect(announcer?.textContent).toBe('Error: Enter exactly 9 numeric digits.');

    // Typing valid 9-digit value clears aria-invalid and removes err-id9 while keeping hint-id9
    idInput.value = '012345678';
    idInput.dispatchEvent(new dom.window.Event('input'));
    expect(idInput.getAttribute('aria-invalid')).toBe('false');
    expect(idInput.getAttribute('aria-describedby')).toBe('hint-id9');

    // Force-flagging an invalid state works via syncField
    idInput.value = '123';
    syncField(idInput, false, true);
    expect(idInput.getAttribute('aria-invalid')).toBe('true');

    // Form reset clears flagged state, aria-invalid, and error aria-describedby
    const form = doc.getElementById('credentials-form') as HTMLFormElement;
    form.reset();
    expect(idInput.getAttribute('aria-invalid')).toBe('false');
    expect(idInput.getAttribute('aria-describedby')).toBe('hint-id9');
    idInput.dispatchEvent(new dom.window.Event('input'));
    expect(idInput.getAttribute('aria-invalid')).toBe('false');
  });

  it('popup renders live OTP, switches trilingual UI, and copies 6-digit / PIN+OTP codes', async () => {
    const html = fs.readFileSync(path.resolve('src/popup/popup.html'), 'utf8');
    const dom = new JSDOM(html, { url: 'https://extension.local/popup.html' });
    const doc = dom.window.document;

    const creds = {
      id9: '000000018',
      pin4: '1234',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      issuer: 'HUJI',
      digits: 6,
      period: 30,
      algorithm: 'SHA-1' as const
    };
    const { chromeMock, localData, sendMessage } = createChromeMock({
      settings: { language: 'en', lockEnabled: true, autoFill: true, autoSubmit: true }
    });
    sendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_CREDENTIALS_STATUS') {
        return { ok: true, data: { status: 'ready', credentials: creds } };
      }
      return { ok: true, data: true };
    });

    const writeText = vi.fn(async () => undefined);
    globalThis.document = doc;
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    (globalThis as { chrome?: unknown }).chrome = chromeMock;
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true
    });

    vi.resetModules();
    await import('../../src/popup/popup');
    doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));

    let renderedDigits = '';
    await vi.waitFor(() => {
      expect(doc.getElementById('view-otp')?.hidden).toBe(false);
      renderedDigits = (doc.getElementById('live-otp-code')?.textContent ?? '').replace(/\s+/g, '');
      expect(renderedDigits).toMatch(/^\d{6}$/);
    });

    expect(doc.getElementById('view-unconfigured')?.hidden).toBe(true);
    expect(doc.getElementById('meta-id')?.textContent).toContain('000000018');
    expect(doc.getElementById('meta-pin')?.textContent).toContain('1234');
    expect(doc.getElementById('btn-lock-now')?.hidden).toBe(false);

    // Copy 6-digit OTP and PIN+OTP
    doc.getElementById('btn-copy-6')?.click();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(renderedDigits);
    });

    doc.getElementById('btn-copy-full')?.click();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`1234${renderedDigits}`);
    });

    // Switch language to Hebrew -> updates dir="rtl" and persists setting
    const heBtn = doc.querySelector('.lang-btn[data-lang="he"]') as HTMLButtonElement;
    heBtn.click();
    await vi.waitFor(() => {
      expect(doc.documentElement.lang).toBe('he');
      expect(doc.documentElement.dir).toBe('rtl');
      expect((localData.settings as { language: string }).language).toBe('he');
    });
  });

  it('options page parses otpauth URI, validates and saves credentials, and confirms wipe via <dialog>', async () => {
    const html = fs.readFileSync(path.resolve('src/options/options.html'), 'utf8');
    const dom = new JSDOM(html, { url: 'https://extension.local/options.html' });
    const doc = dom.window.document;

    // JSDOM lacks HTMLDialogElement.showModal/close natively
    const wipeDialog = doc.getElementById('wipe-dialog') as HTMLDialogElement;
    wipeDialog.showModal = vi.fn(() => {
      wipeDialog.setAttribute('open', '');
    });
    wipeDialog.close = vi.fn(() => {
      wipeDialog.removeAttribute('open');
    });

    const { chromeMock, localData } = createChromeMock();
    globalThis.document = doc;
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    (globalThis as { chrome?: unknown }).chrome = chromeMock;

    vi.resetModules();
    await import('../../src/options/options');
    doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));

    await vi.waitFor(() => {
      expect(doc.getElementById('otpauth-uri')?.getAttribute('placeholder')).toContain('otpauth://');
    });

    // Parse otpauth:// URI
    (doc.getElementById('otpauth-uri') as HTMLInputElement).value =
      'otpauth://totp/HUJI:000000018?secret=JBSWY3DPEHPK3PXP&issuer=HUJI';
    doc.getElementById('btn-parse-uri')?.click();

    await vi.waitFor(() => {
      expect((doc.getElementById('input-secret') as HTMLInputElement).value).toBe('JBSWY3DPEHPK3PXP');
      expect((doc.getElementById('preview-code')?.textContent ?? '').replace(/\s+/g, '')).toMatch(/^\d{6}$/);
    });

    // Invalid submit marks ID/PIN invalid, then fixing inputs clears aria-invalid
    const form = doc.getElementById('credentials-form') as HTMLFormElement;
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));

    const idEl = doc.getElementById('input-id9') as HTMLInputElement;
    const pinEl = doc.getElementById('input-pin4') as HTMLInputElement;
    expect(idEl.getAttribute('aria-invalid')).toBe('true');
    expect(pinEl.getAttribute('aria-invalid')).toBe('true');

    idEl.value = '000000018';
    idEl.dispatchEvent(new dom.window.Event('input'));
    pinEl.value = '4321';
    pinEl.dispatchEvent(new dom.window.Event('input'));
    expect(idEl.getAttribute('aria-invalid')).toBe('false');
    expect(pinEl.getAttribute('aria-invalid')).toBe('false');

    // Valid submit saves credentials locally
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await vi.waitFor(() => {
      expect(localData.credentials).toEqual({
        id9: '000000018',
        pin4: '4321',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        issuer: 'HUJI',
        digits: 6,
        period: 30,
        algorithm: 'SHA-1'
      });
      expect(doc.getElementById('save-banner')?.hidden).toBe(false);
    });

    // Open and confirm <dialog> wipe resets form and clears banners/error state
    const resetSpy = vi.spyOn(form, 'reset');
    idEl.value = '123';
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    expect(idEl.getAttribute('aria-invalid')).toBe('true');

    doc.getElementById('btn-open-wipe')?.click();
    expect(wipeDialog.showModal).toHaveBeenCalledTimes(1);
    doc.getElementById('btn-confirm-wipe')?.click();
    await vi.waitFor(() => {
      expect(localData.credentials).toBeUndefined();
      expect(wipeDialog.close).toHaveBeenCalledTimes(1);
    });
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(idEl.getAttribute('aria-invalid')).toBe('false');
    expect(idEl.getAttribute('aria-describedby')).toBe('hint-id9');
    expect(doc.getElementById('save-banner')?.hidden).toBe(true);
    expect(doc.getElementById('import-banner')?.hidden).toBe(true);
    expect(doc.getElementById('warn-id9')?.hidden).toBe(true);
  });

  it('options hides stale save-banner and shows inline save-error inside credentials form on cancelled or wrong Master Lock prompt', async () => {
    const html = fs.readFileSync(path.resolve('src/options/options.html'), 'utf8');
    const dom = new JSDOM(html, { url: 'https://extension.local/options.html' });
    const doc = dom.window.document;

    const { chromeMock } = createChromeMock();
    globalThis.document = doc;
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    (globalThis as { chrome?: unknown }).chrome = chromeMock;

    vi.resetModules();
    await import('../../src/options/options');
    doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));

    await vi.waitFor(() => {
      expect(doc.getElementById('otpauth-uri')?.getAttribute('placeholder')).toContain('otpauth://');
    });

    const form = doc.getElementById('credentials-form') as HTMLFormElement;
    const idEl = doc.getElementById('input-id9') as HTMLInputElement;
    const pinEl = doc.getElementById('input-pin4') as HTMLInputElement;
    const secretEl = doc.getElementById('input-secret') as HTMLInputElement;
    idEl.value = '000000018';
    pinEl.value = '4321';
    secretEl.value = 'JBSWY3DPEHPK3PXP';

    // Initial save succeeds and reveals #save-banner
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await vi.waitFor(() => {
      expect(doc.getElementById('save-banner')?.hidden).toBe(false);
    });

    // Enable Master Lock
    (doc.getElementById('lock-pass-1') as HTMLInputElement).value = 'pass1234';
    (doc.getElementById('lock-pass-2') as HTMLInputElement).value = 'pass1234';
    doc.getElementById('btn-enable-lock')?.click();
    await vi.waitFor(() => {
      expect(doc.getElementById('lock-disable-box')?.hidden).toBe(false);
    });
    doc.getElementById('lock-msg')!.textContent = '';

    // Cancelling prompt hides stale #save-banner and shows inline error inside #credentials-form
    globalThis.prompt = vi.fn(() => null);
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await vi.waitFor(() => {
      const saveError = doc.getElementById('save-error');
      expect(doc.getElementById('save-banner')?.hidden).toBe(true);
      expect(saveError?.hidden).toBe(false);
      expect(saveError?.textContent).toBeTruthy();
      expect(form.contains(saveError)).toBe(true);
    });

    // Wrong passphrase hides #save-banner and displays localized error inside #credentials-form (not only lock-msg)
    globalThis.prompt = vi.fn(() => 'wrong-pass');
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await vi.waitFor(() => {
      const saveError = doc.getElementById('save-error');
      expect(doc.getElementById('save-banner')?.hidden).toBe(true);
      expect(saveError?.hidden).toBe(false);
      expect(saveError?.textContent).toContain('Incorrect passphrase');
      expect(doc.getElementById('lock-msg')?.textContent).toBe('');
    });
  });

  it('guards undefined runtime.sendMessage responses gracefully in popup and options', async () => {
    // Popup with undefined responses on CAPTURE_OPEN_GAUTH and UNLOCK_CREDENTIALS
    const popupHtml = fs.readFileSync(path.resolve('src/popup/popup.html'), 'utf8');
    const popupDom = new JSDOM(popupHtml, { url: 'https://extension.local/popup.html' });
    const popupDoc = popupDom.window.document;
    const { chromeMock: popupChrome, sendMessage: popupSend } = createChromeMock();
    popupSend.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_CREDENTIALS_STATUS') {
        return { ok: true, data: { status: 'unconfigured' } };
      }
      return undefined as never;
    });

    globalThis.document = popupDoc;
    globalThis.window = popupDom.window as unknown as Window & typeof globalThis;
    (globalThis as { chrome?: unknown }).chrome = popupChrome;

    vi.resetModules();
    await import('../../src/popup/popup');
    popupDoc.dispatchEvent(new popupDom.window.Event('DOMContentLoaded'));
    await vi.waitFor(() => {
      expect(popupDoc.getElementById('view-unconfigured')?.hidden).toBe(false);
    });

    popupDoc.getElementById('btn-capture-gauth')?.click();
    await vi.waitFor(() => {
      expect(popupDoc.getElementById('gauth-feedback')?.textContent).toContain('No QR code');
    });

    (popupDoc.getElementById('unlock-passphrase') as HTMLInputElement).value = 'secret';
    popupDoc.getElementById('unlock-form')?.dispatchEvent(new popupDom.window.Event('submit', { cancelable: true }));
    await vi.waitFor(() => {
      const unlockErr = popupDoc.getElementById('unlock-error');
      expect(unlockErr?.hidden).toBe(false);
      expect(unlockErr?.textContent).toContain('Incorrect passphrase');
    });

    popupDom.window.dispatchEvent(new popupDom.window.Event('pagehide'));

    // Options with undefined response on CAPTURE_OPEN_GAUTH
    const optHtml = fs.readFileSync(path.resolve('src/options/options.html'), 'utf8');
    const optDom = new JSDOM(optHtml, { url: 'https://extension.local/options.html' });
    const optDoc = optDom.window.document;
    const { chromeMock: optChrome, sendMessage: optSend } = createChromeMock();
    optSend.mockImplementation(async () => undefined as never);

    globalThis.document = optDoc;
    globalThis.window = optDom.window as unknown as Window & typeof globalThis;
    (globalThis as { chrome?: unknown }).chrome = optChrome;

    vi.resetModules();
    await import('../../src/options/options');
    optDoc.dispatchEvent(new optDom.window.Event('DOMContentLoaded'));
    await vi.waitFor(() => {
      expect(optDoc.getElementById('otpauth-uri')?.getAttribute('placeholder')).toContain('otpauth://');
    });

    optDoc.getElementById('btn-scan-gauth')?.click();
    await vi.waitFor(() => {
      expect(optDoc.getElementById('gauth-scan-msg')?.textContent).toContain('No QR code');
    });
  });

  it('guards popup sendMessage rejections, stale live-OTP writes, clipboard failures, and rapid-copy timer resets', async () => {
    const html = fs.readFileSync(path.resolve('src/popup/popup.html'), 'utf8');
    const dom = new JSDOM(html, { url: 'https://extension.local/popup.html' });
    const doc = dom.window.document;

    const creds = {
      id9: '000000018',
      pin4: '1234',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      issuer: 'HUJI',
      digits: 6,
      period: 30,
      algorithm: 'SHA-1' as const
    };
    let locked = false;
    const { chromeMock, sendMessage } = createChromeMock({
      settings: { language: 'en', lockEnabled: true, autoFill: true, autoSubmit: true }
    });
    sendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_CREDENTIALS_STATUS') {
        return { ok: true, data: locked ? { status: 'locked' } : { status: 'ready', credentials: creds } };
      }
      if (msg.type === 'LOCK_CREDENTIALS') {
        locked = true;
        return { ok: true, data: { status: 'locked' } };
      }
      throw new Error('worker offline');
    });

    const realSign = globalThis.crypto.subtle.sign.bind(globalThis.crypto.subtle);
    let resolveFirstSign!: (buf: ArrayBuffer) => void;
    const signSpy = vi
      .spyOn(globalThis.crypto.subtle, 'sign')
      .mockImplementationOnce(
        () =>
          new Promise<ArrayBuffer>((r) => {
            resolveFirstSign = r;
          })
      )
      .mockImplementation((...args) => realSign(...args));

    const writeText = vi.fn(async () => undefined);
    globalThis.document = doc;
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    (globalThis as { chrome?: unknown }).chrome = chromeMock;
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true
    });

    vi.resetModules();
    await import('../../src/popup/popup');
    doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));

    await vi.waitFor(() => {
      expect(signSpy).toHaveBeenCalledTimes(1);
    });

    // Lock before first generateTotp finishes -> stale OTP must NOT overwrite #live-otp-code
    doc.getElementById('btn-lock-now')?.click();
    await vi.waitFor(() => {
      expect(doc.getElementById('view-locked')?.hidden).toBe(false);
    });

    resolveFirstSign(new Uint8Array(20).buffer);
    await Promise.resolve();
    await Promise.resolve();
    expect(doc.getElementById('live-otp-code')?.textContent).toBe('------');

    // Re-open in unlocked state and verify rejected sendMessage on switches/ping/lock
    locked = false;
    const kaToggle = doc.getElementById('toggle-ka-moodle') as HTMLInputElement;
    kaToggle.checked = false;
    kaToggle.dispatchEvent(new dom.window.Event('change'));
    doc.getElementById('btn-ping-now')?.click();
    await vi.waitFor(() => {
      expect(doc.getElementById('view-otp')?.hidden).toBe(false);
      expect(doc.getElementById('live-otp-code')?.textContent).not.toBe('------');
    });

    // Rejected LOCK_CREDENTIALS also resolves cleanly without throwing
    const callsBeforeLock = sendMessage.mock.calls.length;
    sendMessage.mockRejectedValueOnce(new Error('worker gone'));
    doc.getElementById('btn-lock-now')?.click();
    await vi.waitFor(() => {
      expect(sendMessage.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeLock + 2);
      expect(sendMessage).toHaveBeenLastCalledWith({ type: 'GET_CREDENTIALS_STATUS' });
    });
    await new Promise((r) => setTimeout(r, 15));

    // Clipboard failure does not reject or set "Copied!"
    writeText.mockRejectedValueOnce(new Error('clipboard denied'));
    doc.getElementById('btn-copy-6')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(doc.getElementById('btn-copy-6')?.textContent).toBe('Copy 6-digit OTP');

    // Rapid double copy clears first timer so label stays "Copied!" past first 1200ms window
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    writeText.mockResolvedValue(undefined);
    doc.getElementById('btn-copy-6')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(doc.getElementById('btn-copy-6')?.textContent).toBe('Copied!');
    await vi.advanceTimersByTimeAsync(800);
    doc.getElementById('btn-copy-6')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(500); // 1300ms after 1st click, 500ms after 2nd click
    expect(doc.getElementById('btn-copy-6')?.textContent).toBe('Copied!');
    await vi.advanceTimersByTimeAsync(800);
    expect(doc.getElementById('btn-copy-6')?.textContent).toBe('Copy 6-digit OTP');
  });

  it('guards options sendMessage rejections, stale preview writes, and clears qr-file-input value after change', async () => {
    const html = fs.readFileSync(path.resolve('src/options/options.html'), 'utf8');
    const dom = new JSDOM(html, { url: 'https://extension.local/options.html' });
    const doc = dom.window.document;

    const { chromeMock, sendMessage } = createChromeMock();
    sendMessage.mockRejectedValue(new Error('worker offline'));

    const realSign = globalThis.crypto.subtle.sign.bind(globalThis.crypto.subtle);
    let resolvePreviewSign!: (buf: ArrayBuffer) => void;
    const signSpy = vi
      .spyOn(globalThis.crypto.subtle, 'sign')
      .mockImplementationOnce(
        () =>
          new Promise<ArrayBuffer>((r) => {
            resolvePreviewSign = r;
          })
      )
      .mockImplementation((...args) => realSign(...args));

    globalThis.createImageBitmap = vi.fn(async () => {
      throw new Error('bad image');
    }) as unknown as typeof createImageBitmap;

    globalThis.document = doc;
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    (globalThis as { chrome?: unknown }).chrome = chromeMock;

    vi.resetModules();
    await import('../../src/options/options');
    doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));

    await vi.waitFor(() => {
      expect(doc.getElementById('otpauth-uri')?.getAttribute('placeholder')).toContain('otpauth://');
    });

    // Stale preview write: type valid secret -> clear before sign resolves -> preview stays ------
    const secretEl = doc.getElementById('input-secret') as HTMLInputElement;
    secretEl.value = 'JBSWY3DPEHPK3PXP';
    secretEl.dispatchEvent(new dom.window.Event('input'));

    await vi.waitFor(() => {
      expect(signSpy).toHaveBeenCalledTimes(1);
    });

    secretEl.value = '';
    secretEl.dispatchEvent(new dom.window.Event('input'));
    expect(doc.getElementById('preview-code')?.textContent).toBe('------');

    resolvePreviewSign(new Uint8Array(20).buffer);
    await Promise.resolve();
    await Promise.resolve();
    expect(doc.getElementById('preview-code')?.textContent).toBe('------');

    // SendMessage rejections on interval, CS toggle, and reset guard do not throw or fake success
    const intervalEl = doc.getElementById('select-interval') as HTMLSelectElement;
    intervalEl.value = '10';
    intervalEl.dispatchEvent(new dom.window.Event('change'));

    const csToggle = doc.getElementById('opt-ka-cs') as HTMLInputElement;
    csToggle.checked = true;
    csToggle.dispatchEvent(new dom.window.Event('change'));

    doc.getElementById('btn-reset-guard')?.click();
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({ type: 'RESET_LOGIN_GUARD' });
    });
    await new Promise((r) => setTimeout(r, 15));
    expect(doc.getElementById('safety-msg')?.textContent).toBe('');

    // File input resets its value to '' after processing a file
    const fileInput = doc.getElementById('qr-file-input') as HTMLInputElement;
    const protoDesc = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value'
    )!;
    const valueSetterSpy = vi.fn();
    Object.defineProperty(fileInput, 'value', {
      configurable: true,
      get() {
        return protoDesc.get!.call(this);
      },
      set(val: string) {
        valueSetterSpy(val);
        protoDesc.set!.call(this, val);
      }
    });
    const fakeFile = new dom.window.File(['not-a-qr'], 'qr.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [fakeFile]
    });
    fileInput.dispatchEvent(new dom.window.Event('change'));

    await vi.waitFor(() => {
      expect(valueSetterSpy).toHaveBeenCalledWith('');
    });
  });
});
