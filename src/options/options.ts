import { decryptCredentials, encryptCredentials, isEncryptedEnvelope } from '../core/crypto';
import { applyDocumentLocale, type MessageKey, t } from '../core/i18n';
import { generateTotp, getTotpWindowInfo, parseOtpAuthUri } from '../core/totp';
import type {
  ExtensionSettings,
  Language,
  PendingGauthImport,
  PlainCredentials,
  TotpAlgorithm
} from '../core/types';
import { validateIsraeliId, validatePin4, validateSecret } from '../core/validation';
import { safeSendMessage } from '../shared/browser';
import { decodeQrFromBlob } from '../shared/qr';
import {
  clearAllData,
  getPendingGauthImport,
  getSettings,
  getStoredCredentials,
  getUnlockedCredentials,
  setPendingGauthImport,
  setStoredCredentials,
  setUnlockedCredentials,
  updateSettings
} from '../shared/storage';
import { initAccessibleValidation, initTablist } from '../shared/ui-a11y';

let currentLang: Language = 'en';
let parsedMeta: { issuer: string; digits: number; period: number; algorithm: TotpAlgorithm } = {
  issuer: 'HUJI',
  digits: 6,
  period: 30,
  algorithm: 'SHA-1'
};

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function applyTranslations(lang: Language): void {
  currentLang = lang;
  applyDocumentLocale(document, lang);

  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n as MessageKey;
    node.textContent = t(lang, key);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((node) => {
    const key = node.dataset.i18nAria as MessageKey;
    node.setAttribute('aria-label', t(lang, key));
  });
  document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.lang === lang ? 'true' : 'false');
  });
  el<HTMLInputElement>('otpauth-uri').placeholder = t(lang, 'uriPlaceholder');
}

async function updatePreview(): Promise<void> {
  const secretInput = document.getElementById('input-secret') as HTMLInputElement | null;
  const codeEl = document.getElementById('preview-code');
  const timerEl = document.getElementById('preview-timer');
  if (!secretInput || !codeEl || !timerEl) return;
  const rawSecret = secretInput.value;
  const secretCheck = validateSecret(rawSecret);
  if (!secretCheck.valid) {
    codeEl.textContent = '------';
    timerEl.textContent = '';
    return;
  }
  const info = getTotpWindowInfo(Date.now(), parsedMeta.period);
  const code = await generateTotp({
    secret: secretCheck.normalized,
    digits: parsedMeta.digits,
    period: parsedMeta.period,
    algorithm: parsedMeta.algorithm
  });
  const currentSecret = document.getElementById('input-secret') as HTMLInputElement | null;
  const currentCodeEl = document.getElementById('preview-code');
  const currentTimerEl = document.getElementById('preview-timer');
  if (!currentSecret || !currentCodeEl || !currentTimerEl) return;
  if (currentSecret.value !== rawSecret) return;
  currentCodeEl.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
  currentTimerEl.textContent = t(currentLang, 'secondsLeft', { seconds: info.secondsRemaining });
}

function applyImportedCandidate(
  data: {
    totpSecret: string;
    pin4?: string;
    id9?: string;
    issuer?: string;
    digits?: number;
    period?: number;
    algorithm?: TotpAlgorithm;
  },
  syncField?: (input: HTMLInputElement, announceError?: boolean, forceFlag?: boolean) => void
): void {
  const secretEl = el<HTMLInputElement>('input-secret');
  const pinEl = el<HTMLInputElement>('input-pin4');
  const idEl = el<HTMLInputElement>('input-id9');

  secretEl.value = data.totpSecret;
  secretEl.setCustomValidity('');
  if (secretEl.getAttribute('aria-invalid') === 'true') syncField?.(secretEl, false);

  if (data.pin4) {
    pinEl.value = data.pin4;
    pinEl.setCustomValidity('');
    if (pinEl.getAttribute('aria-invalid') === 'true') syncField?.(pinEl, false);
  }
  if (data.id9) {
    idEl.value = data.id9;
    idEl.setCustomValidity('');
    if (idEl.getAttribute('aria-invalid') === 'true') syncField?.(idEl, false);
    const idCheck = validateIsraeliId(idEl.value);
    el('warn-id9').hidden = !(idCheck.valid && idCheck.checkDigitWarning);
  }

  parsedMeta = {
    issuer: data.issuer ?? 'HUJI',
    digits: data.digits ?? 6,
    period: data.period ?? 30,
    algorithm: data.algorithm ?? 'SHA-1'
  };
  const banner = el('import-banner');
  banner.textContent = t(currentLang, 'importedBanner');
  banner.hidden = false;
  void updatePreview();
}

async function handleQrBlob(
  blob: Blob,
  syncField?: (input: HTMLInputElement, announceError?: boolean, forceFlag?: boolean) => void
): Promise<void> {
  const msg = el('qr-scan-msg');
  msg.textContent = '';
  try {
    const raw = await decodeQrFromBlob(blob);
    if (!raw) {
      msg.textContent = t(currentLang, 'qrInvalidImage');
      return;
    }
    const parsed = parseOtpAuthUri(raw);
    applyImportedCandidate(parsed, syncField);
  } catch {
    msg.textContent = t(currentLang, 'qrInvalidImage');
  }
}

async function loadInitialState(): Promise<void> {
  const settings: ExtensionSettings = await getSettings();
  applyTranslations(settings.language);

  el<HTMLSelectElement>('select-interval').value = String(settings.keepAliveIntervalMin);
  const csToggle = el<HTMLInputElement>('opt-ka-cs');
  csToggle.checked = settings.keepAliveCsMoodle;
  csToggle.setAttribute('aria-checked', csToggle.checked ? 'true' : 'false');

  el('lock-setup-box').hidden = settings.lockEnabled;
  el('lock-disable-box').hidden = !settings.lockEnabled;

  const stored = await getStoredCredentials();
  const active = isEncryptedEnvelope(stored) ? await getUnlockedCredentials() : stored;
  if (active) {
    el<HTMLInputElement>('input-id9').value = active.id9;
    el<HTMLInputElement>('input-pin4').value = active.pin4;
    el<HTMLInputElement>('input-secret').value = active.totpSecret;
    parsedMeta = {
      issuer: active.issuer,
      digits: active.digits,
      period: active.period,
      algorithm: active.algorithm
    };
  }

  const pending = await getPendingGauthImport();
  if (pending) {
    applyImportedCandidate(pending);
    await setPendingGauthImport(null);
  }

  await updatePreview();
}

document.addEventListener('DOMContentLoaded', () => {
  const tablist = document.querySelector<HTMLElement>('[role="tablist"]');
  if (tablist) initTablist(tablist);

  const { syncField, announce } = initAccessibleValidation(document);
  void loadInitialState();
  const previewTimer = setInterval(() => void updatePreview(), 1000);
  window.addEventListener('pagehide', () => clearInterval(previewTimer));

  document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const lang = btn.dataset.lang as Language;
      await updateSettings({ language: lang });
      applyTranslations(lang);
      await updatePreview();
    });
  });

  el('input-id9').addEventListener('input', () => {
    const idEl = el<HTMLInputElement>('input-id9');
    idEl.setCustomValidity('');
    if (idEl.getAttribute('aria-invalid') === 'true') syncField(idEl, false);
  });

  el('input-id9').addEventListener('blur', () => {
    const check = validateIsraeliId(el<HTMLInputElement>('input-id9').value);
    el('warn-id9').hidden = !(check.valid && check.checkDigitWarning);
  });

  el('input-pin4').addEventListener('input', () => {
    const pinEl = el<HTMLInputElement>('input-pin4');
    pinEl.setCustomValidity('');
    if (pinEl.getAttribute('aria-invalid') === 'true') syncField(pinEl, false);
  });

  el('input-secret').addEventListener('input', () => {
    const secretEl = el<HTMLInputElement>('input-secret');
    const res = validateSecret(secretEl.value);
    secretEl.setCustomValidity(res.valid ? '' : t(currentLang, 'secretInputError'));
    if (secretEl.getAttribute('aria-invalid') === 'true') syncField(secretEl, false);
    void updatePreview();
  });

  el('btn-scan-gauth').addEventListener('click', async () => {
    const msg = el('gauth-scan-msg');
    msg.textContent = '';
    const res = await safeSendMessage<PendingGauthImport>({
      type: 'CAPTURE_OPEN_GAUTH'
    });
    if (!res?.ok) {
      msg.textContent =
        res?.error === 'no_gauth_tab'
          ? t(currentLang, 'captureNoGauthTab')
          : t(currentLang, 'captureNoQrFound');
      return;
    }
    applyImportedCandidate(res.data, syncField);
  });

  const fileInput = el<HTMLInputElement>('qr-file-input');
  el('btn-qr-file').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      await handleQrBlob(file, syncField);
    } finally {
      (el('qr-file-input') as HTMLInputElement).value = '';
    }
  });

  const dropzone = el('qr-dropzone');
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleQrBlob(file, syncField);
  });
  document.addEventListener('paste', (e) => {
    const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
    const blob = item?.getAsFile();
    if (blob) void handleQrBlob(blob, syncField);
  });

  el('btn-parse-uri').addEventListener('click', () => {
    const msg = el('uri-msg');
    msg.textContent = '';
    try {
      const parsed = parseOtpAuthUri(el<HTMLInputElement>('otpauth-uri').value);
      applyImportedCandidate(parsed, syncField);
    } catch {
      msg.textContent = t(currentLang, 'uriInvalid');
    }
  });

  el('credentials-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBanner = el('save-banner');
    const saveError = el('save-error');
    saveBanner.hidden = true;
    saveError.hidden = true;
    saveError.textContent = '';

    const idEl = el<HTMLInputElement>('input-id9');
    const pinEl = el<HTMLInputElement>('input-pin4');
    const secretEl = el<HTMLInputElement>('input-secret');

    const idCheck = validateIsraeliId(idEl.value);
    const pinCheck = validatePin4(pinEl.value);
    const secretCheck = validateSecret(secretEl.value);

    if (idCheck.valid) idEl.value = idCheck.normalized;
    if (pinCheck.valid) pinEl.value = pinCheck.normalized;

    idEl.setCustomValidity(idCheck.valid ? '' : t(currentLang, 'idInputError'));
    pinEl.setCustomValidity(pinCheck.valid ? '' : t(currentLang, 'pinInputError'));
    secretEl.setCustomValidity(secretCheck.valid ? '' : t(currentLang, 'secretInputError'));

    syncField(idEl, false, true);
    syncField(pinEl, false, true);
    syncField(secretEl, false, true);

    const firstInvalid = [idEl, pinEl, secretEl].find((f) => !f.validity.valid);
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const creds: PlainCredentials = {
      id9: idCheck.normalized,
      pin4: pinCheck.normalized,
      totpSecret: secretCheck.normalized,
      ...parsedMeta
    };

    const settings = await getSettings();
    if (settings.lockEnabled) {
      const currentPass = prompt(t(currentLang, 'passphraseLabel')) || '';
      if (!currentPass) {
        saveError.textContent = t(currentLang, 'wrongPassphrase');
        saveError.hidden = false;
        announce(saveError.textContent);
        return;
      }
      const existing = await getStoredCredentials();
      if (existing && isEncryptedEnvelope(existing)) {
        try {
          await decryptCredentials(existing, currentPass);
        } catch {
          saveError.textContent = t(currentLang, 'wrongPassphrase');
          saveError.hidden = false;
          announce(saveError.textContent);
          return;
        }
      }
      await setStoredCredentials(await encryptCredentials(creds, currentPass));
      await setUnlockedCredentials(creds);
    } else {
      await setStoredCredentials(creds);
    }

    saveBanner.textContent = t(currentLang, 'savedBanner');
    saveBanner.hidden = false;
    announce(saveBanner.textContent);
  });

  el('btn-enable-lock').addEventListener('click', async () => {
    const p1Input = el<HTMLInputElement>('lock-pass-1');
    const p2Input = el<HTMLInputElement>('lock-pass-2');
    const p1 = p1Input.value;
    const p2 = p2Input.value;
    const msg = el('lock-msg');
    if (p1.length < 4) {
      msg.textContent = t(currentLang, 'passphraseTooShort');
      return;
    }
    if (p1 !== p2) {
      msg.textContent = t(currentLang, 'passphraseMismatch');
      return;
    }
    const stored = await getStoredCredentials();
    if (stored && !isEncryptedEnvelope(stored)) {
      await setStoredCredentials(await encryptCredentials(stored, p1));
      await setUnlockedCredentials(stored);
    }
    await updateSettings({ lockEnabled: true });
    p1Input.value = '';
    p2Input.value = '';
    el('lock-setup-box').hidden = true;
    el('lock-disable-box').hidden = false;
    msg.textContent = t(currentLang, 'lockUpdated');
  });

  el('btn-disable-lock').addEventListener('click', async () => {
    const passInput = el<HTMLInputElement>('lock-pass-remove');
    const pass = passInput.value;
    const msg = el('lock-msg');
    const stored = await getStoredCredentials();
    try {
      if (stored && isEncryptedEnvelope(stored)) {
        const plain = await decryptCredentials(stored, pass);
        await setStoredCredentials(plain);
        await setUnlockedCredentials(null);
      }
      await updateSettings({ lockEnabled: false });
      passInput.value = '';
      el('lock-setup-box').hidden = false;
      el('lock-disable-box').hidden = true;
      msg.textContent = t(currentLang, 'lockUpdated');
    } catch {
      msg.textContent = t(currentLang, 'wrongPassphrase');
    }
  });

  el<HTMLSelectElement>('select-interval').addEventListener('change', async (e) => {
    const val = Number((e.currentTarget as HTMLSelectElement).value) as 10 | 15 | 20;
    await updateSettings({ keepAliveIntervalMin: val });
    await safeSendMessage({ type: 'UPDATE_KEEPALIVE_ALARM' });
  });

  el<HTMLInputElement>('opt-ka-cs').addEventListener('change', async (e) => {
    const sw = e.currentTarget as HTMLInputElement;
    sw.setAttribute('aria-checked', sw.checked ? 'true' : 'false');
    await updateSettings({ keepAliveCsMoodle: sw.checked });
    await safeSendMessage({ type: 'UPDATE_KEEPALIVE_ALARM' });
  });

  el('btn-reset-guard').addEventListener('click', async () => {
    const res = await safeSendMessage({ type: 'RESET_LOGIN_GUARD' });
    if (res?.ok) {
      el('safety-msg').textContent = t(currentLang, 'guardResetDone');
    }
  });

  const wipeDialog = el<HTMLDialogElement>('wipe-dialog');
  el('btn-open-wipe').addEventListener('click', () => wipeDialog.showModal());
  el('btn-cancel-wipe').addEventListener('click', () => wipeDialog.close());
  el('btn-confirm-wipe').addEventListener('click', async () => {
    await clearAllData();
    const idEl = el<HTMLInputElement>('input-id9');
    const pinEl = el<HTMLInputElement>('input-pin4');
    const secretEl = el<HTMLInputElement>('input-secret');
    for (const input of [idEl, pinEl, secretEl]) {
      input.setCustomValidity('');
    }
    (el('credentials-form') as HTMLFormElement).reset();
    el('warn-id9').hidden = true;
    el('import-banner').hidden = true;
    el('save-banner').hidden = true;
    const saveError = el('save-error');
    saveError.hidden = true;
    saveError.textContent = '';
    parsedMeta = { issuer: 'HUJI', digits: 6, period: 30, algorithm: 'SHA-1' };
    await updatePreview();
    wipeDialog.close();
    await loadInitialState();
    el('wipe-msg').textContent = t(currentLang, 'wipedDone');
  });
});
