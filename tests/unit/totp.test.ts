import { describe, expect, it } from 'vitest';
import {
  decodeBase32,
  generateTotp,
  getTotpWindowInfo,
  normalizeBase32,
  parseOtpAuthUri
} from '../../src/core/totp';

// RFC 6238 Appendix B ASCII "12345678901234567890" in Base32
const RFC_SHA1_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
// 32-byte ASCII "12345678901234567890123456789012"
const RFC_SHA256_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';

describe('Base32 & otpauth parser', () => {
  it('normalizes whitespace, dashes, and lowercase characters', () => {
    expect(normalizeBase32(' gezd-gnbv gy3t qojq ')).toBe('GEZDGNBVGY3TQOJQ');
  });

  it('rejects invalid Base32 characters', () => {
    expect(() => decodeBase32('1890INVALID')).toThrow(/base32/i);
  });

  it('parses standard otpauth://totp URI with defaults and overrides', () => {
    const parsed = parseOtpAuthUri(
      '  otpauth://totp/HUJI:123456789?secret=jbsw-y3dp%20ehpk3pxp&issuer=HUJI&digits=6&period=30&algorithm=SHA1  '
    );
    expect(parsed).toEqual({
      totpSecret: 'JBSWY3DPEHPK3PXP',
      issuer: 'HUJI',
      label: 'HUJI:123456789',
      digits: 6,
      period: 30,
      algorithm: 'SHA-1'
    });
  });

  it('rejects HOTP URIs cleanly', () => {
    expect(() =>
      parseOtpAuthUri('otpauth://hotp/HUJI?secret=JBSWY3DPEHPK3PXP&counter=1')
    ).toThrow(/totp/i);
  });
});

describe('RFC 6238 TOTP generation', () => {
  it('matches official RFC 6238 SHA-1 8-digit vectors', async () => {
    expect(
      await generateTotp({ secret: RFC_SHA1_SECRET, timestampMs: 59_000, digits: 8 })
    ).toBe('94287082');
    expect(
      await generateTotp({ secret: RFC_SHA1_SECRET, timestampMs: 1_111_111_109_000, digits: 8 })
    ).toBe('07081804');
    expect(
      await generateTotp({ secret: RFC_SHA1_SECRET, timestampMs: 2_000_000_000_000, digits: 8 })
    ).toBe('69279037');
  });

  it('matches RFC 6238 SHA-256 8-digit vector', async () => {
    expect(
      await generateTotp({
        secret: RFC_SHA256_SECRET,
        timestampMs: 59_000,
        digits: 8,
        algorithm: 'SHA-256'
      })
    ).toBe('46119246');
  });

  it('computes accurate window countdown metadata', () => {
    const info = getTotpWindowInfo(58_000, 30);
    expect(info.step).toBe(1);
    expect(info.secondsRemaining).toBe(2);
    expect(info.progress).toBeCloseTo(28 / 30, 5);
  });
});
