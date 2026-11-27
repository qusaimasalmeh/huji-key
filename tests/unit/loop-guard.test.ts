import { describe, expect, it } from 'vitest';
import {
  EMPTY_LOGIN_GUARD,
  evaluateAutoSubmitGuard,
  extractAuthStateKey,
  recordAutoSubmitAttempt,
  resetAutoSubmitGuard
} from '../../src/core/loop-guard';

describe('auto-submit loop guard', () => {
  it('extracts stable AuthState key from HUJI IdP URL', () => {
    const key = extractAuthStateKey(
      'https://idp.cc.huji.ac.il/simplesaml/module.php/hujicc/login?AuthState=_935046d313af4121%3Ahttps%3A%2F%2Fidp.cc.huji.ac.il'
    );
    expect(key).toBe('_935046d313af4121');
  });

  it('allows first two attempts within 60s and blocks third', () => {
    const t0 = 1_700_000_000_000;
    let guard = EMPTY_LOGIN_GUARD;

    expect(evaluateAutoSubmitGuard({ guard, hasPageError: false, authStateKey: 's1', nowMs: t0 }).allowed).toBe(true);
    guard = recordAutoSubmitAttempt(guard, 's1', t0);

    expect(evaluateAutoSubmitGuard({ guard, hasPageError: false, authStateKey: 's1', nowMs: t0 + 5_000 }).allowed).toBe(true);
    guard = recordAutoSubmitAttempt(guard, 's1', t0 + 5_000);

    expect(evaluateAutoSubmitGuard({ guard, hasPageError: false, authStateKey: 's1', nowMs: t0 + 10_000 })).toEqual({
      allowed: false,
      reason: 'rate_limited'
    });

    // After 61s window expires, attempts are pruned
    expect(evaluateAutoSubmitGuard({ guard, hasPageError: false, authStateKey: 's1', nowMs: t0 + 62_000 }).allowed).toBe(true);
  });

  it('pauses immediately if page error alert is present', () => {
    const res = evaluateAutoSubmitGuard({
      guard: EMPTY_LOGIN_GUARD,
      hasPageError: true,
      authStateKey: 's1',
      nowMs: 1_700_000_000_000
    });
    expect(res).toEqual({ allowed: false, reason: 'page_error' });
  });

  it('resets cleanly on manual retry', () => {
    let guard = recordAutoSubmitAttempt(EMPTY_LOGIN_GUARD, 's1', 1000);
    guard = recordAutoSubmitAttempt(guard, 's1', 2000);
    expect(resetAutoSubmitGuard()).toEqual(EMPTY_LOGIN_GUARD);
  });
});
