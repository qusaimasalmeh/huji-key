import { decryptCredentials, isEncryptedEnvelope } from '../core/crypto';
import {
  classifyKeepAliveResult,
  SITE_ORIGINS,
  siteKeyFromOrigin
} from '../core/keepalive';
import { resetAutoSubmitGuard } from '../core/loop-guard';
import type {
  CredentialAvailability,
  KeepAliveSiteState,
  KeepAliveStates,
  RuntimeMessage,
  RuntimeResponse,
  SiteKey
} from '../core/types';
import { ext } from '../shared/browser';
import {
  getKeepAliveStates,
  getSettings,
  getStoredCredentials,
  getUnlockedCredentials,
  setLoginGuard,
  setPendingGauthImport,
  setUnlockedCredentials,
  updateKeepAliveSiteState
} from '../shared/storage';

export const KEEPALIVE_ALARM_NAME = 'huji-moodle-keepalive';

function formatErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message || err.name || fallback : fallback;
}

export async function syncKeepAliveAlarm(): Promise<void> {
  const settings = await getSettings();
  if (!settings.keepAliveMoodle && !settings.keepAliveCsMoodle) {
    await ext.alarms.clear(KEEPALIVE_ALARM_NAME);
    return;
  }
  await ext.alarms.create(KEEPALIVE_ALARM_NAME, {
    periodInMinutes: settings.keepAliveIntervalMin
  });
}

async function resolveCredentialsStatus(): Promise<CredentialAvailability> {
  const stored = await getStoredCredentials();
  if (!stored) return { status: 'unconfigured' };
  if (isEncryptedEnvelope(stored)) {
    const unlocked = await getUnlockedCredentials();
    if (!unlocked) return { status: 'locked' };
    return { status: 'ready', credentials: unlocked };
  }
  return { status: 'ready', credentials: stored };
}

export async function pingMoodleSite(
  site: SiteKey,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
): Promise<KeepAliveSiteState> {
  const origin = SITE_ORIGINS[site];
  const current = (await getKeepAliveStates())[site];

  try {
    if (current.sesskey) {
      const ajaxRes = await fetchImpl(
        `${origin}/lib/ajax/service.php?sesskey=${encodeURIComponent(current.sesskey)}&info=core_session_touch`,
        {
          method: 'POST',
          credentials: 'include',
          redirect: 'manual',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{ index: 0, methodname: 'core_session_touch', args: {} }])
        }
      );

      let rawText = '';
      let jsonPayload: unknown;
      if (ajaxRes.status >= 200 && ajaxRes.status < 300) {
        rawText = await ajaxRes.text();
        try {
          jsonPayload = JSON.parse(rawText);
        } catch {
          jsonPayload = undefined;
        }
      }
      const verdict = classifyKeepAliveResult({
        status: ajaxRes.status,
        type: ajaxRes.type,
        redirected: ajaxRes.redirected,
        url: ajaxRes.url,
        bodyText: rawText,
        jsonPayload,
        expectJson: true
      });

      if (verdict.outcome === 'ok') {
        const next = await updateKeepAliveSiteState(site, {
          status: 'ok',
          lastPingAt: Date.now(),
          lastError: undefined
        });
        return next[site];
      }

      if (verdict.outcome === 'logged_out') {
        const next = await updateKeepAliveSiteState(site, {
          status: 'logged_out',
          sesskey: undefined,
          lastError: verdict.reason
        });
        return next[site];
      }
    }

    const pageRes = await fetchImpl(`${origin}/my/`, {
      method: 'GET',
      credentials: 'include',
      redirect: 'manual'
    });
    const bodyText =
      pageRes.status >= 200 && pageRes.status < 300 ? await pageRes.text() : '';
    const verdict = classifyKeepAliveResult({
      status: pageRes.status,
      type: pageRes.type,
      redirected: pageRes.redirected,
      url: pageRes.url,
      bodyText
    });

    if (verdict.outcome === 'ok') {
      const next = await updateKeepAliveSiteState(site, {
        status: 'ok',
        lastPingAt: Date.now(),
        sesskey: verdict.sesskey ?? current.sesskey,
        lastError: undefined
      });
      return next[site];
    }

    if (verdict.outcome === 'logged_out') {
      const next = await updateKeepAliveSiteState(site, {
        status: 'logged_out',
        sesskey: undefined,
        lastError: verdict.reason
      });
      return next[site];
    }

    const next = await updateKeepAliveSiteState(site, {
      status: 'error',
      lastError: verdict.reason
    });
    return next[site];
  } catch (err) {
    const next = await updateKeepAliveSiteState(site, {
      status: 'error',
      lastError: formatErrorMessage(err, 'network_error')
    });
    return next[site];
  }
}

export async function runKeepAliveTick(
  targetSite?: SiteKey,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  force = Boolean(targetSite)
): Promise<KeepAliveStates> {
  const settings = await getSettings();
  const states = await getKeepAliveStates();
  const candidates: SiteKey[] = targetSite
    ? [targetSite]
    : (['moodle', 'csMoodle'] as SiteKey[]);

  for (const site of candidates) {
    const enabled = site === 'moodle' ? settings.keepAliveMoodle : settings.keepAliveCsMoodle;
    if (!enabled) continue;
    // Skip background pings once logged out unless explicitly triggered by user
    if (!force && states[site].status === 'logged_out') continue;
    await pingMoodleSite(site, fetchImpl);
  }
  return getKeepAliveStates();
}

export async function handleRuntimeMessage(msg: RuntimeMessage): Promise<RuntimeResponse> {
  try {
    switch (msg.type) {
      case 'GET_CREDENTIALS_STATUS': {
        return { ok: true, data: await resolveCredentialsStatus() };
      }
      case 'UNLOCK_CREDENTIALS': {
        const stored = await getStoredCredentials();
        if (!stored) return { ok: false, error: 'unconfigured' };
        if (!isEncryptedEnvelope(stored)) {
          return { ok: true, data: { status: 'ready', credentials: stored } };
        }
        const decrypted = await decryptCredentials(stored, msg.passphrase);
        await setUnlockedCredentials(decrypted);
        return { ok: true, data: { status: 'ready', credentials: decrypted } };
      }
      case 'LOCK_CREDENTIALS': {
        await setUnlockedCredentials(null);
        return { ok: true, data: { status: 'locked' } };
      }
      case 'OPEN_SETUP_WITH_IMPORT': {
        await setPendingGauthImport(msg.payload);
        await ext.runtime.openOptionsPage();
        return { ok: true, data: true };
      }
      case 'REPORT_MOODLE_SESSION': {
        const site = siteKeyFromOrigin(msg.origin);
        if (!site) return { ok: true, data: false };
        if (msg.loggedIn) {
          await updateKeepAliveSiteState(site, {
            status: 'ok',
            lastLoggedInAt: Date.now(),
            sesskey: msg.sesskey,
            lastError: undefined
          });
        } else {
          await updateKeepAliveSiteState(site, {
            status: 'logged_out',
            sesskey: undefined,
            lastError: undefined
          });
        }
        return { ok: true, data: true };
      }
      case 'PING_KEEPALIVE_NOW': {
        const states = await runKeepAliveTick(msg.site, undefined, true);
        return { ok: true, data: states };
      }
      case 'CAPTURE_OPEN_GAUTH': {
        const tabs = await ext.tabs.query({ url: 'https://gauth.huji.ac.il/*' });
        const tab = tabs[0];
        if (!tab?.id) return { ok: false, error: 'no_gauth_tab' };
        const result = (await ext.tabs.sendMessage(tab.id, {
          type: 'EXTRACT_GAUTH_FROM_PAGE'
        })) as RuntimeResponse | undefined;
        if (!result || typeof result !== 'object' || typeof (result as RuntimeResponse).ok !== 'boolean') {
          return { ok: false, error: 'no_qr_found' };
        }
        return result;
      }
      case 'RESET_LOGIN_GUARD': {
        await setLoginGuard(resetAutoSubmitGuard());
        return { ok: true, data: true };
      }
      case 'UPDATE_KEEPALIVE_ALARM': {
        await syncKeepAliveAlarm();
        return { ok: true, data: true };
      }
      case 'OPEN_OPTIONS': {
        await ext.runtime.openOptionsPage();
        return { ok: true, data: true };
      }
      default:
        return { ok: false, error: 'unknown_message' };
    }
  } catch (err) {
    return { ok: false, error: formatErrorMessage(err, 'internal_error') };
  }
}
