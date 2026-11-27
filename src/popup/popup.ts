import { applyDocumentLocale, type MessageKey, t } from '../core/i18n';
import { generateTotp, getTotpWindowInfo } from '../core/totp';
import { formatCombinedOtp } from '../core/validation';
import type {
  CredentialAvailability,
  ExtensionSettings,
  KeepAliveSiteState,
  Language,
  PendingGauthImport,
  PlainCredentials,
  RuntimeMessage,
  RuntimeResponse
} from '../core/types';
import { ext } from '../shared/browser';
import {
  DEFAULT_SETTINGS,
  getKeepAliveStates,
  getSettings,
  updateSettings
} from '../shared/storage';

let currentLang: Language = 'en';
let activeCreds: PlainCredentials | null = null;
let currentSettings: ExtensionSettings = DEFAULT_SETTINGS;
let lastRenderedCode = '';
let tickTimer: ReturnType<typeof setInterval> | undefined;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

async function safeSendMessage<T>(msg: RuntimeMessage): Promise<RuntimeResponse<T> | undefined> {
  try {
    return (await ext.runtime.sendMessage(msg)) as RuntimeResponse<T> | undefined;
  } catch {
    return undefined;
  }
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
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((node) => {
    const key = node.dataset.i18nTitle as MessageKey;
    node.title = t(lang, key);
  });
  document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.lang === lang ? 'true' : 'false');
  });
}

function formatAge(ts: number): string {
  const mins = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  return `${mins}m`;
}

function renderSiteStatus(targetId: string, state: KeepAliveSiteState): void {
  const node = el<HTMLElement>(targetId);
  const statusMap: Record<KeepAliveSiteState['status'], MessageKey> = {
    ok: 'statusOk',
    logged_out: 'statusLoggedOut',
    paused: 'statusPaused',
    error: 'statusError',
    never: 'statusNever'
  };
  let text = t(currentLang, statusMap[state.status]);
  if (state.status === 'ok' && state.lastPingAt) {
    text = `${text} · ${t(currentLang, 'lastRefreshed', { time: formatAge(state.lastPingAt) })}`;
  }
  node.textContent = text;
  node.dataset.tone =
    state.status === 'ok' ? 'ok' : state.status === 'error' ? 'error' : state.status === 'logged_out' ? 'warn' : 'muted';
}

async function updateLiveOtp(): Promise<void> {
  if (!activeCreds) return;
  const info = getTotpWindowInfo(Date.now(), activeCreds.period);
  const code = await generateTotp({
    secret: activeCreds.totpSecret,
    digits: activeCreds.digits,
    period: activeCreds.period,
    algorithm: activeCreds.algorithm
  });
  const codeEl = document.getElementById('live-otp-code');
  const secEl = document.getElementById('ring-seconds');
  const ringEl = document.getElementById('ring-progress');
  if (!codeEl || !secEl || !ringEl) return;
  lastRenderedCode = code;
  codeEl.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
  secEl.textContent = t(currentLang, 'secondsLeft', { seconds: info.secondsRemaining });
  const circumference = 2 * Math.PI * 15;
  ringEl.setAttribute('stroke-dashoffset', String(circumference * info.progress));
}

function showAvailability(avail: CredentialAvailability): void {
  el('view-unconfigured').hidden = avail.status !== 'unconfigured';
  el('view-locked').hidden = avail.status !== 'locked';
  el('view-otp').hidden = avail.status !== 'ready';

  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = undefined;
  }

  if (avail.status === 'ready') {
    activeCreds = avail.credentials;
    el('meta-id').textContent = t(currentLang, 'idSummary', { id9: activeCreds.id9 });
    el('meta-pin').textContent = t(currentLang, 'pinSummary', { pin4: activeCreds.pin4 });
    el('btn-lock-now').hidden = !currentSettings.lockEnabled;
    void updateLiveOtp();
    tickTimer = setInterval(() => void updateLiveOtp(), 500);
  } else {
    activeCreds = null;
  }
}

async function refreshAll(): Promise<void> {
  currentSettings = await getSettings();
  applyTranslations(currentSettings.language);

  const autofillEl = el<HTMLInputElement>('toggle-autofill');
  const autosubmitEl = el<HTMLInputElement>('toggle-autosubmit');
  const kaMoodleEl = el<HTMLInputElement>('toggle-ka-moodle');
  const kaCsEl = el<HTMLInputElement>('toggle-ka-cs');

  autofillEl.checked = currentSettings.autoFill;
  autosubmitEl.checked = currentSettings.autoSubmit;
  kaMoodleEl.checked = currentSettings.keepAliveMoodle;
  kaCsEl.checked = currentSettings.keepAliveCsMoodle;
  for (const sw of [autofillEl, autosubmitEl, kaMoodleEl, kaCsEl]) {
    sw.setAttribute('aria-checked', sw.checked ? 'true' : 'false');
  }

  const states = await getKeepAliveStates();
  renderSiteStatus('status-moodle', states.moodle);
  renderSiteStatus('status-cs', states.csMoodle);

  const statusRes = await safeSendMessage<CredentialAvailability>({
    type: 'GET_CREDENTIALS_STATUS'
  });
  if (statusRes?.ok) showAvailability(statusRes.data);
}

async function copyWithFeedback(btnId: string, text: string): Promise<void> {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  const btn = el<HTMLButtonElement>(btnId);
  const key = btn.dataset.i18n as MessageKey;
  btn.textContent = t(currentLang, 'copied');
  setTimeout(() => {
    btn.textContent = t(currentLang, key);
  }, 1200);
}

document.addEventListener('DOMContentLoaded', () => {
  void refreshAll();

  document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const lang = btn.dataset.lang as Language;
      await updateSettings({ language: lang });
      await refreshAll();
    });
  });

  el('open-options-btn').addEventListener('click', () => ext.runtime.openOptionsPage());
  el('btn-setup').addEventListener('click', () => ext.runtime.openOptionsPage());

  el('btn-capture-gauth').addEventListener('click', async () => {
    const feedback = el('gauth-feedback');
    feedback.textContent = '';
    const res = await safeSendMessage<PendingGauthImport>({
      type: 'CAPTURE_OPEN_GAUTH'
    });
    if (!res?.ok) {
      feedback.textContent =
        res?.error === 'no_gauth_tab'
          ? t(currentLang, 'captureNoGauthTab')
          : t(currentLang, 'captureNoQrFound');
      return;
    }
    await safeSendMessage({
      type: 'OPEN_SETUP_WITH_IMPORT',
      payload: res.data
    });
  });

  el('unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const passInput = el<HTMLInputElement>('unlock-passphrase');
    const pass = passInput.value;
    const errEl = el('unlock-error');
    errEl.hidden = true;
    const res = await safeSendMessage<CredentialAvailability>({
      type: 'UNLOCK_CREDENTIALS',
      passphrase: pass
    });
    if (!res?.ok) {
      errEl.textContent = t(currentLang, 'wrongPassphrase');
      errEl.hidden = false;
      return;
    }
    passInput.value = '';
    showAvailability(res.data);
  });

  el('btn-lock-now').addEventListener('click', async () => {
    await ext.runtime.sendMessage({ type: 'LOCK_CREDENTIALS' });
    await refreshAll();
  });

  el('btn-copy-6').addEventListener('click', () => copyWithFeedback('btn-copy-6', lastRenderedCode));
  el('btn-copy-full').addEventListener('click', () => {
    if (!activeCreds || !lastRenderedCode) return;
    void copyWithFeedback('btn-copy-full', formatCombinedOtp(activeCreds.pin4, lastRenderedCode));
  });

  const bindSwitch = (
    id: string,
    key: 'autoFill' | 'autoSubmit' | 'keepAliveMoodle' | 'keepAliveCsMoodle',
    updateAlarm = false
  ) => {
    el<HTMLInputElement>(id).addEventListener('change', async (e) => {
      const target = e.currentTarget as HTMLInputElement;
      target.setAttribute('aria-checked', target.checked ? 'true' : 'false');
      await updateSettings({ [key]: target.checked });
      if (updateAlarm) await ext.runtime.sendMessage({ type: 'UPDATE_KEEPALIVE_ALARM' });
    });
  };

  bindSwitch('toggle-autofill', 'autoFill');
  bindSwitch('toggle-autosubmit', 'autoSubmit');
  bindSwitch('toggle-ka-moodle', 'keepAliveMoodle', true);
  bindSwitch('toggle-ka-cs', 'keepAliveCsMoodle', true);

  el('btn-ping-now').addEventListener('click', async () => {
    await ext.runtime.sendMessage({ type: 'PING_KEEPALIVE_NOW' });
    await refreshAll();
  });

  el('btn-open-moodle').addEventListener('click', () => {
    void ext.tabs.create({ url: 'https://moodle.huji.ac.il/' });
  });

  window.addEventListener('pagehide', () => {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
    activeCreds = null;
  });
});
