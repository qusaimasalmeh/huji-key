import { decodeBase32, normalizeBase32 } from './totp';

function hasValidIsraeliCheckDigit(id9: string): boolean {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const digit = Number(id9[i]);
    const doubled = digit * ((i % 2) + 1);
    sum += doubled > 9 ? doubled - 9 : doubled;
  }
  return sum % 10 === 0;
}

export function validateIsraeliId(raw: string): {
  valid: boolean;
  normalized: string;
  checkDigitWarning: boolean;
  error?: 'format';
} {
  const normalized = raw.trim();
  if (!/^\d{9}$/.test(normalized)) {
    return { valid: false, normalized, checkDigitWarning: false, error: 'format' };
  }
  return {
    valid: true,
    normalized,
    checkDigitWarning: !hasValidIsraeliCheckDigit(normalized)
  };
}

export function validatePin4(raw: string): {
  valid: boolean;
  normalized: string;
  error?: 'format';
} {
  const normalized = raw.trim();
  if (!/^\d{4}$/.test(normalized)) {
    return { valid: false, normalized, error: 'format' };
  }
  return { valid: true, normalized };
}

export function validateSecret(raw: string): {
  valid: boolean;
  normalized: string;
  error?: 'format';
} {
  const normalized = normalizeBase32(raw);
  try {
    decodeBase32(normalized);
    return { valid: true, normalized };
  } catch {
    return { valid: false, normalized, error: 'format' };
  }
}

export function formatCombinedOtp(pin4: string, totp: string): string {
  return `${pin4.trim()}${totp.trim()}`;
}
