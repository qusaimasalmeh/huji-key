import type { TotpAlgorithm } from './types';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function normalizeBase32(input: string): string {
  return decodeURIComponentSafe(input).replace(/[\s\-=]+/g, '').toUpperCase();
}

function decodeURIComponentSafe(val: string): string {
  try {
    return decodeURIComponent(val);
  } catch {
    return val;
  }
}

export function decodeBase32(secret: string): Uint8Array {
  const cleaned = normalizeBase32(secret);
  if (cleaned.length < 8) {
    throw new Error('Invalid Base32 secret: must be at least 8 characters');
  }
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error(`Invalid Base32 character: ${ch}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

function normalizeAlgorithm(raw: string | null): TotpAlgorithm {
  const upper = (raw ?? 'SHA1').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (upper === 'SHA256') return 'SHA-256';
  if (upper === 'SHA512') return 'SHA-512';
  return 'SHA-1';
}

export function parseOtpAuthUri(uri: string): {
  totpSecret: string;
  issuer: string;
  label: string;
  digits: number;
  period: number;
  algorithm: TotpAlgorithm;
} {
  const trimmed = uri.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Invalid otpauth URI');
  }
  if (url.protocol !== 'otpauth:') {
    throw new Error('URI must start with otpauth://');
  }
  const kind = url.hostname.toLowerCase();
  if (kind !== 'totp') {
    throw new Error('Only time-based TOTP URIs are supported');
  }
  const secretRaw = url.searchParams.get('secret');
  if (!secretRaw) {
    throw new Error('Missing secret parameter in otpauth URI');
  }
  const totpSecret = normalizeBase32(secretRaw);
  decodeBase32(totpSecret);

  const label = decodeURIComponentSafe(url.pathname.replace(/^\/+/, ''));
  const issuer = url.searchParams.get('issuer')?.trim() || label.split(':')[0] || 'HUJI';
  const digits = Number(url.searchParams.get('digits') ?? '6');
  const period = Number(url.searchParams.get('period') ?? '30');

  if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
    throw new Error('Invalid digits count in otpauth URI');
  }
  if (!Number.isInteger(period) || period < 10 || period > 120) {
    throw new Error('Invalid period in otpauth URI');
  }

  return {
    totpSecret,
    issuer,
    label,
    digits,
    period,
    algorithm: normalizeAlgorithm(url.searchParams.get('algorithm'))
  };
}

export function getTotpWindowInfo(
  timestampMs = Date.now(),
  period = 30
): { step: number; secondsRemaining: number; progress: number } {
  const epochSec = Math.floor(timestampMs / 1000);
  const step = Math.floor(epochSec / period);
  const elapsed = (timestampMs / 1000) % period;
  const secondsRemaining = Math.max(0, Math.ceil(period - elapsed));
  return {
    step,
    secondsRemaining,
    progress: elapsed / period
  };
}

export async function generateTotp(params: {
  secret: string;
  timestampMs?: number;
  digits?: number;
  period?: number;
  algorithm?: TotpAlgorithm;
}): Promise<string> {
  const {
    secret,
    timestampMs = Date.now(),
    digits = 6,
    period = 30,
    algorithm = 'SHA-1'
  } = params;

  const keyBytes = decodeBase32(secret);
  const counter = BigInt(Math.floor(Math.floor(timestampMs / 1000) / period));
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  view.setBigUint64(0, counter, false);

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign']
  );

  const sig = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', cryptoKey, counterBuf));
  const lastByte = sig[sig.length - 1] ?? 0;
  const offset = lastByte & 0x0f;
  const binCode =
    (((sig[offset] ?? 0) & 0x7f) << 24) |
    (((sig[offset + 1] ?? 0) & 0xff) << 16) |
    (((sig[offset + 2] ?? 0) & 0xff) << 8) |
    ((sig[offset + 3] ?? 0) & 0xff);

  const mod = 10 ** digits;
  return String(binCode % mod).padStart(digits, '0');
}
