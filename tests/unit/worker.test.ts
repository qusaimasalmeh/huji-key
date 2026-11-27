import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptCredentials } from '../../src/core/crypto';
import type { PlainCredentials, RuntimeMessage } from '../../src/core/types';
import {
  handleRuntimeMessage,
  KEEPALIVE_ALARM_NAME,
  pingMoodleSite,
  runKeepAliveTick,
  syncKeepAliveAlarm
} from '../../src/background/worker-core';
import {
  getKeepAliveStates,
  getLoginGuard,
  getPendingGauthImport,
  setLoginGuard,
  setStoredCredentials,
  updateKeepAliveSiteState,
  updateSettings
} from '../../src/shared/storage';

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

const CREDS: PlainCredentials = {
  id9: '000000018',
  pin4: '0429',
  totpSecret: 'JBSWY3DPEHPK3PXP',
  issuer: 'HUJI',
  digits: 6,
  period: 30,
  algorithm: 'SHA-1'
};

describe('background worker core', () => {
  const alarmsCreated: Array<{ name: string; info: unknown }> = [];
  const alarmsCleared: string[] = [];
  const openOptionsPage = vi.fn(async () => {});
  const tabsQuery = vi.fn(async () => [] as Array<{ id?: number }>);
  const tabsSendMessage = vi.fn(async () => ({}) as unknown);

  let installedListeners: Array<() => void> = [];
  let startupListeners: Array<() => void> = [];
  let alarmListeners: Array<(alarm: { name: string }) => void> = [];
  let messageListeners: Array<
    (
      msg: RuntimeMessage,
      sender: unknown,
      sendResponse: (res: unknown) => void
    ) => boolean | void
  > = [];

  beforeEach(() => {
    alarmsCreated.length = 0;
    alarmsCleared.length = 0;
    openOptionsPage.mockClear();
    tabsQuery.mockReset().mockResolvedValue([]);
    tabsSendMessage.mockReset().mockResolvedValue({});
    installedListeners = [];
    startupListeners = [];
    alarmListeners = [];
    messageListeners = [];

    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: makeMemoryStorage(), session: makeMemoryStorage() },
      alarms: {
        create: async (name: string, info: unknown) => alarmsCreated.push({ name, info }),
        clear: async (name: string) => {
          alarmsCleared.push(name);
          return true;
        },
        onAlarm: {
          addListener: (fn: (alarm: { name: string }) => void) => {
            alarmListeners.push(fn);
          }
        }
      },
      runtime: {
        openOptionsPage,
        onInstalled: {
          addListener: (fn: () => void) => {
            installedListeners.push(fn);
          }
        },
        onStartup: {
          addListener: (fn: () => void) => {
            startupListeners.push(fn);
          }
        },
        onMessage: {
          addListener: (
            fn: (
              msg: RuntimeMessage,
              sender: unknown,
              sendResponse: (res: unknown) => void
            ) => boolean | void
          ) => {
            messageListeners.push(fn);
          }
        }
      },
      tabs: {
        query: tabsQuery,
        sendMessage: tabsSendMessage
      }
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unlocks encrypted credentials into session storage and locks back', async () => {
    const envelope = await encryptCredentials(CREDS, 'secret-123');
    await setStoredCredentials(envelope);
    await updateSettings({ lockEnabled: true });

    const locked = await handleRuntimeMessage({ type: 'GET_CREDENTIALS_STATUS' });
    expect(locked).toEqual({ ok: true, data: { status: 'locked' } });

    const unlocked = await handleRuntimeMessage({
      type: 'UNLOCK_CREDENTIALS',
      passphrase: 'secret-123'
    });
    expect(unlocked).toEqual({ ok: true, data: { status: 'ready', credentials: CREDS } });

    await handleRuntimeMessage({ type: 'LOCK_CREDENTIALS' });
    const relocked = await handleRuntimeMessage({ type: 'GET_CREDENTIALS_STATUS' });
    expect(relocked).toEqual({ ok: true, data: { status: 'locked' } });
  });

  it('handles unconfigured, plaintext, and wrong-passphrase credential states', async () => {
    expect(await handleRuntimeMessage({ type: 'GET_CREDENTIALS_STATUS' })).toEqual({
      ok: true,
      data: { status: 'unconfigured' }
    });
    expect(
      await handleRuntimeMessage({ type: 'UNLOCK_CREDENTIALS', passphrase: 'any' })
    ).toEqual({ ok: false, error: 'unconfigured' });

    const envelope = await encryptCredentials(CREDS, 'right-pass');
    await setStoredCredentials(envelope);
    const badUnlock = await handleRuntimeMessage({
      type: 'UNLOCK_CREDENTIALS',
      passphrase: 'wrong-pass'
    });
    expect(badUnlock.ok).toBe(false);

    await setStoredCredentials(CREDS);
    expect(await handleRuntimeMessage({ type: 'GET_CREDENTIALS_STATUS' })).toEqual({
      ok: true,
      data: { status: 'ready', credentials: CREDS }
    });
    expect(
      await handleRuntimeMessage({ type: 'UNLOCK_CREDENTIALS', passphrase: 'ignored' })
    ).toEqual({ ok: true, data: { status: 'ready', credentials: CREDS } });
  });

  it('pings Moodle using core_session_touch and pauses if logged out', async () => {
    await updateKeepAliveSiteState('moodle', { status: 'ok', sesskey: 'abc123' });

    const okFetch = vi.fn(async () =>
      new Response(JSON.stringify([{ error: false, data: true }]), { status: 200 })
    ) as unknown as typeof fetch;

    const okState = await pingMoodleSite('moodle', okFetch);
    expect(okState.status).toBe('ok');

    const redirectFetch = vi.fn(async () => ({
      status: 0,
      type: 'opaqueredirect',
      redirected: false,
      url: '',
      text: async () => ''
    })) as unknown as typeof fetch;

    // Clear sesskey first so it hits GET /my/
    await updateKeepAliveSiteState('moodle', { sesskey: undefined });
    const outState = await pingMoodleSite('moodle', redirectFetch);
    expect(outState.status).toBe('logged_out');
    expect((await getKeepAliveStates()).moodle.status).toBe('logged_out');
  });

  it('falls back to GET /my/ on invalidsesskey and records errors on failures', async () => {
    await updateKeepAliveSiteState('moodle', { status: 'ok', sesskey: 'staleKey' });

    const fallbackFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ error: true, exception: { errorcode: 'invalidsesskey' } }]),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response('<a href="/login/logout.php?sesskey=fresh999">Logout</a>', {
          status: 200
        })
      ) as unknown as typeof fetch;

    const recovered = await pingMoodleSite('moodle', fallbackFetch);
    expect(recovered.status).toBe('ok');
    expect(recovered.sesskey).toBe('fresh999');

    const ajaxLoggedOutFetch = vi.fn(async () =>
      new Response(
        JSON.stringify([{ error: true, exception: { errorcode: 'servicerequireslogin' } }]),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const loggedOut = await pingMoodleSite('moodle', ajaxLoggedOutFetch);
    expect(loggedOut.status).toBe('logged_out');
    expect(loggedOut.sesskey).toBeUndefined();

    const networkErrFetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const errored = await pingMoodleSite('moodle', networkErrFetch);
    expect(errored.status).toBe('error');
    expect(errored.lastError).toBe('offline');
  });

  it('runs keep-alive ticks respecting enabled settings and logged_out pause', async () => {
    await updateSettings({ keepAliveMoodle: true, keepAliveCsMoodle: false });
    await updateKeepAliveSiteState('moodle', { status: 'logged_out' });
    await updateKeepAliveSiteState('csMoodle', { status: 'ok', sesskey: 'cs123' });

    const fetchMock = vi.fn(async () =>
      new Response('<a href="/login/logout.php?sesskey=newKey1">Logout</a>', { status: 200 })
    ) as unknown as typeof fetch;

    // Background tick skips logged_out moodle and disabled csMoodle
    await runKeepAliveTick(undefined, fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();

    // Explicit user ping still pings enabled moodle even when logged_out
    const states = await runKeepAliveTick('moodle', fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(states.moodle.status).toBe('ok');
    expect(states.moodle.sesskey).toBe('newKey1');
  });

  it('creates and clears keep-alive alarm based on settings', async () => {
    await updateSettings({
      keepAliveMoodle: true,
      keepAliveCsMoodle: false,
      keepAliveIntervalMin: 10
    });
    await syncKeepAliveAlarm();
    expect(alarmsCreated[0]?.name).toBe('huji-moodle-keepalive');
    expect(alarmsCreated[0]?.info).toEqual({ periodInMinutes: 10 });

    await updateSettings({ keepAliveMoodle: false, keepAliveCsMoodle: false });
    await syncKeepAliveAlarm();
    expect(alarmsCleared).toContain('huji-moodle-keepalive');
  });

  it('handles Gauth handoff, Moodle session report, login guard reset, and alarm updates', async () => {
    const payload = {
      totpSecret: 'JBSWY3DPEHPK3PXP',
      pin4: '0429',
      capturedAt: 123456
    };
    const setupRes = await handleRuntimeMessage({
      type: 'OPEN_SETUP_WITH_IMPORT',
      payload
    });
    expect(setupRes).toEqual({ ok: true, data: true });
    expect(await getPendingGauthImport()).toEqual(payload);
    expect(openOptionsPage).toHaveBeenCalledTimes(1);

    const reportOk = await handleRuntimeMessage({
      type: 'REPORT_MOODLE_SESSION',
      origin: 'https://moodle.huji.ac.il',
      loggedIn: true,
      sesskey: 'sess77'
    });
    expect(reportOk).toEqual({ ok: true, data: true });
    expect((await getKeepAliveStates()).moodle.sesskey).toBe('sess77');

    const reportOut = await handleRuntimeMessage({
      type: 'REPORT_MOODLE_SESSION',
      origin: 'https://moodle2.cs.huji.ac.il',
      loggedIn: false
    });
    expect(reportOut).toEqual({ ok: true, data: true });
    expect((await getKeepAliveStates()).csMoodle.status).toBe('logged_out');

    expect(
      await handleRuntimeMessage({
        type: 'REPORT_MOODLE_SESSION',
        origin: 'https://example.com',
        loggedIn: true
      })
    ).toEqual({ ok: true, data: false });

    const noTab = await handleRuntimeMessage({ type: 'CAPTURE_OPEN_GAUTH' });
    expect(noTab).toEqual({ ok: false, error: 'no_gauth_tab' });

    tabsQuery.mockResolvedValueOnce([{ id: 42 }]);
    tabsSendMessage.mockResolvedValueOnce({ ok: true, data: payload });
    const captured = await handleRuntimeMessage({ type: 'CAPTURE_OPEN_GAUTH' });
    expect(tabsQuery).toHaveBeenCalledWith({ url: 'https://gauth.huji.ac.il/*' });
    expect(tabsSendMessage).toHaveBeenCalledWith(42, { type: 'EXTRACT_GAUTH_FROM_PAGE' });
    expect(captured).toEqual({ ok: true, data: payload });

    await setLoginGuard({
      attempts: [{ timestamp: 1000, authStateKey: 'k1' }],
      pausedUntilErrorCleared: true
    });
    expect(await handleRuntimeMessage({ type: 'RESET_LOGIN_GUARD' })).toEqual({
      ok: true,
      data: true
    });
    expect(await getLoginGuard()).toEqual({ attempts: [], pausedUntilErrorCleared: false });

    await updateSettings({ keepAliveMoodle: true, keepAliveIntervalMin: 20 });
    expect(await handleRuntimeMessage({ type: 'UPDATE_KEEPALIVE_ALARM' })).toEqual({
      ok: true,
      data: true
    });
    expect(alarmsCreated.at(-1)).toEqual({
      name: KEEPALIVE_ALARM_NAME,
      info: { periodInMinutes: 20 }
    });

    const pingNowFetch = vi.fn(async () =>
      new Response(JSON.stringify([{ error: false, data: true }]), { status: 200 })
    );
    vi.stubGlobal('fetch', pingNowFetch);
    const pingNowRes = await handleRuntimeMessage({
      type: 'PING_KEEPALIVE_NOW',
      site: 'moodle'
    });
    expect(pingNowRes.ok).toBe(true);
    expect(pingNowFetch).toHaveBeenCalledWith(
      'https://moodle.huji.ac.il/lib/ajax/service.php?sesskey=sess77&info=core_session_touch',
      expect.objectContaining({ method: 'POST' })
    );
    expect((await getKeepAliveStates()).moodle.lastPingAt).toBeTypeOf('number');

    const unknownRes = await handleRuntimeMessage({
      type: 'UNKNOWN_MSG'
    } as unknown as RuntimeMessage);
    expect(unknownRes).toEqual({ ok: false, error: 'unknown_message' });
  });

  it('registers MV3 listeners synchronously at top level and handles messages asynchronously', async () => {
    vi.resetModules();
    await updateSettings({ keepAliveMoodle: true, keepAliveIntervalMin: 15 });

    await import('../../src/background/worker');

    expect(installedListeners).toHaveLength(1);
    expect(startupListeners).toHaveLength(1);
    expect(alarmListeners).toHaveLength(1);
    expect(messageListeners).toHaveLength(1);

    installedListeners[0]?.();
    await vi.waitFor(() => {
      expect(alarmsCreated).toHaveLength(1);
    });

    startupListeners[0]?.();
    await vi.waitFor(() => {
      expect(alarmsCreated).toHaveLength(2);
    });

    const fetchMock = vi.fn(async () =>
      new Response('<a href="/login/logout.php?sesskey=alarmSess">Logout</a>', { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    alarmListeners[0]?.({ name: 'other-alarm' });
    alarmListeners[0]?.({ name: KEEPALIVE_ALARM_NAME });
    await vi.waitFor(async () => {
      expect((await getKeepAliveStates()).moodle.sesskey).toBe('alarmSess');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const sendResponse = vi.fn();
    const keepChannelOpen = messageListeners[0]?.(
      { type: 'GET_CREDENTIALS_STATUS' },
      {},
      sendResponse
    );
    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        data: { status: 'unconfigured' }
      });
    });
  });
});
