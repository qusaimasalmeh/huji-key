import { beforeEach, describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { decodeQrFromImageData } from '../../src/shared/qr';
import {
  clearAllData,
  DEFAULT_SETTINGS,
  getKeepAliveStates,
  getSettings,
  updateKeepAliveSiteState,
  updateSettings
} from '../../src/shared/storage';

function makeMemoryStorage() {
  let store: Record<string, unknown> = {};
  return {
    async get(keys?: string | string[] | null) {
      if (!keys) return { ...store };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) {
        if (k in store) out[k] = store[k];
      }
      return out;
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, items);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        delete store[k];
      }
    },
    async clear() {
      store = {};
    }
  };
}

describe('storage layer & local QR decoder', () => {
  beforeEach(() => {
    const local = makeMemoryStorage();
    const session = makeMemoryStorage();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local, session, onChanged: { addListener: () => {} } },
      runtime: { sendMessage: async () => ({}) },
      alarms: { create: async () => {}, clear: async () => {} },
      tabs: { query: async () => [] }
    };
  });

  it('returns default settings and updates them cleanly', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    const updated = await updateSettings({ language: 'he', keepAliveCsMoodle: true });
    expect(updated.language).toBe('he');
    expect(updated.keepAliveCsMoodle).toBe(true);
    expect(updated.autoFill).toBe(true);
  });

  it('updates keep-alive site states and clears all data', async () => {
    await updateKeepAliveSiteState('moodle', { status: 'ok', lastPingAt: 1234 });
    const states = await getKeepAliveStates();
    expect(states.moodle.status).toBe('ok');
    expect(states.moodle.lastPingAt).toBe(1234);

    await clearAllData();
    expect((await getKeepAliveStates()).moodle.status).toBe('never');
  });

  it('decodes QR payload from RGBA ImageData using jsQR', () => {
    const uri = 'otpauth://totp/HUJI:000000018?secret=JBSWY3DPEHPK3PXP&issuer=HUJI';
    const qr = QRCode.create(uri, { errorCorrectionLevel: 'M' });
    const modules = qr.modules.size;
    const scale = 4;
    const margin = 4 * scale;
    const width = modules * scale + margin * 2;
    const rgba = new Uint8ClampedArray(width * width * 4).fill(255);

    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        if (!qr.modules.get(r, c)) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = margin + c * scale + dx;
            const y = margin + r * scale + dy;
            const idx = (y * width + x) * 4;
            rgba[idx] = 0;
            rgba[idx + 1] = 0;
            rgba[idx + 2] = 0;
          }
        }
      }
    }

    expect(decodeQrFromImageData(rgba, width, width)).toBe(uri);
  });
});
