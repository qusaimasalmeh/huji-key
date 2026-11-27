import { getDirection, t } from '../core/i18n';
import { parseOtpAuthUri } from '../core/totp';
import type { Language, PendingGauthImport } from '../core/types';
import { ext } from '../shared/browser';
import { decodeQrFromElement } from '../shared/qr';

/** Scans the gauth page text and emphasized elements for a 4-digit fixed PIN candidate. */
export function detectPin4Candidate(doc: Document): string | undefined {
  const text = doc.body?.innerText || doc.body?.textContent || '';
  const labeledMatch = text.match(/(?:pin|code|קוד|رمز)[^\d\n]{0,25}(\d{4})\b/i);
  if (labeledMatch?.[1]) return labeledMatch[1];

  const strongCandidates = Array.from(doc.querySelectorAll('strong, b, code, .pin, .code'));
  for (const el of strongCandidates) {
    const val = (el.textContent ?? '').trim();
    if (/^\d{4}$/.test(val)) return val;
  }
  return undefined;
}

/** Searches canvas, image, and SVG elements in the document for a TOTP QR code and PIN. */
export async function extractGauthFromDocument(
  doc: Document,
  decoder: (
    el: HTMLImageElement | HTMLCanvasElement | SVGSVGElement
  ) => Promise<string | null> = decodeQrFromElement
): Promise<PendingGauthImport | null> {
  const elements = Array.from(doc.querySelectorAll('canvas, img, svg')) as Array<
    HTMLImageElement | HTMLCanvasElement | SVGSVGElement
  >;

  for (const el of elements) {
    try {
      const raw = await decoder(el);
      if (!raw || !raw.trim().toLowerCase().startsWith('otpauth://totp')) continue;
      const parsed = parseOtpAuthUri(raw);
      return {
        totpSecret: parsed.totpSecret,
        issuer: parsed.issuer,
        digits: parsed.digits,
        period: parsed.period,
        algorithm: parsed.algorithm,
        pin4: detectPin4Candidate(doc),
        capturedAt: Date.now()
      };
    } catch {
      // Try next candidate visual element
    }
  }
  return null;
}

/** Renders a non-intrusive floating import banner on gauth.huji.ac.il when a QR is detected. */
export function renderGauthBanner(
  doc: Document,
  lang: Language,
  captured: PendingGauthImport
): void {
  if (doc.getElementById('huji-key-gauth-banner')) return;
  const banner = doc.createElement('div');
  banner.id = 'huji-key-gauth-banner';
  banner.setAttribute('dir', getDirection(lang));
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.setAttribute(
    'style',
    'position:fixed;bottom:20px;inset-inline-end:20px;z-index:2147483647;background:#FFFFFF;border:1px solid #BFDBFE;box-shadow:0 10px 25px rgba(15,23,42,0.14);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:12px;font:500 13px/1.4 system-ui,sans-serif;color:#0F172A;'
  );

  const info = doc.createElement('div');
  const title = doc.createElement('div');
  title.style.fontWeight = '600';
  title.textContent = t(lang, 'gauthBannerFound');
  info.appendChild(title);
  if (captured.pin4) {
    const sub = doc.createElement('div');
    sub.style.color = '#475569';
    sub.textContent = t(lang, 'gauthBannerPinHint', { pin4: captured.pin4 });
    info.appendChild(sub);
  }
  banner.appendChild(info);

  const saveBtn = doc.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = t(lang, 'gauthBannerSaveBtn');
  saveBtn.setAttribute(
    'style',
    'background:#1D4ED8;color:#FFFFFF;border:0;border-radius:8px;padding:7px 12px;font:600 12px/1.2 system-ui,sans-serif;cursor:pointer;'
  );
  saveBtn.addEventListener('click', () => {
    void Promise.resolve(
      ext.runtime.sendMessage({ type: 'OPEN_SETUP_WITH_IMPORT', payload: captured })
    ).catch(() => {});
  });
  banner.appendChild(saveBtn);

  const closeBtn = doc.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', t(lang, 'gauthBannerDismiss'));
  closeBtn.setAttribute(
    'style',
    'background:transparent;color:#64748B;border:0;font:600 18px/1 system-ui,sans-serif;cursor:pointer;padding:0 4px;'
  );
  closeBtn.addEventListener('click', () => banner.remove());
  banner.appendChild(closeBtn);

  doc.body?.appendChild(banner);
}
