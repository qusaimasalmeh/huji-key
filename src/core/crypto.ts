import type { EncryptedCredentialsEnvelope, PlainCredentials } from './types';

const PBKDF2_ITERATIONS = 310000 as const;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const byte of bytes) {
    bin += String.fromCharCode(byte);
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function isEncryptedEnvelope(value: unknown): value is EncryptedCredentialsEnvelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<EncryptedCredentialsEnvelope>;
  return (
    v.encrypted === true &&
    typeof v.saltB64 === 'string' &&
    typeof v.ivB64 === 'string' &&
    typeof v.ciphertextB64 === 'string'
  );
}

export async function encryptCredentials(
  creds: PlainCredentials,
  passphrase: string
): Promise<EncryptedCredentialsEnvelope> {
  if (!passphrase) {
    throw new Error('Passphrase cannot be empty');
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(creds));

  const cipherBuf = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    plaintext
  );

  return {
    encrypted: true,
    saltB64: toBase64(salt),
    ivB64: toBase64(iv),
    ciphertextB64: toBase64(new Uint8Array(cipherBuf)),
    iterations: PBKDF2_ITERATIONS
  };
}

export async function decryptCredentials(
  envelope: EncryptedCredentialsEnvelope,
  passphrase: string
): Promise<PlainCredentials> {
  if (!passphrase) {
    throw new Error('Passphrase required');
  }
  const salt = fromBase64(envelope.saltB64);
  const iv = fromBase64(envelope.ivB64);
  const ciphertext = fromBase64(envelope.ciphertextB64);
  const key = await deriveAesKey(passphrase, salt);

  const plainBuf = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer
  );

  return JSON.parse(new TextDecoder().decode(plainBuf)) as PlainCredentials;
}
