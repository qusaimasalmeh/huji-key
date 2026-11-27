import { EMPTY_LOGIN_GUARD } from '../core/loop-guard';
import type {
  ExtensionSettings,
  KeepAliveSiteState,
  KeepAliveStates,
  LoginAttemptGuard,
  PendingGauthImport,
  PlainCredentials,
  SiteKey,
  StoredCredentials
} from '../core/types';
import { ext } from './browser';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  language: 'en',
  autoFill: true,
  autoSubmit: true,
  lockEnabled: false,
  keepAliveMoodle: true,
  keepAliveCsMoodle: false,
  keepAliveIntervalMin: 15
};

const DEFAULT_SITE_STATE: KeepAliveSiteState = {
  status: 'never',
  lastPingAt: null,
  lastLoggedInAt: null
};

export const DEFAULT_KEEPALIVE_STATES: KeepAliveStates = {
  moodle: { ...DEFAULT_SITE_STATE },
  csMoodle: { ...DEFAULT_SITE_STATE }
};

export async function getStoredCredentials(): Promise<StoredCredentials> {
  const res = await ext.storage.local.get('credentials');
  return (res.credentials as StoredCredentials | undefined) ?? null;
}

export async function setStoredCredentials(credentials: StoredCredentials): Promise<void> {
  await ext.storage.local.set({ credentials });
}

export async function getSettings(): Promise<ExtensionSettings> {
  const res = await ext.storage.local.get('settings');
  return {
    ...DEFAULT_SETTINGS,
    ...((res.settings as Partial<ExtensionSettings> | undefined) ?? {})
  };
}

export async function updateSettings(
  patch: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const next = { ...(await getSettings()), ...patch };
  await ext.storage.local.set({ settings: next });
  return next;
}

export async function getKeepAliveStates(): Promise<KeepAliveStates> {
  const res = await ext.storage.local.get('keepAliveStates');
  const raw = (res.keepAliveStates as Partial<KeepAliveStates> | undefined) ?? {};
  return {
    moodle: { ...DEFAULT_SITE_STATE, ...(raw.moodle ?? {}) },
    csMoodle: { ...DEFAULT_SITE_STATE, ...(raw.csMoodle ?? {}) }
  };
}

export async function updateKeepAliveSiteState(
  site: SiteKey,
  patch: Partial<KeepAliveSiteState>
): Promise<KeepAliveStates> {
  const current = await getKeepAliveStates();
  const next: KeepAliveStates = {
    ...current,
    [site]: { ...current[site], ...patch }
  };
  await ext.storage.local.set({ keepAliveStates: next });
  return next;
}

export async function getUnlockedCredentials(): Promise<PlainCredentials | null> {
  const res = await ext.storage.session.get('unlockedCredentials');
  return (res.unlockedCredentials as PlainCredentials | undefined) ?? null;
}

export async function setUnlockedCredentials(creds: PlainCredentials | null): Promise<void> {
  await ext.storage.session.set({ unlockedCredentials: creds });
}

export async function getLoginGuard(): Promise<LoginAttemptGuard> {
  const res = await ext.storage.session.get('loginAttemptGuard');
  return (
    (res.loginAttemptGuard as LoginAttemptGuard | undefined) ?? {
      ...EMPTY_LOGIN_GUARD,
      attempts: []
    }
  );
}

export async function setLoginGuard(guard: LoginAttemptGuard): Promise<void> {
  await ext.storage.session.set({ loginAttemptGuard: guard });
}

export async function getPendingGauthImport(): Promise<PendingGauthImport | null> {
  const res = await ext.storage.session.get('pendingGauthImport');
  return (res.pendingGauthImport as PendingGauthImport | undefined) ?? null;
}

export async function setPendingGauthImport(pending: PendingGauthImport | null): Promise<void> {
  await ext.storage.session.set({ pendingGauthImport: pending });
}

export async function clearAllData(): Promise<void> {
  await ext.storage.local.clear();
  await ext.storage.session.clear();
}
