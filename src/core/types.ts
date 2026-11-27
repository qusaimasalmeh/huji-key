export type Language = 'en' | 'he' | 'ar';
export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

export interface PlainCredentials {
  id9: string;
  pin4: string;
  totpSecret: string;
  issuer: string;
  digits: number;
  period: number;
  algorithm: TotpAlgorithm;
}

export interface EncryptedCredentialsEnvelope {
  encrypted: true;
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
  iterations: 310000;
}

export type StoredCredentials = PlainCredentials | EncryptedCredentialsEnvelope | null;

export interface ExtensionSettings {
  language: Language;
  autoFill: boolean;
  autoSubmit: boolean;
  lockEnabled: boolean;
  keepAliveMoodle: boolean;
  keepAliveCsMoodle: boolean;
  keepAliveIntervalMin: 10 | 15 | 20;
}

export type SiteKey = 'moodle' | 'csMoodle';
export type SiteStatus = 'ok' | 'logged_out' | 'paused' | 'error' | 'never';

export interface KeepAliveSiteState {
  status: SiteStatus;
  lastPingAt: number | null;
  lastLoggedInAt: number | null;
  lastError?: string;
  sesskey?: string;
}

export type KeepAliveStates = Record<SiteKey, KeepAliveSiteState>;

export interface LoginAttempt {
  timestamp: number;
  authStateKey: string;
}

export interface LoginAttemptGuard {
  attempts: LoginAttempt[];
  pausedUntilErrorCleared: boolean;
}

export interface PendingGauthImport {
  totpSecret: string;
  pin4?: string;
  id9?: string;
  issuer?: string;
  digits?: number;
  period?: number;
  algorithm?: TotpAlgorithm;
  capturedAt: number;
}

export type CredentialAvailability =
  | { status: 'unconfigured' }
  | { status: 'locked' }
  | { status: 'ready'; credentials: PlainCredentials };

export type RuntimeMessage =
  | { type: 'GET_CREDENTIALS_STATUS' }
  | { type: 'UNLOCK_CREDENTIALS'; passphrase: string }
  | { type: 'LOCK_CREDENTIALS' }
  | { type: 'OPEN_SETUP_WITH_IMPORT'; payload: PendingGauthImport }
  | { type: 'REPORT_MOODLE_SESSION'; origin: string; loggedIn: boolean; sesskey?: string }
  | { type: 'PING_KEEPALIVE_NOW'; site?: SiteKey }
  | { type: 'CAPTURE_OPEN_GAUTH' }
  | { type: 'EXTRACT_GAUTH_FROM_PAGE' }
  | { type: 'RESET_LOGIN_GUARD' }
  | { type: 'UPDATE_KEEPALIVE_ALARM' }
  | { type: 'OPEN_OPTIONS' };

export type RuntimeResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
