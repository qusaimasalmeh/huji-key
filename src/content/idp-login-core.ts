import { getDirection, t } from '../core/i18n';
import {
  evaluateAutoSubmitGuard,
  extractAuthStateKey,
  recordAutoSubmitAttempt,
  resetAutoSubmitGuard
} from '../core/loop-guard';
import { generateTotp, getTotpWindowInfo } from '../core/totp';
import type { CredentialAvailability, Language, PlainCredentials } from '../core/types';
import { formatCombinedOtp } from '../core/validation';
import { safeSendMessage } from '../shared/browser';
import { getLoginGuard, getSettings, setLoginGuard } from '../shared/storage';

let inFlight = false;

/** Returns true when the SimpleSAML IdP login page displays a non-empty error alert. */
export function hasIdpPageError(doc: Document): boolean {
  const alerts = doc.querySelectorAll(
    '#hujicc-tabContent .alert-danger, #hujicc-tabContent .alert-warning, #hujicc-tabContent [role="alert"], .error-message'
  );
  return Array.from(alerts).some((el) => (el.textContent ?? '').trim().length > 0);
}

/** Switches the HUJI IdP form to the "With OTP" tab if it is not currently active. */
export function ensureOtpTabActive(doc: Document): void {
  const otpTab = doc.getElementById('hujicc-otp-tab');
  const otpPane = doc.getElementById('hujicc-otp');
  if (!otpTab || !otpPane) return;

  const isSelected =
    otpTab.getAttribute('aria-selected') === 'true' && otpPane.classList.contains('active');
  if (isSelected) return;

  otpTab.click();
  // Fallback in case Bootstrap JS isn't attached (e.g. unit DOM or delayed load)
  const smsTab = doc.getElementById('hujicc-sms-tab');
  const smsPane = doc.getElementById('hujicc-sms');
  smsTab?.classList.remove('active', 'show');
  smsTab?.setAttribute('aria-selected', 'false');
  smsPane?.classList.remove('active', 'show');
  otpTab.classList.add('active', 'show');
  otpTab.setAttribute('aria-selected', 'true');
  otpPane.classList.add('active', 'show');
}

/** Populates the IdP 9-digit ID and combined PIN+TOTP inputs and dispatches input/change events. */
export function fillIdpForm(doc: Document, id9: string, combinedOtp: string): boolean {
  const idInput = doc.getElementById('hujicc-otp-username') as HTMLInputElement | null;
  const otpInput = doc.getElementById('hujicc-otp-password') as HTMLInputElement | null;
  if (!idInput || !otpInput) return false;

  const EventCtor = doc.defaultView?.Event ?? Event;

  idInput.value = id9;
  idInput.dispatchEvent(new EventCtor('input', { bubbles: true }));
  idInput.dispatchEvent(new EventCtor('change', { bubbles: true }));

  otpInput.value = combinedOtp;
  otpInput.dispatchEvent(new EventCtor('input', { bubbles: true }));
  otpInput.dispatchEvent(new EventCtor('change', { bubbles: true }));
  return true;
}

function renderStatusPill(
  doc: Document,
  lang: Language,
  text: string,
  tone: 'info' | 'warn' | 'muted',
  action?: { label: string; onClick: (btn: HTMLButtonElement) => void }
): void {
  const form = doc.getElementById('hujicc-form-otp');
  if (!form) return;

  let pill = doc.getElementById('huji-key-pill');
  if (!pill) {
    pill = doc.createElement('div');
    pill.id = 'huji-key-pill';
    form.prepend(pill);
  }

  const palette =
    tone === 'warn'
      ? 'background:#FEF3C7;border-color:#F59E0B;color:#92400E;'
      : tone === 'muted'
        ? 'background:#F1F5F9;border-color:#CBD5E1;color:#334155;'
        : 'background:#EFF6FF;border-color:#BFDBFE;color:#1E3A8A;';

  pill.setAttribute('dir', getDirection(lang));
  pill.setAttribute(
    'style',
    `display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;margin-bottom:12px;border:1px solid;border-radius:8px;font:500 13px/1.4 system-ui,sans-serif;${palette}`
  );

  const span = doc.createElement('span');
  span.textContent = text;
  const children: HTMLElement[] = [span];

  if (action) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.setAttribute(
      'style',
      'border:1px solid currentColor;background:#FFFFFF;color:inherit;border-radius:6px;padding:3px 10px;font:600 12px/1.3 system-ui,sans-serif;cursor:pointer;white-space:nowrap;'
    );
    btn.addEventListener('click', () => action.onClick(btn));
    children.push(btn);
  }

  pill.replaceChildren(...children);
}

async function waitForSubmitButtonReady(
  doc: Document,
  maxWaitMs: number
): Promise<HTMLButtonElement | null> {
  const btn = doc.getElementById('hujicc-captcha-btn-otp') as HTMLButtonElement | null;
  if (!btn) return null;
  if (maxWaitMs <= 0) return btn.disabled ? null : btn;

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const form = doc.getElementById('hujicc-form-otp');
    const hasRecaptchaScript = Boolean(doc.querySelector('script[src*="recaptcha"]'));
    const recaptchaIframe = form?.querySelector('iframe[src*="recaptcha"]');
    if (!btn.disabled && (!hasRecaptchaScript || recaptchaIframe)) {
      return btn;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return btn.disabled ? null : btn;
}

/** Runs the HUJI IdP auto-fill and loop-guarded auto-submit workflow on the current document. */
export async function runIdpAutoLogin(
  doc: Document,
  opts: { nowMs?: number; recaptchaWaitMs?: number; forceRetry?: boolean } = {}
): Promise<void> {
  if (!doc.getElementById('hujicc-form-otp')) return;
  if (inFlight) return;

  inFlight = true;
  try {
    const settings = await getSettings();
    if (!settings.autoFill && !opts.forceRetry) return;

    ensureOtpTabActive(doc);

    const res = await safeSendMessage<CredentialAvailability>({
      type: 'GET_CREDENTIALS_STATUS'
    });

    if (!res?.ok) return;

    if (res.data.status === 'unconfigured') {
      renderStatusPill(doc, settings.language, t(settings.language, 'idpBadgeUnconfigured'), 'muted', {
        label: t(settings.language, 'idpOpenSetupBtn'),
        onClick: () => {
          void safeSendMessage({ type: 'OPEN_OPTIONS' });
        }
      });
      return;
    }

    if (res.data.status === 'locked') {
      renderStatusPill(doc, settings.language, t(settings.language, 'idpBadgeLocked'), 'warn');
      return;
    }

    const creds: PlainCredentials = res.data.credentials;
    let nowMs = opts.nowMs ?? Date.now();
    let win = getTotpWindowInfo(nowMs, creds.period);

    if (settings.autoSubmit && win.secondsRemaining < 3 && opts.nowMs === undefined) {
      renderStatusPill(
        doc,
        settings.language,
        t(settings.language, 'idpBadgeWaitingFresh', { seconds: win.secondsRemaining }),
        'info'
      );
      await new Promise((r) => setTimeout(r, win.secondsRemaining * 1000 + 150));
      nowMs = Date.now();
      win = getTotpWindowInfo(nowMs, creds.period);
    }

    const totp = await generateTotp({
      secret: creds.totpSecret,
      timestampMs: nowMs,
      digits: creds.digits,
      period: creds.period,
      algorithm: creds.algorithm
    });

    fillIdpForm(doc, creds.id9, formatCombinedOtp(creds.pin4, totp));

    const authStateKey = extractAuthStateKey(doc.location?.href ?? '');
    const guard = opts.forceRetry ? resetAutoSubmitGuard() : await getLoginGuard();
    const verdict = evaluateAutoSubmitGuard({
      guard,
      hasPageError: opts.forceRetry ? false : hasIdpPageError(doc),
      authStateKey,
      nowMs
    });

    if (!settings.autoSubmit) {
      renderStatusPill(
        doc,
        settings.language,
        t(settings.language, 'idpBadgeFilled', { seconds: win.secondsRemaining }),
        'info'
      );
      return;
    }

    if (!verdict.allowed) {
      renderStatusPill(doc, settings.language, t(settings.language, 'idpBadgePaused'), 'warn', {
        label: t(settings.language, 'idpRetryBtn'),
        onClick: (btn) => {
          btn.disabled = true;
          void runIdpAutoLogin(doc, {
            forceRetry: true,
            recaptchaWaitMs: opts.recaptchaWaitMs
          }).finally(() => {
            if (btn.isConnected) btn.disabled = false;
          });
        }
      });
      return;
    }

    await setLoginGuard(recordAutoSubmitAttempt(guard, authStateKey, nowMs));
    renderStatusPill(doc, settings.language, t(settings.language, 'idpBadgeSubmitting'), 'info');

    const submitBtn = await waitForSubmitButtonReady(doc, opts.recaptchaWaitMs ?? 1500);
    if (!submitBtn) {
      const remaining =
        opts.nowMs === undefined
          ? getTotpWindowInfo(Date.now(), creds.period).secondsRemaining
          : win.secondsRemaining;
      renderStatusPill(
        doc,
        settings.language,
        t(settings.language, 'idpBadgeFilled', { seconds: remaining }),
        'info'
      );
      return;
    }
    submitBtn.click();
  } catch {
    // Ignore transient worker teardown or storage errors in content script
  } finally {
    inFlight = false;
  }
}
