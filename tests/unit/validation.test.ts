import { describe, expect, it } from 'vitest';
import {
  formatCombinedOtp,
  validateIsraeliId,
  validatePin4,
  validateSecret
} from '../../src/core/validation';

describe('validation', () => {
  it('accepts valid 9-digit Israeli ID preserving leading zero', () => {
    // Invalid check digit (012345678 -> weighted sum 34) triggers warning while remaining valid
    expect(validateIsraeliId(' 012345678 ')).toEqual({
      valid: true,
      normalized: '012345678',
      checkDigitWarning: true
    });
    // Valid Israeli ID check digit (000000018 -> weighted sum 10)
    expect(validateIsraeliId('000000018')).toEqual({
      valid: true,
      normalized: '000000018',
      checkDigitWarning: false
    });
  });

  it('rejects non-9-digit IDs', () => {
    expect(validateIsraeliId('12345').valid).toBe(false);
    expect(validateIsraeliId('12345678a').valid).toBe(false);
  });

  it('validates 4-digit numeric PIN preserving leading zeros', () => {
    expect(validatePin4('0429')).toEqual({ valid: true, normalized: '0429' });
    expect(validatePin4('42').valid).toBe(false);
  });

  it('validates Base32 secret', () => {
    expect(validateSecret('jbsw-y3dp ehpk3pxp')).toEqual({
      valid: true,
      normalized: 'JBSWY3DPEHPK3PXP'
    });
    expect(validateSecret('bad!secret').valid).toBe(false);
  });

  it('concatenates pin4 and totp', () => {
    expect(formatCombinedOtp('0429', '019283')).toBe('0429019283');
  });
});
