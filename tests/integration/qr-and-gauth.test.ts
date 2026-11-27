import { JSDOM } from 'jsdom';
import QRCode from 'qrcode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectPin4Candidate,
  extractGauthFromDocument,
  renderGauthBanner
} from '../../src/content/gauth-capture-core';
import { decodeQrFromElement, decodeQrFromImageData } from '../../src/shared/qr';

function renderQrMatrixRgba(uri: string, transparentBg = false): {
  rgba: Uint8ClampedArray;
  width: number;
} {
  const qr = QRCode.create(uri, { errorCorrectionLevel: 'M' });
  const modules = qr.modules.size;
  const scale = 4;
  const margin = 16;
  const width = modules * scale + margin * 2;
  const rgba = new Uint8ClampedArray(width * width * 4);
  if (!transparentBg) {
    rgba.fill(255);
  }
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (!qr.modules.get(r, c)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const idx = ((margin + r * scale + dy) * width + (margin + c * scale + dx)) * 4;
          rgba[idx] = 0;
          rgba[idx + 1] = 0;
          rgba[idx + 2] = 0;
          rgba[idx + 3] = 255;
        }
      }
    }
  }
  return { rgba, width };
}

describe('gauth capture & QR extraction', () => {
  const originalDocument = globalThis.document;
  const originalHtmlCanvasElement = globalThis.HTMLCanvasElement;

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.HTMLCanvasElement = originalHtmlCanvasElement;
  });

  it('detects 4-digit PIN near code label on gauth page', () => {
    const dom = new JSDOM(`
      <main>
        <p>Your 9-digit ID: 012345678</p>
        <div>Your 4-digit PIN code is: <strong>0429</strong></div>
      </main>
    `);
    expect(detectPin4Candidate(dom.window.document)).toBe('0429');
  });

  it('extracts otpauth URI from canvas QR element', async () => {
    const uri = 'otpauth://totp/HUJI:000000018?secret=JBSWY3DPEHPK3PXP&issuer=HUJI';
    const { rgba, width } = renderQrMatrixRgba(uri);

    const dom = new JSDOM('<canvas id="qr"></canvas><div>PIN: 5190</div>');
    const canvas = dom.window.document.getElementById('qr') as HTMLCanvasElement;
    canvas.width = width;
    canvas.height = width;
    (canvas as unknown as { getContext: () => unknown }).getContext = () => ({
      getImageData: () => ({ data: rgba, width, height: width })
    });

    const extracted = await extractGauthFromDocument(dom.window.document, async (el) => {
      if (el === canvas) return decodeQrFromImageData(rgba, width, width);
      return null;
    });

    expect(extracted?.totpSecret).toBe('JBSWY3DPEHPK3PXP');
    expect(extracted?.pin4).toBe('5190');
  });

  it('returns null on 0x0 canvas without throwing IndexSizeError and composites transparent canvas onto white', async () => {
    const uri = 'otpauth://totp/HUJI:000000018?secret=JBSWY3DPEHPK3PXP&issuer=HUJI';
    const { rgba: transparentQr, width } = renderQrMatrixRgba(uri, true);

    const dom = new JSDOM('<canvas id="empty"></canvas><canvas id="transparent"></canvas>');
    const doc = dom.window.document;

    globalThis.document = doc;
    globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;

    const emptyCanvas = doc.getElementById('empty') as HTMLCanvasElement;
    emptyCanvas.width = 0;
    emptyCanvas.height = 0;
    (emptyCanvas as unknown as { getContext: () => unknown }).getContext = () => ({
      getImageData: () => {
        throw new Error('IndexSizeError: source width is 0');
      }
    });

    await expect(decodeQrFromElement(emptyCanvas)).resolves.toBeNull();

    const transparentCanvas = doc.getElementById('transparent') as HTMLCanvasElement;
    transparentCanvas.width = width;
    transparentCanvas.height = width;
    (transparentCanvas as unknown as { getContext: () => unknown }).getContext = () => ({
      getImageData: () => ({ data: transparentQr, width, height: width })
    });

    // Mock offscreen canvas created inside drawOnCanvas so it composites source onto fillStyle=#ffffff
    const origCreateElement = doc.createElement.bind(doc);
    doc.createElement = ((tag: string) => {
      const created = origCreateElement(tag);
      if (tag === 'canvas') {
        let buffer = new Uint8ClampedArray(0);
        let fillColor = '';
        (created as unknown as { getContext: () => unknown }).getContext = () => ({
          set fillStyle(val: string) {
            fillColor = val;
          },
          get fillStyle() {
            return fillColor;
          },
          fillRect(_x: number, _y: number, w: number, h: number) {
            buffer = new Uint8ClampedArray(w * h * 4);
            if (fillColor.toLowerCase() === '#ffffff') {
              buffer.fill(255);
            }
          },
          drawImage(src: HTMLCanvasElement, _dx: number, _dy: number, w: number, h: number) {
            const srcCtx = src.getContext('2d') as unknown as {
              getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
            };
            const srcData = srcCtx.getImageData(0, 0, w, h).data;
            for (let i = 0; i < buffer.length; i += 4) {
              const alpha = (srcData[i + 3] ?? 0) / 255;
              buffer[i] = Math.round((srcData[i] ?? 0) * alpha + (buffer[i] ?? 255) * (1 - alpha));
              buffer[i + 1] = Math.round(
                (srcData[i + 1] ?? 0) * alpha + (buffer[i + 1] ?? 255) * (1 - alpha)
              );
              buffer[i + 2] = Math.round(
                (srcData[i + 2] ?? 0) * alpha + (buffer[i + 2] ?? 255) * (1 - alpha)
              );
              buffer[i + 3] = 255;
            }
          },
          getImageData(_x: number, _y: number, w: number, h: number) {
            return { data: buffer, width: w, height: h };
          }
        });
      }
      return created;
    }) as typeof doc.createElement;

    await expect(decodeQrFromElement(transparentCanvas)).resolves.toBe(uri);
  });

  it('renders gauth import banner once, sends OPEN_SETUP_WITH_IMPORT on click, and dismisses', () => {
    const sendMessage = vi.fn(async () => ({ ok: true, data: true }));
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: {}, session: {} },
      runtime: { sendMessage }
    };

    const dom = new JSDOM('<body></body>');
    const doc = dom.window.document;
    const captured = {
      totpSecret: 'JBSWY3DPEHPK3PXP',
      pin4: '5190',
      capturedAt: 1000
    };

    renderGauthBanner(doc, 'en', captured);
    renderGauthBanner(doc, 'en', captured);
    const banners = doc.querySelectorAll('#huji-key-gauth-banner');
    expect(banners).toHaveLength(1);

    const buttons = banners[0]?.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    buttons?.[0]?.click();
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'OPEN_SETUP_WITH_IMPORT',
      payload: captured
    });

    buttons?.[1]?.click();
    expect(doc.getElementById('huji-key-gauth-banner')).toBeNull();
  });

  it('gauth-capture entrypoint responds to EXTRACT_GAUTH_FROM_PAGE asynchronously', async () => {
    const dom = new JSDOM('<body><div>PIN: 2468</div></body>');
    const doc = dom.window.document;
    const origMutationObserver = globalThis.MutationObserver;
    const listeners: Array<
      (
        msg: { type?: string },
        sender: unknown,
        sendResponse: (res: unknown) => void
      ) => boolean
    > = [];

    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: { get: async () => ({}) },
        session: { get: async () => ({}) }
      },
      runtime: {
        onMessage: {
          addListener: (
            fn: (
              msg: { type?: string },
              sender: unknown,
              sendResponse: (res: unknown) => void
            ) => boolean
          ) => {
            listeners.push(fn);
          }
        }
      }
    };

    try {
      globalThis.document = doc;
      globalThis.MutationObserver = dom.window.MutationObserver;
      vi.resetModules();
      await import('../../src/content/gauth-capture');

      expect(listeners).toHaveLength(1);
      const sendResponse = vi.fn();
      const keepOpen = listeners[0]?.({ type: 'EXTRACT_GAUTH_FROM_PAGE' }, {}, sendResponse);
      expect(keepOpen).toBe(true);
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'no_qr_found' });
      });

      const otherResp = vi.fn();
      expect(listeners[0]?.({ type: 'OTHER' }, {}, otherResp)).toBe(false);
    } finally {
      globalThis.MutationObserver = origMutationObserver;
    }
  });
});
