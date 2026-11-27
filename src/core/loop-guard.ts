import type { LoginAttemptGuard } from './types';

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 2;

export const EMPTY_LOGIN_GUARD: LoginAttemptGuard = {
  attempts: [],
  pausedUntilErrorCleared: false
};

export function extractAuthStateKey(urlString: string): string {
  try {
    const url = new URL(urlString);
    const authState = url.searchParams.get('AuthState');
    if (authState) {
      return authState.split(':')[0] || authState.slice(0, 24);
    }
    return url.pathname;
  } catch {
    return 'default';
  }
}

export function evaluateAutoSubmitGuard(params: {
  guard: LoginAttemptGuard;
  hasPageError: boolean;
  authStateKey: string;
  nowMs?: number;
}): { allowed: boolean; reason?: 'page_error' | 'rate_limited' } {
  const { guard, hasPageError, nowMs = Date.now() } = params;
  if (hasPageError) {
    return { allowed: false, reason: 'page_error' };
  }
  const recent = guard.attempts.filter((a) => nowMs - a.timestamp <= WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS_PER_WINDOW) {
    return { allowed: false, reason: 'rate_limited' };
  }
  return { allowed: true };
}

export function recordAutoSubmitAttempt(
  guard: LoginAttemptGuard,
  authStateKey: string,
  nowMs = Date.now()
): LoginAttemptGuard {
  const recent = guard.attempts.filter((a) => nowMs - a.timestamp <= WINDOW_MS);
  return {
    attempts: [...recent, { timestamp: nowMs, authStateKey }],
    pausedUntilErrorCleared: false
  };
}

export function resetAutoSubmitGuard(): LoginAttemptGuard {
  return { attempts: [], pausedUntilErrorCleared: false };
}
