import { describe, expect, it } from 'vitest';
import {
  decryptCredentials,
  encryptCredentials,
  isEncryptedEnvelope
} from '../../src/core/crypto';
import type { PlainCredentials } from '../../src/core/types';

const SAMPLE: PlainCredentials = {
  id9: '000000018',
  pin4: '0429',
  totpSecret: 'JBSWY3DPEHPK3PXP',
  issuer: 'HUJI',
  digits: 6,
  period: 30,
  algorithm: 'SHA-1'
};

describe('Master Lock WebCrypto AES-GCM', () => {
  it('encrypts and decrypts credentials cleanly with unique salt and IV', async () => {
    const env1 = await encryptCredentials(SAMPLE, 'correct horse battery');
    const env2 = await encryptCredentials(SAMPLE, 'correct horse battery');

    expect(isEncryptedEnvelope(env1)).toBe(true);
    expect(env1.iterations).toBe(310000);
    expect(env1.saltB64).not.toBe(env2.saltB64);
    expect(env1.ivB64).not.toBe(env2.ivB64);

    const decrypted = await decryptCredentials(env1, 'correct horse battery');
    expect(decrypted).toEqual(SAMPLE);
  });

  it('fails decryption with wrong passphrase', async () => {
    const env = await encryptCredentials(SAMPLE, 'right-pass');
    await expect(decryptCredentials(env, 'wrong-pass')).rejects.toThrow();
  });

  it('rejects empty passphrase', async () => {
    await expect(encryptCredentials(SAMPLE, '')).rejects.toThrow(/passphrase/i);
  });
});
