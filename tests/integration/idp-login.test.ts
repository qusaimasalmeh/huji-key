import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runIdpAutoLogin } from '../../src/content/idp-login-core';
import { generateTotp } from '../../src/core/totp';

const FIXTURE = fs.readFileSync(path.resolve('tests/fixtures/huji-idp-login.html'), 'utf8');

function makeMemoryStorage() {
  let store: Record<string, unknown> = {};
  return {
    async get(keys?: string | string[] | null) {
      if (!keys) return { ...store };
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (k in store) out[k] = store[k];
      }
      return out;
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, items);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
    },
    async clear() {
      store = {};
    }
  };
}

describe('HUJI IdP auto-login DOM integration', () => {
  let sendMessageMock: ReturnType<typeof vi.fn>;
  let localStorageMock: ReturnType<typeof makeMemoryStorage>;

  beforeEach(() => {
    localStorageMock = makeMemoryStorage();
    const session = makeMemoryStorage();
    sendMessageMock = vi.fn(async () => ({
      ok: true,
      data: {
        status: 'ready',
        credentials: {
          id9: '000000018',
          pin4: '0429',
          totpSecret: 'JBSWY3DPEHPK3PXP',
          issuer: 'HUJI',
          digits: 6,
          period: 30,
          algorithm: 'SHA-1'
        }
      }
    }));
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: localStorageMock, session, onChanged: { addListener: () => {} } },
      runtime: {
        sendMessage: sendMessageMock,
        openOptionsPage: vi.fn()
      }
    };
  });

  it('switches from SMS tab to OTP tab, fills ID and pin4+totp6, and clicks submit', async () => {
    const dom = new JSDOM(FIXTURE, {
      url: 'https://idp.cc.huji.ac.il/simplesaml/module.php/hujicc/login?AuthState=_abc123%3Afoo'
    });
    const doc = dom.window.document;

    // Simulate landing on SMS tab initially
    doc.getElementById('hujicc-otp-tab')?.classList.remove('active', 'show');
    doc.getElementById('hujicc-otp-tab')?.setAttribute('aria-selected', 'false');
    doc.getElementById('hujicc-otp')?.classList.remove('active', 'show');
    doc.getElementById('hujicc-sms-tab')?.classList.add('active', 'show');
    doc.getElementById('hujicc-sms')?.classList.add('active', 'show');

    const clicked = vi.fn();
    doc.getElementById('hujicc-captcha-btn-otp')?.addEventListener('click', (e) => {
      e.preventDefault();
      clicked();
    });

    const fixedNow = 1_700_000_010_000; // 10s into 30s window -> 20s left
    const expectedTotp = await generateTotp({ secret: 'JBSWY3DPEHPK3PXP', timestampMs: fixedNow });

    await runIdpAutoLogin(doc, { nowMs: fixedNow, recaptchaWaitMs: 0 });

    expect(doc.getElementById('hujicc-otp-tab')?.getAttribute('aria-selected')).toBe('true');
    expect((doc.getElementById('hujicc-otp-username') as HTMLInputElement).value).toBe('000000018');
    expect((doc.getElementById('hujicc-otp-password') as HTMLInputElement).value).toBe(
      `0429${expectedTotp}`
    );
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('pauses auto-submit when page shows an error alert and allows one-click retry', async () => {
    const dom = new JSDOM(FIXTURE, {
      url: 'https://idp.cc.huji.ac.il/simplesaml/module.php/hujicc/login?AuthState=_err1%3Afoo'
    });
    const doc = dom.window.document;
    const errBox = doc.createElement('div');
    errBox.className = 'alert alert-danger';
    errBox.textContent = 'Invalid credentials';
    doc.getElementById('hujicc-form-otp')?.prepend(errBox);

    const clicked = vi.fn();
    doc.getElementById('hujicc-captcha-btn-otp')?.addEventListener('click', (e) => {
      e.preventDefault();
      clicked();
    });

    await runIdpAutoLogin(doc, { nowMs: 1_700_000_010_000, recaptchaWaitMs: 0 });
    expect(clicked).not.toHaveBeenCalled();
    const pill = doc.getElementById('huji-key-pill');
    expect(pill?.textContent).toMatch(/paused/i);

    const retryBtn = pill?.querySelector('button');
    expect(retryBtn).not.toBeNull();
    retryBtn?.click();
    await vi.waitFor(() => {
      expect(clicked).toHaveBeenCalledTimes(1);
    });
  });

  it('fills without submitting when autoSubmit is disabled and shows locked/unconfigured pills', async () => {
    const dom = new JSDOM(FIXTURE, {
      url: 'https://idp.cc.huji.ac.il/simplesaml/module.php/hujicc/login?AuthState=_noauto%3Afoo'
    });
    const doc = dom.window.document;
    const clicked = vi.fn();
    doc.getElementById('hujicc-captcha-btn-otp')?.addEventListener('click', (e) => {
      e.preventDefault();
      clicked();
    });

    await localStorageMock.set({ settings: { autoFill: true, autoSubmit: false } });
    await runIdpAutoLogin(doc, { nowMs: 1_700_000_010_000, recaptchaWaitMs: 0 });
    expect(clicked).not.toHaveBeenCalled();
    expect((doc.getElementById('hujicc-otp-username') as HTMLInputElement).value).toBe('000000018');
    expect(doc.getElementById('huji-key-pill')?.textContent).toMatch(/Filled ID \+ OTP/i);

    sendMessageMock.mockResolvedValueOnce({ ok: true, data: { status: 'locked' } });
    await runIdpAutoLogin(doc, { recaptchaWaitMs: 0 });
    expect(doc.getElementById('huji-key-pill')?.textContent).toMatch(/Locked/i);

    sendMessageMock.mockResolvedValueOnce({ ok: true, data: { status: 'unconfigured' } });
    await runIdpAutoLogin(doc, { recaptchaWaitMs: 0 });
    expect(doc.getElementById('huji-key-pill')?.textContent).toMatch(/Not configured/i);
  });

  it('re-runs auto-login when session unlockedCredentials changes in storage', async () => {
    const dom = new JSDOM(FIXTURE, {
      url: 'https://idp.cc.huji.ac.il/simplesaml/module.php/hujicc/login?AuthState=_unlock1%3Afoo'
    });
    const doc = dom.window.document;
    const origDocument = globalThis.document;
    const clicked = vi.fn();
    doc.getElementById('hujicc-captcha-btn-otp')?.addEventListener('click', (e) => {
      e.preventDefault();
      clicked();
    });

    const listeners: Array<
      (changes: Record<string, { newValue?: unknown }>, areaName: string) => void
    > = [];
    sendMessageMock
      .mockResolvedValueOnce({ ok: true, data: { status: 'locked' } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: 'ready',
          credentials: {
            id9: '000000018',
            pin4: '0429',
            totpSecret: 'JBSWY3DPEHPK3PXP',
            issuer: 'HUJI',
            digits: 6,
            period: 30,
            algorithm: 'SHA-1'
          }
        }
      });

    const chromeMock = (globalThis as unknown as { chrome: { storage: Record<string, unknown> } })
      .chrome;
    chromeMock.storage.onChanged = {
      addListener: (
        fn: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void
      ) => {
        listeners.push(fn);
      }
    };

    try {
      globalThis.document = doc;
      vi.resetModules();
      await import('../../src/content/idp-login');

      await vi.waitFor(() => {
        expect(doc.getElementById('huji-key-pill')?.textContent).toMatch(/Locked/i);
      });
      expect(listeners).toHaveLength(1);

      listeners[0]?.({ unlockedCredentials: { newValue: { id9: '000000018' } } }, 'session');
      await vi.waitFor(() => {
        expect(clicked).toHaveBeenCalledTimes(1);
      });
      expect((doc.getElementById('hujicc-otp-username') as HTMLInputElement).value).toBe(
        '000000018'
      );
    } finally {
      globalThis.document = origDocument;
    }
  });
});
