import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  const signature = buf.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    throw new Error(`Invalid PNG signature in ${filePath}`);
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20)
  };
}

describe('icon generator', () => {
  it('generates exact 16, 32, 48, and 128 PNG icons', () => {
    execSync('node scripts/generate-icons.mjs', { stdio: 'pipe' });
    for (const size of [16, 32, 48, 128]) {
      const iconPath = path.resolve('assets/icons', `icon-${size}.png`);
      expect(fs.existsSync(iconPath)).toBe(true);
      expect(readPngDimensions(iconPath)).toEqual({ width: size, height: size });
    }
  });
});
