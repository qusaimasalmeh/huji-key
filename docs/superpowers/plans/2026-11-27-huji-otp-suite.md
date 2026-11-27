# HUJI Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-browser (Chrome/Chromium + Firefox MV3) local-only browser extension for HUJI students that handles 4-way OTP onboarding, safe auto-fill/auto-submit on HUJI's SimpleSAML IdP, and smart Moodle session keep-alive in a light EN/HE/AR UI.

**Architecture:** Modular TypeScript codebase (`src/core/` pure testable logic, `src/shared/` cross-browser storage/QR helpers, `src/background/` MV3 worker, `src/content/` IdP/gauth/Moodle scripts, `src/popup/` & `src/options/` vanilla accessible UI) compiled via `esbuild` into clean self-contained IIFE bundles with per-store manifests in `dist/chrome/` and `dist/firefox/`. All secrets stay device-local in `storage.local` with optional WebCrypto PBKDF2 + AES-256-GCM Master Lock caching unlocked credentials only in `storage.session`.

**Tech Stack:** TypeScript, `esbuild`, `jsqr` (pure-JS QR decoding for Chrome + Firefox), `vitest` + `jsdom` + `qrcode` (dev-only test QR fixture generator), WebCrypto (`crypto.subtle`), WebExtensions MV3.

**Spec:** `docs/superpowers/specs/2026-11-27-huji-otp-suite-design.md`

## Global Constraints

- **Manifest Version:** `manifest_version: 3` only; no inline `<script>` or inline event handlers (`onclick`) in any extension HTML page.
- **Permissions:** `permissions: ["storage", "alarms"]` — **no `"tabs"` permission**.
- **Host Permissions:** Strictly scoped to `"https://idp.cc.huji.ac.il/*"`, `"https://gauth.huji.ac.il/*"`, `"https://moodle.huji.ac.il/*"`, `"https://moodle2.cs.huji.ac.il/*"`.
- **Cross-Browser Manifests:** `dist/chrome/manifest.json` uses `"background": { "service_worker": "background/worker.js" }`; `dist/firefox/manifest.json` uses `"background": { "scripts": ["background/worker.js"] }` and `"browser_specific_settings": { "gecko": { "id": "huji-key@student-tools.local", "strict_min_version": "140.0", "data_collection_permissions": { "required": ["none"] } } }`.
- **Data Storage & Crypto:** Zero remote servers, zero analytics/telemetry, never `storage.sync`. Master Lock uses `PBKDF2` SHA-256 (`310000` iterations, 16-byte salt) + `AES-256-GCM` (12-byte IV).
- **Languages & UI:** English default (`ltr`), Hebrew (`rtl`), Arabic (`rtl`); language switcher pill `EN | עב | ع`. Light academic theme (`#F8FAFC` background, `#FFFFFF` cards, `#E2E8F0` borders, `#0F172A` text, `#1D4ED8` primary, `#991B1B` small emblem accent). Numeric inputs (`id9`, `pin4`) use `type="text" inputmode="numeric"` (never `type="number"`) to preserve leading zeros.
- **Icons:** Real PNG files at exact `16x16`, `32x32`, `48x48`, `128x128` dimensions.
- **Store Compliance:** Clearly labeled unofficial student-built helper; non-obfuscated build output; `CHROMEWEBSTORE.md` free of implementation jargon.

---

### Task 1: Project Scaffolding, Shared Types, PNG Icon Generator & Dual-Target Build Pipeline

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/core/types.ts`
- Create: `scripts/generate-icons.mjs`
- Create: `scripts/build.mjs`
- Create: `scripts/package.mjs`
- Test: `tests/unit/build-icons.test.ts`

**Interfaces:**
- Produces in `src/core/types.ts`: `Language`, `TotpAlgorithm`, `PlainCredentials`, `EncryptedCredentialsEnvelope`, `StoredCredentials`, `ExtensionSettings`, `SiteKey`, `SiteStatus`, `KeepAliveSiteState`, `KeepAliveStates`, `LoginAttempt`, `LoginAttemptGuard`, `PendingGauthImport`, `RuntimeMessage`, `RuntimeResponse`
- Produces scripts: `npm run generate:icons`, `npm run typecheck`, `npm test`, `npm run build`, `npm run pack`

- [ ] **Step 1: Create `package.json`, `tsconfig.json`, `vitest.config.ts`, and install dependencies**

Write `package.json`:
```json
{
  "name": "huji-key",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Local-only HUJI auto-OTP login and Moodle keep-alive extension",
  "scripts": {
    "generate:icons": "node scripts/generate-icons.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "node scripts/generate-icons.mjs && node scripts/build.mjs",
    "pack": "npm run build && node scripts/package.mjs"
  },
  "dependencies": {
    "jsqr": "^1.4.0"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.310",
    "@types/node": "^22.13.10",
    "@types/qrcode": "^1.5.5",
    "esbuild": "^0.25.0",
    "jsdom": "^26.0.0",
    "qrcode": "^1.5.4",
    "typescript": "^5.8.2",
    "vitest": "^3.0.8"
  }
}
```

Write `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["chrome", "node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Write `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
```

Install packages:
```bash
npm install
```

- [ ] **Step 2: Write `src/core/types.ts`**

```ts
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
  | { type: 'UPDATE_KEEPALIVE_ALARM' };

export type RuntimeResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
```

- [ ] **Step 3: Write failing test `tests/unit/build-icons.test.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/unit/build-icons.test.ts`
Expected: FAIL (`Cannot find module .../scripts/generate-icons.mjs`).

- [ ] **Step 5: Implement `scripts/generate-icons.mjs`, `scripts/build.mjs`, and `scripts/package.mjs`**

Write `scripts/generate-icons.mjs`:
```js
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.resolve('assets/icons');

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lenSq));
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const margin = 0.06;
  const radius = 0.24;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Normalized [0, 1] coordinates
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;

      // Rounded rectangle SDF
      const rx = Math.max(Math.abs(u - 0.5) - (0.5 - margin - radius), 0);
      const ry = Math.max(Math.abs(v - 0.5) - (0.5 - margin - radius), 0);
      const boxDist = Math.hypot(rx, ry) - radius;

      const aa = Math.max(0, Math.min(1, 0.5 - boxDist * size));
      if (aa <= 0) continue;

      // Gradient cobalt (#1D4ED8 -> #1E3A8A) with subtle top-right HUJI crimson dot (#991B1B)
      let r = Math.round(29 + v * 1);
      let g = Math.round(78 - v * 20);
      let b = Math.round(216 - v * 78);

      // Minimalist key glyph in white: head ring at (0.37, 0.44), shaft to (0.74, 0.65), teeth
      const ringDist = Math.abs(Math.hypot(u - 0.37, v - 0.44) - 0.13);
      const shaftDist = distToSegment(u, v, 0.48, 0.51, 0.75, 0.67);
      const tooth1 = distToSegment(u, v, 0.64, 0.61, 0.64, 0.72);
      const tooth2 = distToSegment(u, v, 0.74, 0.67, 0.74, 0.76);
      const keyStroke = Math.min(ringDist, shaftDist, tooth1, tooth2);
      const keyAlpha = Math.max(0, Math.min(1, (0.048 - keyStroke) * size));

      // Small crimson accent badge in upper right
      const dotDist = Math.hypot(u - 0.73, v - 0.27);
      const dotRing = Math.max(0, Math.min(1, (0.085 - dotDist) * size));
      const dotCore = Math.max(0, Math.min(1, (0.062 - dotDist) * size));

      if (dotRing > 0) {
        r = Math.round(r * (1 - dotRing) + 255 * dotRing);
        g = Math.round(g * (1 - dotRing) + 255 * dotRing);
        b = Math.round(b * (1 - dotRing) + 255 * dotRing);
      }
      if (dotCore > 0) {
        r = Math.round(r * (1 - dotCore) + 153 * dotCore);
        g = Math.round(g * (1 - dotCore) + 27 * dotCore);
        b = Math.round(b * (1 - dotCore) + 27 * dotCore);
      }

      if (keyAlpha > 0) {
        r = Math.round(r * (1 - keyAlpha) + 255 * keyAlpha);
        g = Math.round(g * (1 - keyAlpha) + 255 * keyAlpha);
        b = Math.round(b * (1 - keyAlpha) + 255 * keyAlpha);
      }

      const idx = (y * size + x) * 4;
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = Math.round(aa * 255);
    }
  }
  return encodePng(size, size, rgba);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  fs.writeFileSync(path.join(OUT_DIR, `icon-${size}.png`), renderIcon(size));
}
```

Write `scripts/build.mjs`:
```js
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const VERSION = pkg.version;

const BASE_MANIFEST = {
  manifest_version: 3,
  name: 'HUJI Key — Auto OTP & Moodle Keep-Alive',
  short_name: 'HUJI Key',
  version: VERSION,
  description:
    'Unofficial student helper: local auto-OTP login for HUJI portals and smart Moodle keep-alive.',
  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png'
  },
  permissions: ['storage', 'alarms'],
  host_permissions: [
    'https://idp.cc.huji.ac.il/*',
    'https://gauth.huji.ac.il/*',
    'https://moodle.huji.ac.il/*',
    'https://moodle2.cs.huji.ac.il/*'
  ],
  action: {
    default_popup: 'popup/popup.html',
    default_title: 'HUJI Key',
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png'
    }
  },
  options_ui: {
    page: 'options/options.html',
    open_in_tab: true
  },
  content_scripts: [
    {
      matches: ['https://idp.cc.huji.ac.il/simplesaml/module.php/hujicc/login*'],
      js: ['content/idp-login.js'],
      run_at: 'document_idle'
    },
    {
      matches: ['https://gauth.huji.ac.il/*'],
      js: ['content/gauth-capture.js'],
      run_at: 'document_idle'
    },
    {
      matches: ['https://moodle.huji.ac.il/*', 'https://moodle2.cs.huji.ac.il/*'],
      js: ['content/moodle-keepalive.js'],
      run_at: 'document_idle'
    }
  ]
};

function createManifest(target) {
  if (target === 'chrome') {
    return {
      ...BASE_MANIFEST,
      background: {
        service_worker: 'background/worker.js'
      }
    };
  }
  return {
    ...BASE_MANIFEST,
    background: {
      scripts: ['background/worker.js']
    },
    browser_specific_settings: {
      gecko: {
        id: 'huji-key@student-tools.local',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['none']
        }
      }
    }
  };
}

const ENTRY_POINTS = {
  'background/worker': 'src/background/worker.ts',
  'content/idp-login': 'src/content/idp-login.ts',
  'content/gauth-capture': 'src/content/gauth-capture.ts',
  'content/moodle-keepalive': 'src/content/moodle-keepalive.ts',
  'popup/popup': 'src/popup/popup.ts',
  'options/options': 'src/options/options.ts'
};

const STATIC_COPIES = [
  ['src/popup/popup.html', 'popup/popup.html'],
  ['src/popup/popup.css', 'popup/popup.css'],
  ['src/options/options.html', 'options/options.html'],
  ['src/options/options.css', 'options/options.css'],
  ['assets/icons/icon-16.png', 'icons/icon-16.png'],
  ['assets/icons/icon-32.png', 'icons/icon-32.png'],
  ['assets/icons/icon-48.png', 'icons/icon-48.png'],
  ['assets/icons/icon-128.png', 'icons/icon-128.png']
];

async function buildTarget(target) {
  const outdir = path.resolve('dist', target);
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });

  await build({
    entryPoints: ENTRY_POINTS,
    outdir,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120', 'firefox140'],
    minify: false,
    sourcemap: false,
    legalComments: 'none'
  });

  for (const [srcRel, destRel] of STATIC_COPIES) {
    const srcPath = path.resolve(srcRel);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Missing required static file: ${srcRel}`);
    }
    const destPath = path.join(outdir, destRel);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }

  fs.writeFileSync(
    path.join(outdir, 'manifest.json'),
    JSON.stringify(createManifest(target), null, 2) + '\n'
  );
  console.log(`Built ${target} extension at dist/${target}`);
}

await buildTarget('chrome');
await buildTarget('firefox');
```

Write `scripts/package.mjs`:
```js
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const version = pkg.version;

for (const target of ['chrome', 'firefox']) {
  const dir = path.resolve('dist', target);
  const outZip = path.resolve('dist', `huji-key-${target}-v${version}.zip`);
  fs.rmSync(outZip, { force: true });
  execFileSync('zip', ['-r', outZip, '.', '-x', '*.DS_Store'], {
    cwd: dir,
    stdio: 'inherit'
  });
  console.log(`Created ${path.relative(process.cwd(), outZip)}`);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/build-icons.test.ts && npm run typecheck`
Expected: PASS (4 PNG files verified at 16, 32, 48, 128 and `tsc --noEmit` exits 0).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/core/types.ts scripts/ assets/icons/ tests/unit/build-icons.test.ts
git commit -m "chore: scaffold project, core types, PNG icons, and build scripts"
```

---

### Task 2: TOTP Engine, Base32 & `otpauth://` URI Parser

**Files:**
- Create: `src/core/totp.ts`
- Test: `tests/unit/totp.test.ts`

**Interfaces:**
- Consumes: `TotpAlgorithm` from `src/core/types.ts`
- Produces in `src/core/totp.ts`:
  - `normalizeBase32(input: string): string`
  - `decodeBase32(secret: string): Uint8Array`
  - `parseOtpAuthUri(uri: string): { totpSecret: string; issuer: string; label: string; digits: number; period: number; algorithm: TotpAlgorithm }`
  - `generateTotp(params: { secret: string; timestampMs?: number; digits?: number; period?: number; algorithm?: TotpAlgorithm }): Promise<string>`
  - `getTotpWindowInfo(timestampMs?: number, period?: number): { step: number; secondsRemaining: number; progress: number }`

- [ ] **Step 1: Write failing tests in `tests/unit/totp.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/totp.test.ts`
Expected: FAIL (`Cannot find module '../../src/core/totp'`).

- [ ] **Step 3: Implement `src/core/totp.ts`**

```ts
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
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/unit/totp.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/totp.ts tests/unit/totp.test.ts
git commit -m "feat: add RFC 6238 WebCrypto TOTP generator and otpauth parser"
```

---

### Task 3: Validation & Master Lock WebCrypto Module

**Files:**
- Create: `src/core/validation.ts`
- Create: `src/core/crypto.ts`
- Test: `tests/unit/validation.test.ts`
- Test: `tests/unit/crypto.test.ts`

**Interfaces:**
- Consumes: `PlainCredentials`, `EncryptedCredentialsEnvelope` from `src/core/types.ts`, `decodeBase32`, `normalizeBase32` from `src/core/totp.ts`
- Produces in `src/core/validation.ts`:
  - `validateIsraeliId(raw: string): { valid: boolean; normalized: string; checkDigitWarning: boolean; error?: 'format' }`
  - `validatePin4(raw: string): { valid: boolean; normalized: string; error?: 'format' }`
  - `validateSecret(raw: string): { valid: boolean; normalized: string; error?: 'format' }`
  - `formatCombinedOtp(pin4: string, totp: string): string`
- Produces in `src/core/crypto.ts`:
  - `isEncryptedEnvelope(value: unknown): value is EncryptedCredentialsEnvelope`
  - `encryptCredentials(creds: PlainCredentials, passphrase: string): Promise<EncryptedCredentialsEnvelope>`
  - `decryptCredentials(envelope: EncryptedCredentialsEnvelope, passphrase: string): Promise<PlainCredentials>`

- [ ] **Step 1: Write failing tests in `tests/unit/validation.test.ts` and `tests/unit/crypto.test.ts`**

Write `tests/unit/validation.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  formatCombinedOtp,
  validateIsraeliId,
  validatePin4,
  validateSecret
} from '../../src/core/validation';

describe('validation', () => {
  it('accepts valid 9-digit Israeli ID preserving leading zero', () => {
    expect(validateIsraeliId(' 012345674 ')).toEqual({
      valid: true,
      normalized: '012345674',
      checkDigitWarning: true
    });
    // Valid Israeli ID check digit (000000018)
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
```

Write `tests/unit/crypto.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/unit/validation.test.ts tests/unit/crypto.test.ts`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement `src/core/validation.ts` and `src/core/crypto.ts`**

Write `src/core/validation.ts`:
```ts
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
```

Write `src/core/crypto.ts`:
```ts
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
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/unit/validation.test.ts tests/unit/crypto.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/validation.ts src/core/crypto.ts tests/unit/validation.test.ts tests/unit/crypto.test.ts
git commit -m "feat: add credential validators and PBKDF2 AES-GCM master lock crypto"
```

---

### Task 4: Loop-Protection Guard & Moodle Keep-Alive Classifier

**Files:**
- Create: `src/core/loop-guard.ts`
- Create: `src/core/keepalive.ts`
- Test: `tests/unit/loop-guard.test.ts`
- Test: `tests/unit/keepalive.test.ts`

**Interfaces:**
- Consumes: `LoginAttemptGuard`, `SiteKey` from `src/core/types.ts`
- Produces in `src/core/loop-guard.ts`:
  - `EMPTY_LOGIN_GUARD: LoginAttemptGuard`
  - `extractAuthStateKey(urlString: string): string`
  - `evaluateAutoSubmitGuard(params: { guard: LoginAttemptGuard; hasPageError: boolean; authStateKey: string; nowMs?: number }): { allowed: boolean; reason?: 'page_error' | 'rate_limited' }`
  - `recordAutoSubmitAttempt(guard: LoginAttemptGuard, authStateKey: string, nowMs?: number): LoginAttemptGuard`
  - `resetAutoSubmitGuard(): LoginAttemptGuard`
- Produces in `src/core/keepalive.ts`:
  - `SITE_ORIGINS: Record<SiteKey, string>`
  - `siteKeyFromOrigin(originOrUrl: string): SiteKey | null`
  - `classifyKeepAliveResult(input: { status: number; type?: string; redirected?: boolean; url?: string; bodyText?: string; jsonPayload?: unknown }): { outcome: 'ok' | 'logged_out' | 'retry_get' | 'error'; sesskey?: string; reason?: string }`
  - `extractSesskeyFromHtml(html: string): string | undefined`

- [ ] **Step 1: Write failing tests in `tests/unit/loop-guard.test.ts` and `tests/unit/keepalive.test.ts`**

Write `tests/unit/loop-guard.test.ts`:
```ts
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
```

Write `tests/unit/keepalive.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  classifyKeepAliveResult,
  extractSesskeyFromHtml,
  siteKeyFromOrigin
} from '../../src/core/keepalive';

describe('Moodle keep-alive classifier', () => {
  it('maps HUJI Moodle origins to site keys', () => {
    expect(siteKeyFromOrigin('https://moodle.huji.ac.il/2026-27/my/')).toBe('moodle');
    expect(siteKeyFromOrigin('https://moodle2.cs.huji.ac.il/course/view.php')).toBe('csMoodle');
    expect(siteKeyFromOrigin('https://example.com')).toBeNull();
  });

  it('detects opaqueredirect or SAML redirect as logged_out', () => {
    expect(classifyKeepAliveResult({ status: 0, type: 'opaqueredirect' }).outcome).toBe('logged_out');
    expect(
      classifyKeepAliveResult({
        status: 200,
        redirected: true,
        url: 'https://idp.cc.huji.ac.il/simplesaml/module.php/hujicc/login'
      }).outcome
    ).toBe('logged_out');
  });

  it('recognizes core_session_touch success JSON', () => {
    expect(
      classifyKeepAliveResult({
        status: 200,
        jsonPayload: [{ error: false, data: true }]
      }).outcome
    ).toBe('ok');
  });

  it('triggers fallback GET when sesskey is invalid', () => {
    expect(
      classifyKeepAliveResult({
        status: 200,
        jsonPayload: [{ error: true, exception: { errorcode: 'invalidsesskey' } }]
      }).outcome
    ).toBe('retry_get');
  });

  it('flags servicerequireslogin JSON as logged_out', () => {
    expect(
      classifyKeepAliveResult({
        status: 200,
        jsonPayload: [{ error: true, exception: { errorcode: 'servicerequireslogin' } }]
      }).outcome
    ).toBe('logged_out');
  });

  it('extracts sesskey from Moodle HTML and confirms ok', () => {
    const html = '<a href="https://moodle.huji.ac.il/2026-27/login/logout.php?sesskey=AbCdEf1234">Log out</a>';
    expect(extractSesskeyFromHtml(html)).toBe('AbCdEf1234');
    expect(
      classifyKeepAliveResult({
        status: 200,
        url: 'https://moodle.huji.ac.il/2026-27/my/',
        bodyText: html
      })
    ).toEqual({ outcome: 'ok', sesskey: 'AbCdEf1234' });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/unit/loop-guard.test.ts tests/unit/keepalive.test.ts`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement `src/core/loop-guard.ts` and `src/core/keepalive.ts`**

Write `src/core/loop-guard.ts`:
```ts
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
```

Write `src/core/keepalive.ts`:
```ts
import type { SiteKey } from './types';

export const SITE_ORIGINS: Record<SiteKey, string> = {
  moodle: 'https://moodle.huji.ac.il',
  csMoodle: 'https://moodle2.cs.huji.ac.il'
};

export function siteKeyFromOrigin(originOrUrl: string): SiteKey | null {
  try {
    const { origin } = new URL(originOrUrl);
    if (origin === SITE_ORIGINS.moodle) return 'moodle';
    if (origin === SITE_ORIGINS.csMoodle) return 'csMoodle';
    return null;
  } catch {
    return null;
  }
}

export function extractSesskeyFromHtml(html: string): string | undefined {
  const logoutMatch = html.match(/logout\.php\?[^"']*sesskey=([A-Za-z0-9]+)/);
  if (logoutMatch?.[1]) return logoutMatch[1];
  const cfgMatch = html.match(/"sesskey"\s*:\s*"([A-Za-z0-9]+)"/);
  return cfgMatch?.[1];
}

export function classifyKeepAliveResult(input: {
  status: number;
  type?: string;
  redirected?: boolean;
  url?: string;
  bodyText?: string;
  jsonPayload?: unknown;
}): { outcome: 'ok' | 'logged_out' | 'retry_get' | 'error'; sesskey?: string; reason?: string } {
  if (input.type === 'opaqueredirect' || (input.status >= 300 && input.status < 400)) {
    return { outcome: 'logged_out', reason: 'redirected' };
  }

  if (input.url) {
    const lowerUrl = input.url.toLowerCase();
    if (lowerUrl.includes('idp.cc.huji.ac.il') || lowerUrl.includes('/login/')) {
      return { outcome: 'logged_out', reason: 'login_url' };
    }
  }

  if (Array.isArray(input.jsonPayload) && input.jsonPayload.length > 0) {
    const first = input.jsonPayload[0] as {
      error?: boolean;
      exception?: { errorcode?: string };
    };
    if (first?.error) {
      const code = first.exception?.errorcode ?? '';
      if (code === 'servicerequireslogin') {
        return { outcome: 'logged_out', reason: code };
      }
      if (code === 'invalidsesskey') {
        return { outcome: 'retry_get', reason: code };
      }
      return { outcome: 'retry_get', reason: code || 'ajax_error' };
    }
    return { outcome: 'ok' };
  }

  if (input.status >= 200 && input.status < 300) {
    const body = input.bodyText ?? '';
    if (body.includes('id="login"') || body.includes('idp.cc.huji.ac.il/simplesaml')) {
      return { outcome: 'logged_out', reason: 'login_markup' };
    }
    const sesskey = extractSesskeyFromHtml(body);
    return { outcome: 'ok', sesskey };
  }

  return { outcome: 'error', reason: `http_${input.status}` };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/unit/loop-guard.test.ts tests/unit/keepalive.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/loop-guard.ts src/core/keepalive.ts tests/unit/loop-guard.test.ts tests/unit/keepalive.test.ts
git commit -m "feat: add auto-submit loop guard and Moodle keep-alive classifier"
```

---

### Task 5: Trilingual i18n Dictionary (EN / HE / AR) & Direction Helpers

**Files:**
- Create: `src/core/i18n.ts`
- Test: `tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: `Language` from `src/core/types.ts`
- Produces in `src/core/i18n.ts`:
  - `MESSAGES` (compile-time complete for `'en'`, `'he'`, `'ar'`)
  - `MessageKey`
  - `getDirection(lang: Language): 'ltr' | 'rtl'`
  - `t(lang: Language, key: MessageKey, vars?: Record<string, string | number>): string`
  - `applyDocumentLocale(doc: Document, lang: Language): void`

- [ ] **Step 1: Write failing test `tests/unit/i18n.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { applyDocumentLocale, getDirection, MESSAGES, t } from '../../src/core/i18n';

describe('trilingual i18n', () => {
  it('has identical non-empty keys across EN, HE, and AR', () => {
    const enKeys = Object.keys(MESSAGES.en).sort();
    const heKeys = Object.keys(MESSAGES.he).sort();
    const arKeys = Object.keys(MESSAGES.ar).sort();

    expect(heKeys).toEqual(enKeys);
    expect(arKeys).toEqual(enKeys);

    for (const lang of ['en', 'he', 'ar'] as const) {
      for (const key of enKeys) {
        const val = MESSAGES[lang][key as keyof typeof MESSAGES.en];
        expect(val.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('interpolates template placeholders cleanly', () => {
    expect(t('en', 'idpWaitingFreshCode', { seconds: 2 })).toContain('2');
    expect(t('he', 'idpWaitingFreshCode', { seconds: 2 })).toContain('2');
    expect(t('ar', 'idpWaitingFreshCode', { seconds: 2 })).toContain('2');
  });

  it('returns correct writing directions and applies document locale', () => {
    expect(getDirection('en')).toBe('ltr');
    expect(getDirection('he')).toBe('rtl');
    expect(getDirection('ar')).toBe('rtl');

    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    applyDocumentLocale(dom.window.document, 'ar');
    expect(dom.window.document.documentElement.lang).toBe('ar');
    expect(dom.window.document.documentElement.dir).toBe('rtl');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/unit/i18n.test.ts`
Expected: FAIL (`Cannot find module '../../src/core/i18n'`).

- [ ] **Step 3: Implement `src/core/i18n.ts`**

```ts
import type { Language } from './types';

const en = {
  appName: 'HUJI Key',
  appSubtitle: 'Local Auto-OTP & Moodle Keep-Alive',
  unofficialNotice: 'Unofficial student-built tool · 100% local on this device',
  langLabel: 'Language',
  openSettings: 'Setup & Settings',
  liveOtpHeading: 'Current Code',
  copyOtp6: 'Copy 6-digit OTP',
  copyPinOtp: 'Copy PIN + OTP',
  copied: 'Copied!',
  secondsLeft: '{seconds}s',
  idSummary: 'ID {id9}',
  pinSummary: 'PIN {pin4}',
  setupRequiredTitle: 'Set up in 30 seconds',
  setupRequiredDesc: 'Import directly from gauth.huji.ac.il, upload a QR screenshot, paste an otpauth:// link, or enter manually.',
  openSetupBtn: 'Open Setup',
  captureGauthBtn: 'Capture from open gauth tab',
  captureNoGauthTab: 'Open gauth.huji.ac.il first, display your QR code, then try again.',
  captureNoQrFound: 'No QR code detected on the open gauth.huji.ac.il tab. Click "Show QR" on the page first.',
  lockedTitle: 'Credentials Locked',
  lockedDesc: 'Enter your Master Passphrase to unlock auto-login for this browser session.',
  passphraseLabel: 'Master Passphrase',
  unlockBtn: 'Unlock',
  lockNowBtn: 'Lock Now',
  wrongPassphrase: 'Incorrect passphrase. Please try again.',
  controlsHeading: 'Login Automation',
  autoFillToggle: 'Auto-fill ID & OTP',
  autoSubmitToggle: 'Safe auto-submit',
  keepAliveHeading: 'Moodle Keep-Alive',
  moodleMainLabel: 'Moodle (moodle.huji.ac.il)',
  moodleCsLabel: 'CS Moodle (moodle2.cs.huji.ac.il)',
  statusOk: 'Active',
  statusLoggedOut: 'Logged out · paused',
  statusPaused: 'Paused',
  statusError: 'Network retry pending',
  statusNever: 'Waiting for Moodle visit',
  lastRefreshed: 'refreshed {time}',
  pingNow: 'Refresh now',
  openMoodle: 'Open Moodle',
  optionsTitle: 'HUJI Key — Setup & Settings',
  onboardingHeading: '1. Connect Your HUJI OTP',
  tabGauth: 'gauth.huji.ac.il',
  tabQrImage: 'QR Image',
  tabUri: 'otpauth:// Link',
  tabManual: 'Manual Entry',
  gauthStepInstructions: 'Open gauth.huji.ac.il, click "Show QR", then click Scan Open Tab below — or click the Save button directly on that page.',
  scanOpenGauthTab: 'Scan Open gauth.huji.ac.il Tab',
  qrDropLabel: 'Upload, drop, or paste (Ctrl/Cmd+V) a QR screenshot',
  qrSelectFile: 'Choose Image',
  qrInvalidImage: 'Could not find a readable TOTP QR code in that image.',
  uriInputLabel: 'Paste otpauth://totp/... Link',
  uriPlaceholder: 'otpauth://totp/HUJI:123456789?secret=...',
  uriParseBtn: 'Load Link',
  uriInvalid: 'Invalid otpauth://totp link. Make sure it starts with otpauth://totp/ and includes a secret.',
  idInputLabel: 'HUJI ID Number (9 digits)',
  idInputHint: 'Exactly 9 digits including leading zeros.',
  idInputError: 'Error: Enter exactly 9 numeric digits.',
  idCheckDigitWarn: 'Note: Check digit differs from a standard Israeli ID (saved anyway if international/passport ID).',
  pinInputLabel: 'Fixed 4-Digit PIN',
  pinInputHint: 'The 4-digit code shown next to your QR on gauth.huji.ac.il.',
  pinInputError: 'Error: Enter exactly 4 numeric digits.',
  secretInputLabel: 'Base32 TOTP Secret',
  secretInputHint: 'Letters A–Z and digits 2–7 (spaces are cleaned automatically).',
  secretInputError: 'Error: Enter a valid Base32 secret (at least 8 valid characters).',
  previewHeading: 'Live Verification Preview',
  previewHint: 'Verify this 6-digit code matches your authenticator or gauth.huji.ac.il before saving.',
  previewWaiting: 'Enter or import a secret to preview the live 6-digit code.',
  saveCredentialsBtn: 'Save Credentials Locally',
  savedBanner: 'Saved locally! Auto-login is ready.',
  importedBanner: 'Imported QR secret — confirm your 9-digit ID & 4-digit PIN, then save.',
  securityHeading: '2. Privacy & Master Lock',
  privacySummary: 'Zero servers, zero analytics, zero cloud sync. Permissions are locked strictly to HUJI login, gauth, and Moodle domains.',
  masterLockToggle: 'Protect saved credentials with Master Passphrase',
  newPassphraseLabel: 'New Passphrase (min 4 chars)',
  confirmPassphraseLabel: 'Confirm Passphrase',
  passphraseMismatch: 'Error: Passphrases do not match.',
  passphraseTooShort: 'Error: Passphrase must be at least 4 characters.',
  applyLockBtn: 'Enable Master Lock',
  disableLockPassphrasePrompt: 'Enter current passphrase to remove Master Lock',
  disableLockBtn: 'Disable Master Lock',
  lockUpdated: 'Master Lock settings updated.',
  keepAliveSettingsHeading: '3. Moodle Keep-Alive & Safety',
  intervalLabel: 'Background refresh interval',
  interval10: 'Every 10 minutes',
  interval15: 'Every 15 minutes (recommended)',
  interval20: 'Every 20 minutes',
  resetGuardBtn: 'Reset Auto-Submit Pause',
  guardResetDone: 'Auto-submit loop guard cleared.',
  dangerHeading: '4. Local Data Control',
  wipeDataBtn: 'Delete All Stored Data',
  wipeDialogTitle: 'Delete all HUJI Key data?',
  wipeDialogDesc: 'This permanently removes your saved ID, 4-digit PIN, TOTP secret, and preferences from this browser.',
  cancelBtn: 'Cancel',
  confirmWipeBtn: 'Delete Everything',
  wipedDone: 'All local data deleted.',
  idpBadgeFilled: 'HUJI Key: Filled ID + OTP ({seconds}s)',
  idpBadgeSubmitting: 'HUJI Key: Submitting OTP…',
  idpBadgeWaitingFresh: 'HUJI Key: Fresh code in {seconds}s…',
  idpBadgeLocked: 'HUJI Key: Locked — click toolbar icon to unlock',
  idpBadgeUnconfigured: 'HUJI Key: Not configured yet',
  idpBadgePaused: 'HUJI Key: Auto-submit paused after error/retry',
  idpRetryBtn: 'Fill & Retry Once',
  idpOpenSetupBtn: 'Set up',
  gauthBannerFound: 'HUJI Key detected your OTP QR code',
  gauthBannerPinHint: 'Detected PIN {pin4}',
  gauthBannerSaveBtn: 'Import to HUJI Key',
  gauthBannerDismiss: 'Dismiss'
} as const;

export type MessageKey = keyof typeof en;

const he: Record<MessageKey, string> = {
  appName: 'HUJI Key',
  appSubtitle: 'הזנת OTP אוטומטית ושמירת חיבור למודל',
  unofficialNotice: 'כלי סטודנטיאלי לא רשמי · נשמר מקומית בלבד במכשיר שלך',
  langLabel: 'שפה',
  openSettings: 'הגדרה ואפשרויות',
  liveOtpHeading: 'קוד נוכחי',
  copyOtp6: 'העתק קוד 6 ספרות',
  copyPinOtp: 'העתק PIN + OTP',
  copied: 'הועתק!',
  secondsLeft: '{seconds} שנ׳',
  idSummary: 'ת"ז {id9}',
  pinSummary: 'קוד {pin4}',
  setupRequiredTitle: 'הגדרה ב-30 שניות',
  setupRequiredDesc: 'ייבוא ישיר מ-gauth.huji.ac.il, העלאת תמונת QR, הדבקת קישור otpauth:// או הזנה ידנית.',
  openSetupBtn: 'פתיחת הגדרה',
  captureGauthBtn: 'לכידה מלשונית gauth פתוחה',
  captureNoGauthTab: 'פתח תחילה את gauth.huji.ac.il, הצג את קוד ה-QR ונסה שוב.',
  captureNoQrFound: 'לא זוהה קוד QR בלשונית gauth.huji.ac.il. לחץ קודם על "הצג QR".',
  lockedTitle: 'הפרטים נעולים',
  lockedDesc: 'הזן סיסמת מאסטר כדי לפתוח את ההזנה האוטומטית לסשן הדפדפן הנוכחי.',
  passphraseLabel: 'סיסמת מאסטר',
  unlockBtn: 'פתח נעילה',
  lockNowBtn: 'נעל כעת',
  wrongPassphrase: 'סיסמה שגויה. נסה שוב.',
  controlsHeading: 'אוטומציית התחברות',
  autoFillToggle: 'מילוי אוטומטי של ת"ז ו-OTP',
  autoSubmitToggle: 'שליחה אוטומטית בטוחה',
  keepAliveHeading: 'שמירת חיבור למודל',
  moodleMainLabel: 'מודל ראשי (moodle.huji.ac.il)',
  moodleCsLabel: 'מודל מדמ"ח (moodle2.cs.huji.ac.il)',
  statusOk: 'פעיל',
  statusLoggedOut: 'מנותק · מושהה',
  statusPaused: 'מושהה',
  statusError: 'ממתין לניסיון חוזר',
  statusNever: 'ממתין לכניסה למודל',
  lastRefreshed: 'רוענן לפני {time}',
  pingNow: 'רענן כעת',
  openMoodle: 'פתח מודל',
  optionsTitle: 'HUJI Key — הגדרה ואפשרויות',
  onboardingHeading: '1. חיבור ה-OTP של האוניברסיטה',
  tabGauth: 'gauth.huji.ac.il',
  tabQrImage: 'תמונת QR',
  tabUri: 'קישור otpauth://',
  tabManual: 'הזנה ידנית',
  gauthStepInstructions: 'פתח את gauth.huji.ac.il, לחץ על "הצג QR", ואז לחץ למטה על סריקת לשונית — או על כפתור הייבוא שעל הדף.',
  scanOpenGauthTab: 'סרוק לשונית gauth.huji.ac.il פתוחה',
  qrDropLabel: 'העלה, גרור או הדבק (Ctrl/Cmd+V) צילום מסך של QR',
  qrSelectFile: 'בחר תמונה',
  qrInvalidImage: 'לא נמצא קוד TOTP QR תקין בתמונה זו.',
  uriInputLabel: 'הדבק קישור otpauth://totp/...',
  uriPlaceholder: 'otpauth://totp/HUJI:123456789?secret=...',
  uriParseBtn: 'טען קישור',
  uriInvalid: 'קישור otpauth://totp לא תקין. ודא שהוא מתחיל ב-otpauth://totp/ ומכיל secret.',
  idInputLabel: 'מספר זהות (9 ספרות)',
  idInputHint: 'בדיוק 9 ספרות כולל אפסים מובילים.',
  idInputError: 'שגיאה: הזן בדיוק 9 ספרות.',
  idCheckDigitWarn: 'שימו לב: ספרת הביקורת אינה תואמת ת"ז ישראלית (יישמר בכל מקרה עבור דרכון/סטודנט חו"ל).',
  pinInputLabel: 'קוד קבוע בן 4 ספרות',
  pinInputHint: 'הקוד בן 4 הספרות שמופיע ליד ה-QR ב-gauth.huji.ac.il.',
  pinInputError: 'שגיאה: הזן בדיוק 4 ספרות.',
  secretInputLabel: 'מפתח סודי (Base32)',
  secretInputHint: 'אותיות A–Z וספרות 2–7 (רווחים מנוקים אוטומטית).',
  secretInputError: 'שגיאה: הזן מפתח Base32 תקין (לפחות 8 תווים תקינים).',
  previewHeading: 'תצוגה מקדימה לאימות',
  previewHint: 'ודא שהקוד בן 6 הספרות תואם ל-gauth.huji.ac.il או לאפליקציה לפני השמירה.',
  previewWaiting: 'הזן או ייבא מפתח סודי כדי לראות קוד חי.',
  saveCredentialsBtn: 'שמור מקומית בדפדפן',
  savedBanner: 'נשמר מקומית! ההתחברות האוטומטית מוכנה.',
  importedBanner: 'ה-QR יובא — ודא ת"ז (9 ספרות) וקוד (4 ספרות) ולחץ שמירה.',
  securityHeading: '2. פרטיות ונעילת מאסטר',
  privacySummary: 'ללא שרתים, ללא איסוף מידע וללא סנכרון ענן. ההרשאות מוגבלות אך ורק ל-IdP, gauth ומודל של HUJI.',
  masterLockToggle: 'הגן על הפרטים השמורים עם סיסמת מאסטר',
  newPassphraseLabel: 'סיסמה חדשה (לפחות 4 תווים)',
  confirmPassphraseLabel: 'אימות סיסמה',
  passphraseMismatch: 'שגיאה: הסיסמאות אינן תואמות.',
  passphraseTooShort: 'שגיאה: הסיסמה חייבת להכיל לפחות 4 תווים.',
  applyLockBtn: 'הפעל נעילת מאסטר',
  disableLockPassphrasePrompt: 'הזן סיסמה נוכחית לביטול הנעילה',
  disableLockBtn: 'בטל נעילת מאסטר',
  lockUpdated: 'הגדרות הנעילה עודכנו.',
  keepAliveSettingsHeading: '3. שמירת חיבור ובטיחות',
  intervalLabel: 'תדירות רענון ברקע',
  interval10: 'כל 10 דקות',
  interval15: 'כל 15 דקות (מומלץ)',
  interval20: 'כל 20 דקות',
  resetGuardBtn: 'אפס השהיית שליחה אוטומטית',
  guardResetDone: 'מנגנון ההגנה מלולאה אופס.',
  dangerHeading: '4. ניהול נתונים מקומיים',
  wipeDataBtn: 'מחק את כל הנתונים השמורים',
  wipeDialogTitle: 'למחוק את כל הנתונים של HUJI Key?',
  wipeDialogDesc: 'פעולה זו תמחק לצמיתות מהדפדפן את הת"ז, הקוד בן 4 הספרות, המפתח הסודי וההגדרות.',
  cancelBtn: 'ביטול',
  confirmWipeBtn: 'מחק הכל',
  wipedDone: 'כל הנתונים המקומיים נמחקו.',
  idpBadgeFilled: 'HUJI Key: ת"ז ו-OTP מולאו ({seconds} שנ׳)',
  idpBadgeSubmitting: 'HUJI Key: שולח התחברות…',
  idpBadgeWaitingFresh: 'HUJI Key: קוד חדש בעוד {seconds} שנ׳…',
  idpBadgeLocked: 'HUJI Key: נעול — לחץ על אייקון התוסף לשחרור',
  idpBadgeUnconfigured: 'HUJI Key: טרם הוגדר',
  idpBadgePaused: 'HUJI Key: השליחה הושהתה לאחר שגיאה',
  idpRetryBtn: 'מלא ונסה שוב פעם אחת',
  idpOpenSetupBtn: 'הגדר',
  gauthBannerFound: 'HUJI Key זיהה את קוד ה-QR שלך',
  gauthBannerPinHint: 'זוהה קוד {pin4}',
  gauthBannerSaveBtn: 'ייבא ל-HUJI Key',
  gauthBannerDismiss: 'סגור'
};

const ar: Record<MessageKey, string> = {
  appName: 'HUJI Key',
  appSubtitle: 'تعبئة OTP تلقائيًا وإبقاء جلسة مودل نشطة',
  unofficialNotice: 'أداة طلابية غير رسمية · محفوظة محليًا على جهازك فقط',
  langLabel: 'اللغة',
  openSettings: 'الإعداد والضبط',
  liveOtpHeading: 'الرمز الحالي',
  copyOtp6: 'نسخ رمز 6 أرقام',
  copyPinOtp: 'نسخ PIN + OTP',
  copied: 'تم النسخ!',
  secondsLeft: '{seconds} ث',
  idSummary: 'هوية {id9}',
  pinSummary: 'رمز {pin4}',
  setupRequiredTitle: 'إعداد خلال 30 ثانية',
  setupRequiredDesc: 'استورد مباشرة من gauth.huji.ac.il، ارفع لقطة QR، ألصق رابط otpauth:// أو أدخل البيانات يدويًا.',
  openSetupBtn: 'فتح الإعداد',
  captureGauthBtn: 'التقاط من تبويب gauth المفتوح',
  captureNoGauthTab: 'افتح gauth.huji.ac.il أولاً، اعرض رمز QR، ثم أعد المحاولة.',
  captureNoQrFound: 'لم يتم العثور على رمز QR في تبويب gauth.huji.ac.il. اضغط "Show QR" أولاً.',
  lockedTitle: 'البيانات مقفلة',
  lockedDesc: 'أدخل كلمة المرور الرئيسية لفتح التعبئة التلقائية لهذه الجلسة.',
  passphraseLabel: 'كلمة المرور الرئيسية',
  unlockBtn: 'فتح القفل',
  lockNowBtn: 'قفل الآن',
  wrongPassphrase: 'كلمة المرور غير صحيحة. حاول مجددًا.',
  controlsHeading: 'أتمتة تسجيل الدخول',
  autoFillToggle: 'تعبئة الهوية ورمز OTP تلقائيًا',
  autoSubmitToggle: 'إرسال آمن تلقائي',
  keepAliveHeading: 'إبقاء جلسة مودل نشطة',
  moodleMainLabel: 'مودل الرئيسي (moodle.huji.ac.il)',
  moodleCsLabel: 'مودل الحاسوب (moodle2.cs.huji.ac.il)',
  statusOk: 'نشط',
  statusLoggedOut: 'مسجل خروج · متوقف مؤقتًا',
  statusPaused: 'متوقف مؤقتًا',
  statusError: 'بانتظار إعادة المحاولة',
  statusNever: 'بانتظار زيارة مودل',
  lastRefreshed: 'حُدّث منذ {time}',
  pingNow: 'تحديث الآن',
  openMoodle: 'فتح مودل',
  optionsTitle: 'HUJI Key — الإعداد والضبط',
  onboardingHeading: '1. ربط رمز OTP الجامعي',
  tabGauth: 'gauth.huji.ac.il',
  tabQrImage: 'صورة QR',
  tabUri: 'رابط otpauth://',
  tabManual: 'إدخال يدوي',
  gauthStepInstructions: 'افتح gauth.huji.ac.il واضغط "Show QR"، ثم اضغط مسح التبويب المفتوح أدناه — أو زر الاستيراد الظاهر في الصفحة.',
  scanOpenGauthTab: 'مسح تبويب gauth.huji.ac.il المفتوح',
  qrDropLabel: 'ارفع أو اسحب أو ألصق (Ctrl/Cmd+V) لقطة شاشة QR',
  qrSelectFile: 'اختر صورة',
  qrInvalidImage: 'تعذر العثور على رمز TOTP QR صالح في هذه الصورة.',
  uriInputLabel: 'ألصق رابط otpauth://totp/...',
  uriPlaceholder: 'otpauth://totp/HUJI:123456789?secret=...',
  uriParseBtn: 'تحميل الرابط',
  uriInvalid: 'رابط otpauth://totp غير صالح. تأكد أنه يبدأ بـ otpauth://totp/ ويحتوي على secret.',
  idInputLabel: 'رقم الهوية (9 أرقام)',
  idInputHint: '9 أرقام بالضبط بما فيها الأصفار البادئة.',
  idInputError: 'خطأ: أدخل 9 أرقام بالضبط.',
  idCheckDigitWarn: 'ملاحظة: رقم التحقق يختلف عن الهوية الإسرائيلية القياسية (سيُحفظ إذا كان رقم جواز/دولي).',
  pinInputLabel: 'الرمز الثابت (4 أرقام)',
  pinInputHint: 'الرمز المكون من 4 أرقام الظاهر بجانب QR في gauth.huji.ac.il.',
  pinInputError: 'خطأ: أدخل 4 أرقام بالضبط.',
  secretInputLabel: 'المفتاح السري (Base32)',
  secretInputHint: 'حروف A–Z وأرقام 2–7 (تُزال المسافات تلقائيًا).',
  secretInputError: 'خطأ: أدخل مفتاح Base32 صالحًا (8 أحرف صالحة على الأقل).',
  previewHeading: 'معاينة حية للتحقق',
  previewHint: 'تأكد من تطابق الرمز السداسي مع gauth.huji.ac.il أو تطبيق المصادقة قبل الحفظ.',
  previewWaiting: 'أدخل أو استورد المفتاح السري لمعاينة الرمز الحي.',
  saveCredentialsBtn: 'حفظ البيانات محليًا',
  savedBanner: 'تم الحفظ محليًا! الدخول التلقائي جاهز.',
  importedBanner: 'تم استيراد سر QR — تأكد من الهوية (9 أرقام) والرمز (4 أرقام) ثم احفظ.',
  securityHeading: '2. الخصوصية والقفل الرئيسي',
  privacySummary: 'بلا خوادم، بلا تتبع، وبلا مزامنة سحابية. الصلاحيات محصورة فقط بنطاقات HUJI للدخول وgauth ومودل.',
  masterLockToggle: 'حماية البيانات المحفوظة بكلمة مرور رئيسية',
  newPassphraseLabel: 'كلمة مرور جديدة (4 أحرف على الأقل)',
  confirmPassphraseLabel: 'تأكيد كلمة المرور',
  passphraseMismatch: 'خطأ: كلمتا المرور غير متطابقتين.',
  passphraseTooShort: 'خطأ: يجب أن تتكون كلمة المرور من 4 أحرف على الأقل.',
  applyLockBtn: 'تفعيل القفل الرئيسي',
  disableLockPassphrasePrompt: 'أدخل كلمة المرور الحالية لإلغاء القفل',
  disableLockBtn: 'تعطيل القفل الرئيسي',
  lockUpdated: 'تم تحديث إعدادات القفل.',
  keepAliveSettingsHeading: '3. إبقاء مودل نشطًا والأمان',
  intervalLabel: 'فترة التحديث في الخلفية',
  interval10: 'كل 10 دقائق',
  interval15: 'كل 15 دقيقة (موصى به)',
  interval20: 'كل 20 دقيقة',
  resetGuardBtn: 'إعادة ضبط إيقاف الإرسال التلقائي',
  guardResetDone: 'تمت إعادة ضبط حماية التكرار.',
  dangerHeading: '4. التحكم بالبيانات المحلية',
  wipeDataBtn: 'حذف جميع البيانات المحفوظة',
  wipeDialogTitle: 'حذف جميع بيانات HUJI Key؟',
  wipeDialogDesc: 'سيؤدي هذا إلى مسح الهوية والرمز الثابت والمفتاح السري والإعدادات نهائيًا من هذا المتصفح.',
  cancelBtn: 'إلغاء',
  confirmWipeBtn: 'حذف الكل',
  wipedDone: 'تم مسح جميع البيانات المحلية.',
  idpBadgeFilled: 'HUJI Key: تم ملء الهوية وOTP ({seconds} ث)',
  idpBadgeSubmitting: 'HUJI Key: جارٍ تسجيل الدخول…',
  idpBadgeWaitingFresh: 'HUJI Key: رمز جديد خلال {seconds} ث…',
  idpBadgeLocked: 'HUJI Key: مقفل — اضغط أيقونة الإضافة لفتح القفل',
  idpBadgeUnconfigured: 'HUJI Key: غير مُعد بعد',
  idpBadgePaused: 'HUJI Key: توقف الإرسال التلقائي بعد خطأ',
  idpRetryBtn: 'تعبئة ومحاولة مرة واحدة',
  idpOpenSetupBtn: 'إعداد',
  gauthBannerFound: 'اكتشف HUJI Key رمز QR الخاص بك',
  gauthBannerPinHint: 'تم اكتشاف الرمز {pin4}',
  gauthBannerSaveBtn: 'استيراد إلى HUJI Key',
  gauthBannerDismiss: 'إغلاق'
};

export const MESSAGES: Record<Language, Record<MessageKey, string>> = { en, he, ar };

export function getDirection(lang: Language): 'ltr' | 'rtl' {
  return lang === 'en' ? 'ltr' : 'rtl';
}

export function t(
  lang: Language,
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  const dict = MESSAGES[lang] ?? MESSAGES.en;
  let template = dict[key] ?? MESSAGES.en[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      template = template.replaceAll(`{${k}}`, String(v));
    }
  }
  return template;
}

export function applyDocumentLocale(doc: Document, lang: Language): void {
  doc.documentElement.lang = lang;
  doc.documentElement.dir = getDirection(lang);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/unit/i18n.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/i18n.ts tests/unit/i18n.test.ts
git commit -m "feat: add compile-checked EN/HE/AR i18n dictionary and RTL helpers"
```

---

### Task 6: Cross-Browser Wrapper, Storage Accessors & Local QR Decoder

**Files:**
- Create: `src/shared/browser.ts`
- Create: `src/shared/storage.ts`
- Create: `src/shared/qr.ts`
- Test: `tests/unit/storage.test.ts`

**Interfaces:**
- Consumes: `ExtensionSettings`, `KeepAliveStates`, `LoginAttemptGuard`, `PendingGauthImport`, `StoredCredentials` from `src/core/types.ts`, `EMPTY_LOGIN_GUARD` from `src/core/loop-guard.ts`, `jsQR` from `jsqr`
- Produces in `src/shared/browser.ts`: `ext` (`storage`, `runtime`, `tabs`, `alarms`)
- Produces in `src/shared/storage.ts`:
  - `DEFAULT_SETTINGS: ExtensionSettings`
  - `DEFAULT_KEEPALIVE_STATES: KeepAliveStates`
  - `getStoredCredentials()`, `setStoredCredentials(c)`, `getSettings()`, `updateSettings(patch)`, `getKeepAliveStates()`, `updateKeepAliveSiteState(site, patch)`, `getUnlockedCredentials()`, `setUnlockedCredentials(c)`, `getLoginGuard()`, `setLoginGuard(g)`, `getPendingGauthImport()`, `setPendingGauthImport(p)`, `clearAllData()`
- Produces in `src/shared/qr.ts`:
  - `decodeQrFromImageData(data: Uint8ClampedArray, width: number, height: number): string | null`
  - `decodeQrFromBlob(blob: Blob): Promise<string | null>`
  - `decodeQrFromElement(el: HTMLImageElement | HTMLCanvasElement | SVGSVGElement): Promise<string | null>`

- [ ] **Step 1: Write failing tests in `tests/unit/storage.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { decodeQrFromImageData } from '../../src/shared/qr';
import {
  clearAllData,
  DEFAULT_SETTINGS,
  getKeepAliveStates,
  getSettings,
  updateKeepAliveSiteState,
  updateSettings
} from '../../src/shared/storage';

function makeMemoryStorage() {
  let store: Record<string, unknown> = {};
  return {
    async get(keys?: string | string[] | null) {
      if (!keys) return { ...store };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) {
        if (k in store) out[k] = store[k];
      }
      return out;
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, items);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        delete store[k];
      }
    },
    async clear() {
      store = {};
    }
  };
}

describe('storage layer & local QR decoder', () => {
  beforeEach(() => {
    const local = makeMemoryStorage();
    const session = makeMemoryStorage();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local, session, onChanged: { addListener: () => {} } },
      runtime: { sendMessage: async () => ({}) },
      alarms: { create: async () => {}, clear: async () => {} },
      tabs: { query: async () => [] }
    };
  });

  it('returns default settings and updates them cleanly', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    const updated = await updateSettings({ language: 'he', keepAliveCsMoodle: true });
    expect(updated.language).toBe('he');
    expect(updated.keepAliveCsMoodle).toBe(true);
    expect(updated.autoFill).toBe(true);
  });

  it('updates keep-alive site states and clears all data', async () => {
    await updateKeepAliveSiteState('moodle', { status: 'ok', lastPingAt: 1234 });
    const states = await getKeepAliveStates();
    expect(states.moodle.status).toBe('ok');
    expect(states.moodle.lastPingAt).toBe(1234);

    await clearAllData();
    expect((await getKeepAliveStates()).moodle.status).toBe('never');
  });

  it('decodes QR payload from RGBA ImageData using jsQR', () => {
    const uri = 'otpauth://totp/HUJI:000000018?secret=JBSWY3DPEHPK3PXP&issuer=HUJI';
    const qr = QRCode.create(uri, { errorCorrectionLevel: 'M' });
    const modules = qr.modules.size;
    const scale = 4;
    const margin = 4 * scale;
    const width = modules * scale + margin * 2;
    const rgba = new Uint8ClampedArray(width * width * 4).fill(255);

    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        if (!qr.modules.get(r, c)) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = margin + c * scale + dx;
            const y = margin + r * scale + dy;
            const idx = (y * width + x) * 4;
            rgba[idx] = 0;
            rgba[idx + 1] = 0;
            rgba[idx + 2] = 0;
          }
        }
      }
    }

    expect(decodeQrFromImageData(rgba, width, width)).toBe(uri);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/unit/storage.test.ts`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement `src/shared/browser.ts`, `src/shared/storage.ts`, and `src/shared/qr.ts`**

Write `src/shared/browser.ts`:
```ts
type BrowserGlobal = typeof chrome;

function getApi(): BrowserGlobal {
  const g = globalThis as unknown as { browser?: BrowserGlobal; chrome?: BrowserGlobal };
  if (g.browser?.storage && g.browser?.runtime) return g.browser;
  if (g.chrome) return g.chrome;
  throw new Error('WebExtension runtime API unavailable');
}

export const ext = {
  get storage() {
    return getApi().storage;
  },
  get runtime() {
    return getApi().runtime;
  },
  get alarms() {
    return getApi().alarms;
  },
  get tabs() {
    return getApi().tabs;
  }
};
```

Write `src/shared/storage.ts`:
```ts
import { EMPTY_LOGIN_GUARD } from '../core/loop-guard';
import type {
  ExtensionSettings,
  KeepAliveSiteState,
  KeepAliveStates,
  LoginAttemptGuard,
  PendingGauthImport,
  PlainCredentials,
  SiteKey,
  StoredCredentials
} from '../core/types';
import { ext } from './browser';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  language: 'en',
  autoFill: true,
  autoSubmit: true,
  lockEnabled: false,
  keepAliveMoodle: true,
  keepAliveCsMoodle: false,
  keepAliveIntervalMin: 15
};

const DEFAULT_SITE_STATE: KeepAliveSiteState = {
  status: 'never',
  lastPingAt: null,
  lastLoggedInAt: null
};

export const DEFAULT_KEEPALIVE_STATES: KeepAliveStates = {
  moodle: { ...DEFAULT_SITE_STATE },
  csMoodle: { ...DEFAULT_SITE_STATE }
};

export async function getStoredCredentials(): Promise<StoredCredentials> {
  const res = await ext.storage.local.get('credentials');
  return (res.credentials as StoredCredentials | undefined) ?? null;
}

export async function setStoredCredentials(credentials: StoredCredentials): Promise<void> {
  await ext.storage.local.set({ credentials });
}

export async function getSettings(): Promise<ExtensionSettings> {
  const res = await ext.storage.local.get('settings');
  return {
    ...DEFAULT_SETTINGS,
    ...((res.settings as Partial<ExtensionSettings> | undefined) ?? {})
  };
}

export async function updateSettings(
  patch: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const next = { ...(await getSettings()), ...patch };
  await ext.storage.local.set({ settings: next });
  return next;
}

export async function getKeepAliveStates(): Promise<KeepAliveStates> {
  const res = await ext.storage.local.get('keepAliveStates');
  const raw = (res.keepAliveStates as Partial<KeepAliveStates> | undefined) ?? {};
  return {
    moodle: { ...DEFAULT_SITE_STATE, ...(raw.moodle ?? {}) },
    csMoodle: { ...DEFAULT_SITE_STATE, ...(raw.csMoodle ?? {}) }
  };
}

export async function updateKeepAliveSiteState(
  site: SiteKey,
  patch: Partial<KeepAliveSiteState>
): Promise<KeepAliveStates> {
  const current = await getKeepAliveStates();
  const next: KeepAliveStates = {
    ...current,
    [site]: { ...current[site], ...patch }
  };
  await ext.storage.local.set({ keepAliveStates: next });
  return next;
}

export async function getUnlockedCredentials(): Promise<PlainCredentials | null> {
  const res = await ext.storage.session.get('unlockedCredentials');
  return (res.unlockedCredentials as PlainCredentials | undefined) ?? null;
}

export async function setUnlockedCredentials(creds: PlainCredentials | null): Promise<void> {
  await ext.storage.session.set({ unlockedCredentials: creds });
}

export async function getLoginGuard(): Promise<LoginAttemptGuard> {
  const res = await ext.storage.session.get('loginAttemptGuard');
  return (res.loginAttemptGuard as LoginAttemptGuard | undefined) ?? EMPTY_LOGIN_GUARD;
}

export async function setLoginGuard(guard: LoginAttemptGuard): Promise<void> {
  await ext.storage.session.set({ loginAttemptGuard: guard });
}

export async function getPendingGauthImport(): Promise<PendingGauthImport | null> {
  const res = await ext.storage.session.get('pendingGauthImport');
  return (res.pendingGauthImport as PendingGauthImport | undefined) ?? null;
}

export async function setPendingGauthImport(pending: PendingGauthImport | null): Promise<void> {
  await ext.storage.session.set({ pendingGauthImport: pending });
}

export async function clearAllData(): Promise<void> {
  await ext.storage.local.clear();
  await ext.storage.session.clear();
}
```

Write `src/shared/qr.ts`:
```ts
import jsQR from 'jsqr';

export function decodeQrFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number
): string | null {
  const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  return result?.data ?? null;
}

function drawOnCanvas(
  source: CanvasImageSource,
  width: number,
  height: number
): string | null {
  if (width <= 0 || height <= 0) return null;
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  return decodeQrFromImageData(imgData.data, w, h);
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

export async function decodeQrFromBlob(blob: Blob): Promise<string | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      try {
        return drawOnCanvas(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    } catch {
      // Fallback to <img> element (e.g. SVG blobs)
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageFromUrl(url);
    return drawOnCanvas(img, img.naturalWidth || 400, img.naturalHeight || 400);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodeQrFromElement(
  el: HTMLImageElement | HTMLCanvasElement | SVGSVGElement
): Promise<string | null> {
  if (el instanceof HTMLCanvasElement) {
    const ctx = el.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const imgData = ctx.getImageData(0, 0, el.width, el.height);
    return decodeQrFromImageData(imgData.data, el.width, el.height);
  }
  if (el instanceof HTMLImageElement) {
    const w = el.naturalWidth || el.width;
    const h = el.naturalHeight || el.height;
    return drawOnCanvas(el, w, h);
  }
  const serialized = new XMLSerializer().serializeToString(el);
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  return decodeQrFromBlob(svgBlob);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/unit/storage.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/browser.ts src/shared/storage.ts src/shared/qr.ts tests/unit/storage.test.ts
git commit -m "feat: add cross-browser wrapper, storage accessors, and local jsQR decoder"
```

---

### Task 7: Background Worker (Alarms, Keep-Alive Pings, Lock & Gauth Handoff)

**Files:**
- Create: `src/background/worker-core.ts`
- Create: `src/background/worker.ts`
- Test: `tests/unit/worker.test.ts`

**Interfaces:**
- Consumes: `src/core/types.ts`, `src/core/crypto.ts`, `src/core/keepalive.ts`, `src/core/loop-guard.ts`, `src/shared/browser.ts`, `src/shared/storage.ts`
- Produces in `src/background/worker-core.ts`:
  - `KEEPALIVE_ALARM_NAME = 'huji-moodle-keepalive'`
  - `syncKeepAliveAlarm(): Promise<void>`
  - `pingMoodleSite(site: SiteKey, fetchImpl?: typeof fetch): Promise<KeepAliveSiteState>`
  - `runKeepAliveTick(targetSite?: SiteKey, fetchImpl?: typeof fetch): Promise<KeepAliveStates>`
  - `handleRuntimeMessage(msg: RuntimeMessage): Promise<RuntimeResponse>`

- [ ] **Step 1: Write failing tests in `tests/unit/worker.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptCredentials } from '../../src/core/crypto';
import type { PlainCredentials } from '../../src/core/types';
import {
  handleRuntimeMessage,
  pingMoodleSite,
  syncKeepAliveAlarm
} from '../../src/background/worker-core';
import {
  getKeepAliveStates,
  setStoredCredentials,
  updateKeepAliveSiteState,
  updateSettings
} from '../../src/shared/storage';

function makeMemoryStorage() {
  let store: Record<string, unknown> = {};
  return {
    async get(keys?: string | string[] | null) {
      if (!keys) return { ...store };
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (k in store) out[k] = store[k];
      }
      return out;
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, items);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
    },
    async clear() {
      store = {};
    }
  };
}

const CREDS: PlainCredentials = {
  id9: '000000018',
  pin4: '0429',
  totpSecret: 'JBSWY3DPEHPK3PXP',
  issuer: 'HUJI',
  digits: 6,
  period: 30,
  algorithm: 'SHA-1'
};

describe('background worker core', () => {
  const alarmsCreated: Array<{ name: string; info: unknown }> = [];
  const alarmsCleared: string[] = [];

  beforeEach(() => {
    alarmsCreated.length = 0;
    alarmsCleared.length = 0;
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: makeMemoryStorage(), session: makeMemoryStorage() },
      alarms: {
        create: async (name: string, info: unknown) => alarmsCreated.push({ name, info }),
        clear: async (name: string) => {
          alarmsCleared.push(name);
          return true;
        }
      },
      runtime: {
        openOptionsPage: vi.fn(async () => {})
      },
      tabs: {
        query: vi.fn(async () => []),
        sendMessage: vi.fn(async () => ({}))
      }
    };
  });

  it('unlocks encrypted credentials into session storage and locks back', async () => {
    const envelope = await encryptCredentials(CREDS, 'secret-123');
    await setStoredCredentials(envelope);
    await updateSettings({ lockEnabled: true });

    const locked = await handleRuntimeMessage({ type: 'GET_CREDENTIALS_STATUS' });
    expect(locked).toEqual({ ok: true, data: { status: 'locked' } });

    const unlocked = await handleRuntimeMessage({
      type: 'UNLOCK_CREDENTIALS',
      passphrase: 'secret-123'
    });
    expect(unlocked).toEqual({ ok: true, data: { status: 'ready', credentials: CREDS } });

    await handleRuntimeMessage({ type: 'LOCK_CREDENTIALS' });
    const relocked = await handleRuntimeMessage({ type: 'GET_CREDENTIALS_STATUS' });
    expect(relocked).toEqual({ ok: true, data: { status: 'locked' } });
  });

  it('pings Moodle using core_session_touch and pauses if logged out', async () => {
    await updateKeepAliveSiteState('moodle', { status: 'ok', sesskey: 'abc123' });

    const okFetch = vi.fn(async () =>
      new Response(JSON.stringify([{ error: false, data: true }]), { status: 200 })
    ) as unknown as typeof fetch;

    const okState = await pingMoodleSite('moodle', okFetch);
    expect(okState.status).toBe('ok');

    const redirectFetch = vi.fn(async () => ({
      status: 0,
      type: 'opaqueredirect',
      redirected: false,
      url: '',
      text: async () => ''
    })) as unknown as typeof fetch;

    // Clear sesskey first so it hits GET /my/
    await updateKeepAliveSiteState('moodle', { sesskey: undefined });
    const outState = await pingMoodleSite('moodle', redirectFetch);
    expect(outState.status).toBe('logged_out');
    expect((await getKeepAliveStates()).moodle.status).toBe('logged_out');
  });

  it('creates and clears keep-alive alarm based on settings', async () => {
    await updateSettings({ keepAliveMoodle: true, keepAliveCsMoodle: false, keepAliveIntervalMin: 10 });
    await syncKeepAliveAlarm();
    expect(alarmsCreated[0]?.name).toBe('huji-moodle-keepalive');

    await updateSettings({ keepAliveMoodle: false, keepAliveCsMoodle: false });
    await syncKeepAliveAlarm();
    expect(alarmsCleared).toContain('huji-moodle-keepalive');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/unit/worker.test.ts`
Expected: FAIL (`Cannot find module '../../src/background/worker-core'`).

- [ ] **Step 3: Implement `src/background/worker-core.ts` and `src/background/worker.ts`**

Write `src/background/worker-core.ts`:
```ts
import { decryptCredentials, isEncryptedEnvelope } from '../core/crypto';
import {
  classifyKeepAliveResult,
  SITE_ORIGINS,
  siteKeyFromOrigin
} from '../core/keepalive';
import { resetAutoSubmitGuard } from '../core/loop-guard';
import type {
  CredentialAvailability,
  KeepAliveSiteState,
  KeepAliveStates,
  RuntimeMessage,
  RuntimeResponse,
  SiteKey
} from '../core/types';
import { ext } from '../shared/browser';
import {
  getKeepAliveStates,
  getSettings,
  getStoredCredentials,
  getUnlockedCredentials,
  setLoginGuard,
  setPendingGauthImport,
  setUnlockedCredentials,
  updateKeepAliveSiteState
} from '../shared/storage';

export const KEEPALIVE_ALARM_NAME = 'huji-moodle-keepalive';

export async function syncKeepAliveAlarm(): Promise<void> {
  const settings = await getSettings();
  if (!settings.keepAliveMoodle && !settings.keepAliveCsMoodle) {
    await ext.alarms.clear(KEEPALIVE_ALARM_NAME);
    return;
  }
  await ext.alarms.create(KEEPALIVE_ALARM_NAME, {
    periodInMinutes: settings.keepAliveIntervalMin
  });
}

async function resolveCredentialsStatus(): Promise<CredentialAvailability> {
  const stored = await getStoredCredentials();
  if (!stored) return { status: 'unconfigured' };
  if (isEncryptedEnvelope(stored)) {
    const unlocked = await getUnlockedCredentials();
    if (!unlocked) return { status: 'locked' };
    return { status: 'ready', credentials: unlocked };
  }
  return { status: 'ready', credentials: stored };
}

export async function pingMoodleSite(
  site: SiteKey,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
): Promise<KeepAliveSiteState> {
  const origin = SITE_ORIGINS[site];
  const current = (await getKeepAliveStates())[site];

  try {
    if (current.sesskey) {
      const ajaxRes = await fetchImpl(
        `${origin}/lib/ajax/service.php?sesskey=${encodeURIComponent(current.sesskey)}&info=core_session_touch`,
        {
          method: 'POST',
          credentials: 'include',
          redirect: 'manual',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{ index: 0, methodname: 'core_session_touch', args: {} }])
        }
      );

      let jsonPayload: unknown;
      if (ajaxRes.status >= 200 && ajaxRes.status < 300) {
        try {
          jsonPayload = await ajaxRes.json();
        } catch {
          jsonPayload = undefined;
        }
      }
      const verdict = classifyKeepAliveResult({
        status: ajaxRes.status,
        type: ajaxRes.type,
        redirected: ajaxRes.redirected,
        url: ajaxRes.url,
        jsonPayload
      });

      if (verdict.outcome === 'ok') {
        const next = await updateKeepAliveSiteState(site, {
          status: 'ok',
          lastPingAt: Date.now(),
          lastError: undefined
        });
        return next[site];
      }

      if (verdict.outcome === 'logged_out') {
        const next = await updateKeepAliveSiteState(site, {
          status: 'logged_out',
          sesskey: undefined,
          lastError: verdict.reason
        });
        return next[site];
      }
    }

    const pageRes = await fetchImpl(`${origin}/my/`, {
      method: 'GET',
      credentials: 'include',
      redirect: 'manual'
    });
    const bodyText =
      pageRes.status >= 200 && pageRes.status < 300 ? await pageRes.text() : '';
    const verdict = classifyKeepAliveResult({
      status: pageRes.status,
      type: pageRes.type,
      redirected: pageRes.redirected,
      url: pageRes.url,
      bodyText
    });

    if (verdict.outcome === 'ok') {
      const next = await updateKeepAliveSiteState(site, {
        status: 'ok',
        lastPingAt: Date.now(),
        sesskey: verdict.sesskey ?? current.sesskey,
        lastError: undefined
      });
      return next[site];
    }

    if (verdict.outcome === 'logged_out') {
      const next = await updateKeepAliveSiteState(site, {
        status: 'logged_out',
        sesskey: undefined,
        lastError: verdict.reason
      });
      return next[site];
    }

    const next = await updateKeepAliveSiteState(site, {
      status: 'error',
      lastError: verdict.reason
    });
    return next[site];
  } catch (err) {
    const next = await updateKeepAliveSiteState(site, {
      status: 'error',
      lastError: err instanceof Error ? err.message : 'network_error'
    });
    return next[site];
  }
}

export async function runKeepAliveTick(
  targetSite?: SiteKey,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
): Promise<KeepAliveStates> {
  const settings = await getSettings();
  const states = await getKeepAliveStates();
  const candidates: SiteKey[] = targetSite
    ? [targetSite]
    : (['moodle', 'csMoodle'] as SiteKey[]);

  for (const site of candidates) {
    const enabled = site === 'moodle' ? settings.keepAliveMoodle : settings.keepAliveCsMoodle;
    if (!enabled) continue;
    // Skip background pings once logged out unless explicitly triggered by user
    if (!targetSite && states[site].status === 'logged_out') continue;
    await pingMoodleSite(site, fetchImpl);
  }
  return getKeepAliveStates();
}

export async function handleRuntimeMessage(msg: RuntimeMessage): Promise<RuntimeResponse> {
  try {
    switch (msg.type) {
      case 'GET_CREDENTIALS_STATUS': {
        return { ok: true, data: await resolveCredentialsStatus() };
      }
      case 'UNLOCK_CREDENTIALS': {
        const stored = await getStoredCredentials();
        if (!stored) return { ok: false, error: 'unconfigured' };
        if (!isEncryptedEnvelope(stored)) {
          return { ok: true, data: { status: 'ready', credentials: stored } };
        }
        const decrypted = await decryptCredentials(stored, msg.passphrase);
        await setUnlockedCredentials(decrypted);
        return { ok: true, data: { status: 'ready', credentials: decrypted } };
      }
      case 'LOCK_CREDENTIALS': {
        await setUnlockedCredentials(null);
        return { ok: true, data: { status: 'locked' } };
      }
      case 'OPEN_SETUP_WITH_IMPORT': {
        await setPendingGauthImport(msg.payload);
        await ext.runtime.openOptionsPage();
        return { ok: true, data: true };
      }
      case 'REPORT_MOODLE_SESSION': {
        const site = siteKeyFromOrigin(msg.origin);
        if (!site) return { ok: true, data: false };
        if (msg.loggedIn) {
          await updateKeepAliveSiteState(site, {
            status: 'ok',
            lastLoggedInAt: Date.now(),
            sesskey: msg.sesskey,
            lastError: undefined
          });
        } else {
          await updateKeepAliveSiteState(site, {
            status: 'logged_out',
            sesskey: undefined
          });
        }
        return { ok: true, data: true };
      }
      case 'PING_KEEPALIVE_NOW': {
        const states = await runKeepAliveTick(msg.site);
        return { ok: true, data: states };
      }
      case 'CAPTURE_OPEN_GAUTH': {
        const tabs = await ext.tabs.query({ url: 'https://gauth.huji.ac.il/*' });
        const tab = tabs[0];
        if (!tab?.id) return { ok: false, error: 'no_gauth_tab' };
        const result = (await ext.tabs.sendMessage(tab.id, {
          type: 'EXTRACT_GAUTH_FROM_PAGE'
        })) as RuntimeResponse;
        return result;
      }
      case 'RESET_LOGIN_GUARD': {
        await setLoginGuard(resetAutoSubmitGuard());
        return { ok: true, data: true };
      }
      case 'UPDATE_KEEPALIVE_ALARM': {
        await syncKeepAliveAlarm();
        return { ok: true, data: true };
      }
      default:
        return { ok: false, error: 'unknown_message' };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'internal_error' };
  }
}
```

Write `src/background/worker.ts`:
```ts
import type { RuntimeMessage } from '../core/types';
import { ext } from '../shared/browser';
import {
  handleRuntimeMessage,
  KEEPALIVE_ALARM_NAME,
  runKeepAliveTick,
  syncKeepAliveAlarm
} from './worker-core';

// All listeners registered synchronously at top level (MV3 requirement)
ext.runtime.onInstalled.addListener(() => {
  void syncKeepAliveAlarm();
});

ext.runtime.onStartup?.addListener(() => {
  void syncKeepAliveAlarm();
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM_NAME) {
    void runKeepAliveTick();
  }
});

ext.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  handleRuntimeMessage(message).then(sendResponse);
  return true;
});
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/unit/worker.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/background/worker-core.ts src/background/worker.ts tests/unit/worker.test.ts
git commit -m "feat: add MV3 background worker for keep-alive alarms and unlock flow"
```

---

### Task 8: Content Scripts (IdP Auto-Login, `gauth` Capture, Moodle Session Reporter) + Fixture Tests

**Files:**
- Create: `src/content/idp-login-core.ts`
- Create: `src/content/idp-login.ts`
- Create: `src/content/gauth-capture-core.ts`
- Create: `src/content/gauth-capture.ts`
- Create: `src/content/moodle-keepalive-core.ts`
- Create: `src/content/moodle-keepalive.ts`
- Create: `tests/fixtures/huji-idp-login.html`
- Test: `tests/integration/idp-login.test.ts`
- Test: `tests/integration/qr-and-gauth.test.ts`
- Test: `tests/integration/moodle-keepalive.test.ts`

**Interfaces:**
- Consumes: `src/core/totp.ts`, `src/core/validation.ts`, `src/core/loop-guard.ts`, `src/core/i18n.ts`, `src/shared/storage.ts`, `src/shared/qr.ts`, `src/shared/browser.ts`
- Produces in `src/content/idp-login-core.ts`: `hasIdpPageError(doc)`, `ensureOtpTabActive(doc)`, `fillIdpForm(doc, id9, combinedOtp)`, `runIdpAutoLogin(doc, opts?)`
- Produces in `src/content/gauth-capture-core.ts`: `detectPin4Candidate(doc)`, `extractGauthFromDocument(doc)`
- Produces in `src/content/moodle-keepalive-core.ts`: `inspectMoodleDom(doc, url)`

- [ ] **Step 1: Save sanitized HUJI SimpleSAML HTML fixture `tests/fixtures/huji-idp-login.html` and write failing integration tests**

Write `tests/fixtures/huji-idp-login.html`:
```html
<!doctype html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><title>Login</title></head>
<body id="hujicc:login">
  <div class="container hujicc-content">
    <ul class="nav nav-pills mb-3 ltr" id="hujicc-tabs" role="tablist">
      <li class="nav-item">
        <a class="nav-link" id="hujicc-sms-tab" data-toggle="pill" href="#hujicc-sms" role="tab" aria-selected="false">With temporary code</a>
      </li>
      <li class="nav-item">
        <a class="nav-link active show" id="hujicc-otp-tab" data-toggle="pill" href="#hujicc-otp" role="tab" aria-selected="true">With OTP</a>
      </li>
    </ul>
    <div class="tab-content" id="hujicc-tabContent">
      <div class="tab-pane fade" id="hujicc-sms" role="tabpanel">
        <form name="f-sms-request" id="hujicc-form-sms-request" method="post">
          <input type="text" id="hujicc-tz9" name="tz9" />
        </form>
      </div>
      <div class="tab-pane fade active show" id="hujicc-otp" role="tabpanel">
        <form name="f-otp" id="hujicc-form-otp" method="post" action="https://idp.cc.huji.ac.il/simplesaml/module.php/hujicc/login?AuthState=_abc123%3Ahttps%3A%2F%2Fidp.cc.huji.ac.il">
          <input type="hidden" name="formAction" value="otp" />
          <div class="form-group ltr">
            <label for="hujicc-otp-username">ID number (9 digits)</label>
            <input type="text" class="form-control frm-in" id="hujicc-otp-username" name="username" value="" pattern="[0-9]{9}" />
          </div>
          <div class="form-group ltr">
            <label for="hujicc-otp-password">OTP password</label>
            <input type="password" class="form-control frm-in" id="hujicc-otp-password" name="o_password" />
          </div>
          <button type="submit" id="hujicc-captcha-btn-otp" class="btn btn-primary hujicc-captcha-btn" data-callback-name="hujiccSubmit_otp">Enter</button>
        </form>
      </div>
    </div>
  </div>
</body>
</html>
```

Write `tests/integration/idp-login.test.ts`:
```ts
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runIdpAutoLogin } from '../../src/content/idp-login-core';
import { generateTotp } from '../../src/core/totp';

const FIXTURE = fs.readFileSync(path.resolve('tests/fixtures/huji-idp-login.html'), 'utf8');

function makeMemoryStorage() {
  let store: Record<string, unknown> = {};
  return {
    async get(keys?: string | string[] | null) {
      if (!keys) return { ...store };
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (k in store) out[k] = store[k];
      }
      return out;
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, items);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
    },
    async clear() {
      store = {};
    }
  };
}

describe('HUJI IdP auto-login DOM integration', () => {
  beforeEach(() => {
    const local = makeMemoryStorage();
    const session = makeMemoryStorage();
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local, session, onChanged: { addListener: () => {} } },
      runtime: {
        sendMessage: vi.fn(async () => ({
          ok: true,
          data: {
            status: 'ready',
            credentials: {
              id9: '000000018',
              pin4: '0429',
              totpSecret: 'JBSWY3DPEHPK3PXP',
              issuer: 'HUJI',
              digits: 6,
              period: 30,
              algorithm: 'SHA-1'
            }
          }
        })),
        openOptionsPage: vi.fn()
      }
    };
  });

  it('switches from SMS tab to OTP tab, fills ID and pin4+totp6, and clicks submit', async () => {
    const dom = new JSDOM(FIXTURE, {
      url: 'https://idp.cc.huji.ac.il/simplesaml/module.php/hujicc/login?AuthState=_abc123%3Afoo'
    });
    const doc = dom.window.document;

    // Simulate landing on SMS tab initially
    doc.getElementById('hujicc-otp-tab')?.classList.remove('active', 'show');
    doc.getElementById('hujicc-otp-tab')?.setAttribute('aria-selected', 'false');
    doc.getElementById('hujicc-otp')?.classList.remove('active', 'show');
    doc.getElementById('hujicc-sms-tab')?.classList.add('active', 'show');
    doc.getElementById('hujicc-sms')?.classList.add('active', 'show');

    const clicked = vi.fn();
    doc.getElementById('hujicc-captcha-btn-otp')?.addEventListener('click', (e) => {
      e.preventDefault();
      clicked();
    });

    const fixedNow = 1_700_000_010_000; // 10s into 30s window -> 20s left
    const expectedTotp = await generateTotp({ secret: 'JBSWY3DPEHPK3PXP', timestampMs: fixedNow });

    await runIdpAutoLogin(doc, { nowMs: fixedNow, recaptchaWaitMs: 0 });

    expect(doc.getElementById('hujicc-otp-tab')?.getAttribute('aria-selected')).toBe('true');
    expect((doc.getElementById('hujicc-otp-username') as HTMLInputElement).value).toBe('000000018');
    expect((doc.getElementById('hujicc-otp-password') as HTMLInputElement).value).toBe(
      `0429${expectedTotp}`
    );
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('pauses auto-submit when page shows an error alert', async () => {
    const dom = new JSDOM(FIXTURE, {
      url: 'https://idp.cc.huji.ac.il/simplesaml/module.php/hujicc/login?AuthState=_err1%3Afoo'
    });
    const doc = dom.window.document;
    const errBox = doc.createElement('div');
    errBox.className = 'alert alert-danger';
    errBox.textContent = 'Invalid credentials';
    doc.getElementById('hujicc-form-otp')?.prepend(errBox);

    const clicked = vi.fn();
    doc.getElementById('hujicc-captcha-btn-otp')?.addEventListener('click', (e) => {
      e.preventDefault();
      clicked();
    });

    await runIdpAutoLogin(doc, { nowMs: 1_700_000_010_000, recaptchaWaitMs: 0 });
    expect(clicked).not.toHaveBeenCalled();
    expect(doc.getElementById('huji-key-pill')?.textContent).toMatch(/paused/i);
  });
});
```

Write `tests/integration/qr-and-gauth.test.ts`:
```ts
import { JSDOM } from 'jsdom';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { detectPin4Candidate, extractGauthFromDocument } from '../../src/content/gauth-capture-core';
import { decodeQrFromImageData } from '../../src/shared/qr';

describe('gauth capture & QR extraction', () => {
  it('detects 4-digit PIN near code label on gauth page', () => {
    const dom = new JSDOM(`
      <main>
        <p>Your 9-digit ID: 012345678</p>
        <div>Your 4-digit PIN code is: <strong>0429</strong></div>
      </main>
    `);
    expect(detectPin4Candidate(dom.window.document)).toBe('0429');
  });

  it('extracts otpauth URI from canvas QR element', async () => {
    const uri = 'otpauth://totp/HUJI:000000018?secret=JBSWY3DPEHPK3PXP&issuer=HUJI';
    const qr = QRCode.create(uri, { errorCorrectionLevel: 'M' });
    const modules = qr.modules.size;
    const scale = 4;
    const margin = 16;
    const width = modules * scale + margin * 2;
    const rgba = new Uint8ClampedArray(width * width * 4).fill(255);
    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        if (!qr.modules.get(r, c)) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const idx = ((margin + r * scale + dy) * width + (margin + c * scale + dx)) * 4;
            rgba[idx] = 0;
            rgba[idx + 1] = 0;
            rgba[idx + 2] = 0;
          }
        }
      }
    }

    const dom = new JSDOM('<canvas id="qr"></canvas><div>PIN: 5190</div>');
    const canvas = dom.window.document.getElementById('qr') as HTMLCanvasElement;
    canvas.width = width;
    canvas.height = width;
    (canvas as unknown as { getContext: () => unknown }).getContext = () => ({
      getImageData: () => ({ data: rgba, width, height: width })
    });

    const extracted = await extractGauthFromDocument(dom.window.document, async (el) => {
      if (el === canvas) return decodeQrFromImageData(rgba, width, width);
      return null;
    });

    expect(extracted?.totpSecret).toBe('JBSWY3DPEHPK3PXP');
    expect(extracted?.pin4).toBe('5190');
  });
});
```

Write `tests/integration/moodle-keepalive.test.ts`:
```ts
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { inspectMoodleDom } from '../../src/content/moodle-keepalive-core';

describe('Moodle DOM session detection', () => {
  it('detects logged-in Moodle session and extracts sesskey', () => {
    const dom = new JSDOM(
      `<div class="usermenu"><a href="https://moodle.huji.ac.il/2026-27/login/logout.php?sesskey=xyz987">Log out</a></div>`,
      { url: 'https://moodle.huji.ac.il/2026-27/my/' }
    );
    expect(inspectMoodleDom(dom.window.document, 'https://moodle.huji.ac.il/2026-27/my/')).toEqual({
      origin: 'https://moodle.huji.ac.il',
      loggedIn: true,
      sesskey: 'xyz987'
    });
  });

  it('detects Moodle login page as logged_out', () => {
    const dom = new JSDOM('<form id="login"></form>', {
      url: 'https://moodle.huji.ac.il/2026-27/login/index.php'
    });
    expect(
      inspectMoodleDom(dom.window.document, 'https://moodle.huji.ac.il/2026-27/login/index.php')
    ).toEqual({
      origin: 'https://moodle.huji.ac.il',
      loggedIn: false
    });
  });
});
```

- [ ] **Step 2: Run integration tests to verify failure**

Run: `npx vitest run tests/integration/idp-login.test.ts tests/integration/qr-and-gauth.test.ts tests/integration/moodle-keepalive.test.ts`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: Implement the three content script cores and wrappers**

Write `src/content/idp-login-core.ts`:
```ts
import { getDirection, t } from '../core/i18n';
import {
  evaluateAutoSubmitGuard,
  extractAuthStateKey,
  recordAutoSubmitAttempt,
  resetAutoSubmitGuard
} from '../core/loop-guard';
import { generateTotp, getTotpWindowInfo } from '../core/totp';
import { formatCombinedOtp } from '../core/validation';
import type {
  CredentialAvailability,
  Language,
  PlainCredentials,
  RuntimeResponse
} from '../core/types';
import { ext } from '../shared/browser';
import { getLoginGuard, getSettings, setLoginGuard } from '../shared/storage';

export function hasIdpPageError(doc: Document): boolean {
  const alerts = doc.querySelectorAll(
    '#hujicc-tabContent .alert-danger, #hujicc-tabContent .alert-warning, #hujicc-tabContent [role="alert"], .error-message'
  );
  return Array.from(alerts).some((el) => (el.textContent ?? '').trim().length > 0);
}

export function ensureOtpTabActive(doc: Document): void {
  const otpTab = doc.getElementById('hujicc-otp-tab');
  const otpPane = doc.getElementById('hujicc-otp');
  if (!otpTab || !otpPane) return;

  const isSelected =
    otpTab.getAttribute('aria-selected') === 'true' && otpPane.classList.contains('active');
  if (isSelected) return;

  otpTab.click();
  // Fallback in case Bootstrap JS isn't attached (e.g. unit DOM or delayed load)
  const smsTab = doc.getElementById('hujicc-sms-tab');
  const smsPane = doc.getElementById('hujicc-sms');
  smsTab?.classList.remove('active', 'show');
  smsTab?.setAttribute('aria-selected', 'false');
  smsPane?.classList.remove('active', 'show');
  otpTab.classList.add('active', 'show');
  otpTab.setAttribute('aria-selected', 'true');
  otpPane.classList.add('active', 'show');
}

export function fillIdpForm(doc: Document, id9: string, combinedOtp: string): boolean {
  const idInput = doc.getElementById('hujicc-otp-username') as HTMLInputElement | null;
  const otpInput = doc.getElementById('hujicc-otp-password') as HTMLInputElement | null;
  if (!idInput || !otpInput) return false;

  idInput.value = id9;
  idInput.dispatchEvent(new Event('input', { bubbles: true }));
  idInput.dispatchEvent(new Event('change', { bubbles: true }));

  otpInput.value = combinedOtp;
  otpInput.dispatchEvent(new Event('input', { bubbles: true }));
  otpInput.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function renderStatusPill(
  doc: Document,
  lang: Language,
  text: string,
  tone: 'info' | 'warn' | 'muted',
  action?: { label: string; onClick: () => void }
): void {
  const form = doc.getElementById('hujicc-form-otp');
  if (!form) return;

  let pill = doc.getElementById('huji-key-pill');
  if (!pill) {
    pill = doc.createElement('div');
    pill.id = 'huji-key-pill';
    form.prepend(pill);
  }

  const palette =
    tone === 'warn'
      ? 'background:#FEF3C7;border-color:#F59E0B;color:#92400E;'
      : tone === 'muted'
        ? 'background:#F1F5F9;border-color:#CBD5E1;color:#334155;'
        : 'background:#EFF6FF;border-color:#BFDBFE;color:#1E3A8A;';

  pill.setAttribute('dir', getDirection(lang));
  pill.setAttribute(
    'style',
    `display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;margin-bottom:12px;border:1px solid;border-radius:8px;font:500 13px/1.4 system-ui,sans-serif;${palette}`
  );
  pill.textContent = '';

  const span = doc.createElement('span');
  span.textContent = text;
  pill.appendChild(span);

  if (action) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.setAttribute(
      'style',
      'border:1px solid currentColor;background:#FFFFFF;color:inherit;border-radius:6px;padding:3px 10px;font:600 12px/1.3 system-ui,sans-serif;cursor:pointer;white-space:nowrap;'
    );
    btn.addEventListener('click', action.onClick);
    pill.appendChild(btn);
  }
}

async function waitForSubmitButtonReady(
  doc: Document,
  maxWaitMs: number
): Promise<HTMLButtonElement | null> {
  const btn = doc.getElementById('hujicc-captcha-btn-otp') as HTMLButtonElement | null;
  if (!btn) return null;
  if (maxWaitMs <= 0) return btn.disabled ? null : btn;

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const form = doc.getElementById('hujicc-form-otp');
    const hasRecaptchaScript = Boolean(doc.querySelector('script[src*="recaptcha"]'));
    const recaptchaIframe = form?.querySelector('iframe[src*="recaptcha"]');
    if (!btn.disabled && (!hasRecaptchaScript || recaptchaIframe)) {
      return btn;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return btn.disabled ? null : btn;
}

export async function runIdpAutoLogin(
  doc: Document,
  opts: { nowMs?: number; recaptchaWaitMs?: number; forceRetry?: boolean } = {}
): Promise<void> {
  if (!doc.getElementById('hujicc-form-otp')) return;

  const settings = await getSettings();
  if (!settings.autoFill && !opts.forceRetry) return;

  ensureOtpTabActive(doc);

  const res = (await ext.runtime.sendMessage({
    type: 'GET_CREDENTIALS_STATUS'
  })) as RuntimeResponse<CredentialAvailability>;

  if (!res.ok) return;

  if (res.data.status === 'unconfigured') {
    renderStatusPill(doc, settings.language, t(settings.language, 'idpBadgeUnconfigured'), 'muted');
    return;
  }

  if (res.data.status === 'locked') {
    renderStatusPill(doc, settings.language, t(settings.language, 'idpBadgeLocked'), 'warn');
    return;
  }

  const creds: PlainCredentials = res.data.credentials;
  let nowMs = opts.nowMs ?? Date.now();
  let win = getTotpWindowInfo(nowMs, creds.period);

  if (settings.autoSubmit && win.secondsRemaining < 3 && opts.nowMs === undefined) {
    renderStatusPill(
      doc,
      settings.language,
      t(settings.language, 'idpBadgeWaitingFresh', { seconds: win.secondsRemaining }),
      'info'
    );
    await new Promise((r) => setTimeout(r, win.secondsRemaining * 1000 + 150));
    nowMs = Date.now();
    win = getTotpWindowInfo(nowMs, creds.period);
  }

  const totp = await generateTotp({
    secret: creds.totpSecret,
    timestampMs: nowMs,
    digits: creds.digits,
    period: creds.period,
    algorithm: creds.algorithm
  });

  fillIdpForm(doc, creds.id9, formatCombinedOtp(creds.pin4, totp));

  const authStateKey = extractAuthStateKey(doc.location?.href ?? '');
  const guard = opts.forceRetry ? resetAutoSubmitGuard() : await getLoginGuard();
  const verdict = evaluateAutoSubmitGuard({
    guard,
    hasPageError: opts.forceRetry ? false : hasIdpPageError(doc),
    authStateKey,
    nowMs
  });

  if (!settings.autoSubmit) {
    renderStatusPill(
      doc,
      settings.language,
      t(settings.language, 'idpBadgeFilled', { seconds: win.secondsRemaining }),
      'info'
    );
    return;
  }

  if (!verdict.allowed) {
    renderStatusPill(doc, settings.language, t(settings.language, 'idpBadgePaused'), 'warn', {
      label: t(settings.language, 'idpRetryBtn'),
      onClick: () => {
        void runIdpAutoLogin(doc, { forceRetry: true, recaptchaWaitMs: opts.recaptchaWaitMs });
      }
    });
    return;
  }

  await setLoginGuard(recordAutoSubmitAttempt(guard, authStateKey, nowMs));
  renderStatusPill(doc, settings.language, t(settings.language, 'idpBadgeSubmitting'), 'info');

  const submitBtn = await waitForSubmitButtonReady(doc, opts.recaptchaWaitMs ?? 1500);
  submitBtn?.click();
}
```

Write `src/content/idp-login.ts`:
```ts
import { ext } from '../shared/browser';
import { runIdpAutoLogin } from './idp-login-core';

void runIdpAutoLogin(document);

ext.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'session' && changes.unlockedCredentials?.newValue) {
    void runIdpAutoLogin(document);
  }
});
```

Write `src/content/gauth-capture-core.ts`:
```ts
import { getDirection, t } from '../core/i18n';
import { parseOtpAuthUri } from '../core/totp';
import type { Language, PendingGauthImport } from '../core/types';
import { ext } from '../shared/browser';
import { decodeQrFromElement } from '../shared/qr';

export function detectPin4Candidate(doc: Document): string | undefined {
  const text = doc.body?.innerText || doc.body?.textContent || '';
  const labeledMatch = text.match(/(?:pin|code|קוד|رمز)[^\d\n]{0,25}(\d{4})\b/i);
  if (labeledMatch?.[1]) return labeledMatch[1];

  const strongCandidates = Array.from(doc.querySelectorAll('strong, b, code, .pin, .code'));
  for (const el of strongCandidates) {
    const val = (el.textContent ?? '').trim();
    if (/^\d{4}$/.test(val)) return val;
  }
  return undefined;
}

export async function extractGauthFromDocument(
  doc: Document,
  decoder: (
    el: HTMLImageElement | HTMLCanvasElement | SVGSVGElement
  ) => Promise<string | null> = decodeQrFromElement
): Promise<PendingGauthImport | null> {
  const elements = Array.from(doc.querySelectorAll('canvas, img, svg')) as Array<
    HTMLImageElement | HTMLCanvasElement | SVGSVGElement
  >;

  for (const el of elements) {
    try {
      const raw = await decoder(el);
      if (!raw || !raw.trim().toLowerCase().startsWith('otpauth://totp')) continue;
      const parsed = parseOtpAuthUri(raw);
      return {
        totpSecret: parsed.totpSecret,
        issuer: parsed.issuer,
        digits: parsed.digits,
        period: parsed.period,
        algorithm: parsed.algorithm,
        pin4: detectPin4Candidate(doc),
        capturedAt: Date.now()
      };
    } catch {
      // Try next candidate visual element
    }
  }
  return null;
}

export function renderGauthBanner(
  doc: Document,
  lang: Language,
  captured: PendingGauthImport
): void {
  if (doc.getElementById('huji-key-gauth-banner')) return;
  const banner = doc.createElement('div');
  banner.id = 'huji-key-gauth-banner';
  banner.setAttribute('dir', getDirection(lang));
  banner.setAttribute(
    'style',
    'position:fixed;bottom:20px;inset-inline-end:20px;z-index:2147483647;background:#FFFFFF;border:1px solid #BFDBFE;box-shadow:0 10px 25px rgba(15,23,42,0.14);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:12px;font:500 13px/1.4 system-ui,sans-serif;color:#0F172A;'
  );

  const info = doc.createElement('div');
  const title = doc.createElement('div');
  title.style.fontWeight = '600';
  title.textContent = t(lang, 'gauthBannerFound');
  info.appendChild(title);
  if (captured.pin4) {
    const sub = doc.createElement('div');
    sub.style.color = '#475569';
    sub.textContent = t(lang, 'gauthBannerPinHint', { pin4: captured.pin4 });
    info.appendChild(sub);
  }
  banner.appendChild(info);

  const saveBtn = doc.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = t(lang, 'gauthBannerSaveBtn');
  saveBtn.setAttribute(
    'style',
    'background:#1D4ED8;color:#FFFFFF;border:0;border-radius:8px;padding:7px 12px;font:600 12px/1.2 system-ui,sans-serif;cursor:pointer;'
  );
  saveBtn.addEventListener('click', () => {
    void ext.runtime.sendMessage({ type: 'OPEN_SETUP_WITH_IMPORT', payload: captured });
  });
  banner.appendChild(saveBtn);

  const closeBtn = doc.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', t(lang, 'gauthBannerDismiss'));
  closeBtn.setAttribute(
    'style',
    'background:transparent;color:#64748B;border:0;font:600 18px/1 system-ui,sans-serif;cursor:pointer;padding:0 4px;'
  );
  closeBtn.addEventListener('click', () => banner.remove());
  banner.appendChild(closeBtn);

  doc.body.appendChild(banner);
}
```

Write `src/content/gauth-capture.ts`:
```ts
import { ext } from '../shared/browser';
import { getSettings } from '../shared/storage';
import { extractGauthFromDocument, renderGauthBanner } from './gauth-capture-core';

let scanned = false;

async function tryScan(): Promise<void> {
  if (scanned) return;
  const captured = await extractGauthFromDocument(document);
  if (!captured) return;
  scanned = true;
  const settings = await getSettings();
  renderGauthBanner(document, settings.language, captured);
}

void tryScan();

const observer = new MutationObserver(() => {
  void tryScan();
});
observer.observe(document.body, { childList: true, subtree: true });

ext.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
  if (msg?.type === 'EXTRACT_GAUTH_FROM_PAGE') {
    extractGauthFromDocument(document)
      .then((data) => {
        if (data) sendResponse({ ok: true, data });
        else sendResponse({ ok: false, error: 'no_qr_found' });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : 'scan_failed' });
      });
    return true;
  }
  return false;
});
```

Write `src/content/moodle-keepalive-core.ts`:
```ts
import { extractSesskeyFromHtml } from '../core/keepalive';

export function inspectMoodleDom(
  doc: Document,
  currentUrl: string
): { origin: string; loggedIn: boolean; sesskey?: string } {
  const origin = new URL(currentUrl).origin;
  const isLoginRoute = currentUrl.includes('/login/');
  const hasLoginForm = Boolean(doc.querySelector('form#login, .loginform'));

  if (isLoginRoute || hasLoginForm) {
    return { origin, loggedIn: false };
  }

  const logoutLink = doc.querySelector('a[href*="logout.php?sesskey="]') as HTMLAnchorElement | null;
  const hiddenSesskey = doc.querySelector('input[name="sesskey"]') as HTMLInputElement | null;
  const sesskey =
    (logoutLink ? extractSesskeyFromHtml(logoutLink.href) : undefined) ||
    hiddenSesskey?.value ||
    extractSesskeyFromHtml(doc.documentElement.innerHTML);

  const hasUserShell = Boolean(
    logoutLink || doc.querySelector('#user-menu-toggle, .usermenu .userbutton, [data-userid]')
  );

  if (!hasUserShell && !sesskey) {
    return { origin, loggedIn: false };
  }

  return {
    origin,
    loggedIn: true,
    sesskey
  };
}
```

Write `src/content/moodle-keepalive.ts`:
```ts
import { ext } from '../shared/browser';
import { inspectMoodleDom } from './moodle-keepalive-core';

const report = inspectMoodleDom(document, location.href);
void ext.runtime.sendMessage({
  type: 'REPORT_MOODLE_SESSION',
  ...report
});
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/integration/idp-login.test.ts tests/integration/qr-and-gauth.test.ts tests/integration/moodle-keepalive.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/ tests/fixtures/huji-idp-login.html tests/integration/idp-login.test.ts tests/integration/qr-and-gauth.test.ts tests/integration/moodle-keepalive.test.ts
git commit -m "feat: add IdP auto-login, gauth QR capture, and Moodle session content scripts"
```

---

### Task 9: Light Trilingual Popup & Setup/Settings UI (`EN | עב | ع`)

**Files:**
- Create: `src/shared/ui-a11y.ts`
- Create: `src/popup/popup.html`
- Create: `src/popup/popup.css`
- Create: `src/popup/popup.ts`
- Create: `src/options/options.html`
- Create: `src/options/options.css`
- Create: `src/options/options.ts`
- Test: `tests/integration/ui.test.ts`

**Interfaces:**
- Consumes: `src/core/i18n.ts`, `src/core/totp.ts`, `src/core/validation.ts`, `src/core/crypto.ts`, `src/shared/browser.ts`, `src/shared/storage.ts`, `src/shared/qr.ts`
- Produces in `src/shared/ui-a11y.ts`:
  - `initTablist(tablistEl: HTMLElement, onSelect: (panelId: string) => void): void` (roving tabindex + RTL-aware ArrowLeft/ArrowRight/Home/End + `hidden="until-found"` + `beforematch` find-in-page sync)
  - `initAccessibleValidation(root: Document): { syncField: (el: HTMLInputElement, announceError?: boolean, forceFlag?: boolean) => void; announce: (msg: string) => void }` (sets `aria-invalid="false"` upfront, syncs `:user-invalid` + dynamic `aria-describedby` from `data-error` on `blur`/`input`/`change`/`invalid`, central `aria-live="polite"` announcer)

- [ ] **Step 1: Write failing UI integration test `tests/integration/ui.test.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { applyDocumentLocale } from '../../src/core/i18n';
import { initTablist } from '../../src/shared/ui-a11y';

describe('Popup & Options UI accessibility and RTL/LTR', () => {
  it('renders clean HTML without inline scripts or handlers', () => {
    for (const rel of ['src/popup/popup.html', 'src/options/options.html']) {
      const html = fs.readFileSync(path.resolve(rel), 'utf8');
      expect(html).not.toMatch(/<script\b(?![^>]*\bsrc=)[^>]*>/i);
      expect(html).not.toMatch(/\bonclick=/i);
    }
  });

  it('uses EN | עב | ع switcher and switches document direction cleanly', () => {
    const html = fs.readFileSync(path.resolve('src/popup/popup.html'), 'utf8');
    expect(html).toContain('EN');
    expect(html).toContain('עב');
    expect(html).toContain('ع');

    const dom = new JSDOM(html);
    applyDocumentLocale(dom.window.document, 'he');
    expect(dom.window.document.documentElement.dir).toBe('rtl');
    applyDocumentLocale(dom.window.document, 'ar');
    expect(dom.window.document.documentElement.lang).toBe('ar');
    expect(dom.window.document.documentElement.dir).toBe('rtl');
  });

  it('supports keyboard ArrowRight/ArrowLeft navigation on onboarding tabs respecting RTL', () => {
    const html = fs.readFileSync(path.resolve('src/options/options.html'), 'utf8');
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const tablist = doc.querySelector('[role="tablist"]') as HTMLElement;
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]')) as HTMLButtonElement[];

    let lastPanel = '';
    initTablist(tablist, (panelId) => {
      lastPanel = panelId;
    });

    // RTL flips ArrowLeft to advance to next tab
    doc.documentElement.dir = 'rtl';
    tabs[0]?.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(lastPanel).toBe(tabs[1]?.getAttribute('data-panel'));
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/integration/ui.test.ts`
Expected: FAIL (`ENOENT` / `Cannot find module`).

- [ ] **Step 3: Implement `src/shared/ui-a11y.ts`**

```ts
export function initTablist(
  tablistEl: HTMLElement,
  onSelect?: (panelId: string) => void
): void {
  const tabs = Array.from(tablistEl.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  if (tabs.length === 0) return;

  const activate = (target: HTMLButtonElement, moveFocus: boolean) => {
    for (const tab of tabs) {
      const selected = tab === target;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
      const panelId = tab.dataset.panel;
      if (panelId) {
        const panel = tablistEl.ownerDocument.getElementById(panelId);
        if (panel) {
          if (selected) {
            panel.removeAttribute('hidden');
            panel.tabIndex = 0;
          } else {
            panel.setAttribute('hidden', 'until-found');
            panel.removeAttribute('tabindex');
          }
        }
      }
    }
    if (moveFocus) target.focus();
    if (target.dataset.panel) onSelect?.(target.dataset.panel);
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab, false));
    const panelId = tab.dataset.panel;
    if (panelId) {
      const panel = tablistEl.ownerDocument.getElementById(panelId);
      panel?.addEventListener('beforematch', () => activate(tab, false));
    }
  }

  tablistEl.addEventListener('keydown', (e) => {
    const currentIdx = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    if (currentIdx === -1) return;
    const isRtl = tablistEl.ownerDocument.documentElement.dir === 'rtl';
    let nextIdx = currentIdx;

    if (e.key === 'ArrowRight') {
      nextIdx = isRtl
        ? (currentIdx - 1 + tabs.length) % tabs.length
        : (currentIdx + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft') {
      nextIdx = isRtl
        ? (currentIdx + 1) % tabs.length
        : (currentIdx - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = tabs.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    const target = tabs[nextIdx];
    if (target) activate(target, true);
  });
}

export function initAccessibleValidation(root: Document): {
  syncField: (el: HTMLInputElement, announceError?: boolean, forceFlag?: boolean) => void;
  announce: (msg: string) => void;
} {
  const announcer = root.createElement('div');
  announcer.setAttribute('aria-live', 'polite');
  announcer.className = 'visually-hidden';
  root.body.appendChild(announcer);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const flagged = new WeakSet<HTMLInputElement>();

  const announce = (msg: string) => {
    clearTimeout(timer);
    announcer.textContent = '';
    timer = setTimeout(() => {
      announcer.textContent = msg;
    }, 80);
  };

  const linkError = (el: HTMLInputElement, shown: boolean) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const ids = (el.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const syncField = (el: HTMLInputElement, shouldAnnounce = false, forceFlag = false) => {
    if (forceFlag) flagged.add(el);
    let isUserInvalid = false;
    try {
      isUserInvalid = el.matches(':user-invalid');
    } catch {
      isUserInvalid = !el.validity.valid && flagged.has(el);
    }

    if (isUserInvalid || (flagged.has(el) && !el.validity.valid)) {
      el.setAttribute('aria-invalid', 'true');
      linkError(el, true);
      if (shouldAnnounce && el.dataset.error) {
        const errEl = root.getElementById(el.dataset.error);
        if (errEl?.textContent) announce(errEl.textContent.trim());
      }
    } else {
      el.setAttribute('aria-invalid', 'false');
      linkError(el, false);
    }
  };

  const fields = Array.from(root.querySelectorAll<HTMLInputElement>('input[data-error]'));
  for (const el of fields) {
    el.setAttribute('aria-invalid', 'false');
    el.addEventListener('blur', () => {
      flagged.add(el);
      syncField(el, true);
    });
    el.addEventListener('input', () => {
      if (el.getAttribute('aria-invalid') === 'true') syncField(el, false);
    });
    el.addEventListener('invalid', () => {
      flagged.add(el);
      syncField(el, false);
    });
  }

  return { syncField, announce };
}
```

- [ ] **Step 4: Implement Popup (`popup.html`, `popup.css`, `popup.ts`)**

Write `src/popup/popup.html`:
```html
<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HUJI Key</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">HK</span>
      <div>
        <h1 class="brand-title" data-i18n="appName">HUJI Key</h1>
        <p class="brand-sub" data-i18n="appSubtitle">Local Auto-OTP &amp; Moodle Keep-Alive</p>
      </div>
    </div>
    <div class="topbar-actions">
      <div class="lang-group" role="group" data-i18n-aria="langLabel">
        <button type="button" class="lang-btn" data-lang="en" aria-pressed="true">EN</button>
        <button type="button" class="lang-btn" data-lang="he" aria-pressed="false">עב</button>
        <button type="button" class="lang-btn" data-lang="ar" aria-pressed="false">ع</button>
      </div>
      <button type="button" id="open-options-btn" class="icon-btn" data-i18n-title="openSettings" data-i18n-aria="openSettings">⚙</button>
    </div>
  </header>

  <main class="stack">
    <section id="view-unconfigured" class="card empty-card" hidden>
      <h2 class="card-title" data-i18n="setupRequiredTitle">Set up in 30 seconds</h2>
      <p class="muted" data-i18n="setupRequiredDesc"></p>
      <div class="btn-col">
        <button type="button" id="btn-setup" class="btn-primary" data-i18n="openSetupBtn">Open Setup</button>
        <button type="button" id="btn-capture-gauth" class="btn-secondary" data-i18n="captureGauthBtn">Capture from open gauth tab</button>
      </div>
      <p id="gauth-feedback" class="inline-feedback" role="status" aria-live="polite"></p>
    </section>

    <section id="view-locked" class="card" hidden>
      <h2 class="card-title" data-i18n="lockedTitle">Credentials Locked</h2>
      <p class="muted" data-i18n="lockedDesc"></p>
      <form id="unlock-form" class="unlock-form">
        <label for="unlock-passphrase" class="field-label" data-i18n="passphraseLabel">Master Passphrase</label>
        <input id="unlock-passphrase" type="password" autocomplete="current-password" required />
        <p id="unlock-error" class="error-text" role="alert" hidden></p>
        <button type="submit" class="btn-primary" data-i18n="unlockBtn">Unlock</button>
      </form>
    </section>

    <section id="view-otp" class="card otp-card" hidden>
      <div class="otp-header">
        <span class="section-label" data-i18n="liveOtpHeading">Current Code</span>
        <div class="otp-meta">
          <span id="meta-id" class="chip ltr-isolate"></span>
          <span id="meta-pin" class="chip ltr-isolate"></span>
          <button type="button" id="btn-lock-now" class="link-btn" data-i18n="lockNowBtn" hidden>Lock Now</button>
        </div>
      </div>
      <div class="otp-row">
        <div id="live-otp-code" class="otp-digits ltr-isolate">------</div>
        <div class="ring-wrap" aria-hidden="true">
          <svg class="ring" viewBox="0 0 36 36">
            <circle class="ring-track" cx="18" cy="18" r="15" />
            <circle id="ring-progress" class="ring-fill" cx="18" cy="18" r="15" stroke-dasharray="94.25" stroke-dashoffset="0" />
          </svg>
          <span id="ring-seconds" class="ring-text ltr-isolate">30s</span>
        </div>
      </div>
      <div class="btn-row">
        <button type="button" id="btn-copy-6" class="btn-primary" data-i18n="copyOtp6">Copy 6-digit OTP</button>
        <button type="button" id="btn-copy-full" class="btn-secondary" data-i18n="copyPinOtp">Copy PIN + OTP</button>
      </div>
    </section>

    <section class="card">
      <h2 class="section-label" data-i18n="controlsHeading">Login Automation</h2>
      <label class="switch-row">
        <span data-i18n="autoFillToggle">Auto-fill ID &amp; OTP</span>
        <input id="toggle-autofill" class="switch-input" type="checkbox" role="switch" />
      </label>
      <label class="switch-row">
        <span data-i18n="autoSubmitToggle">Safe auto-submit</span>
        <input id="toggle-autosubmit" class="switch-input" type="checkbox" role="switch" />
      </label>
    </section>

    <section class="card">
      <div class="section-head">
        <h2 class="section-label" data-i18n="keepAliveHeading">Moodle Keep-Alive</h2>
        <div class="mini-actions">
          <button type="button" id="btn-ping-now" class="link-btn" data-i18n="pingNow">Refresh now</button>
          <button type="button" id="btn-open-moodle" class="link-btn" data-i18n="openMoodle">Open Moodle</button>
        </div>
      </div>
      <div class="site-block">
        <label class="switch-row">
          <span data-i18n="moodleMainLabel">Moodle (moodle.huji.ac.il)</span>
          <input id="toggle-ka-moodle" class="switch-input" type="checkbox" role="switch" />
        </label>
        <p id="status-moodle" class="status-line"></p>
      </div>
      <div class="site-block">
        <label class="switch-row">
          <span data-i18n="moodleCsLabel">CS Moodle (moodle2.cs.huji.ac.il)</span>
          <input id="toggle-ka-cs" class="switch-input" type="checkbox" role="switch" />
        </label>
        <p id="status-cs" class="status-line"></p>
      </div>
    </section>
  </main>

  <footer class="foot" data-i18n="unofficialNotice">Unofficial student-built tool · 100% local on this device</footer>
  <script src="popup.js"></script>
</body>
</html>
```

Write `src/popup/popup.css`:
```css
:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --border: #e2e8f0;
  --ink: #0f172a;
  --muted: #475569;
  --primary: #1d4ed8;
  --primary-hover: #1e40af;
  --crimson: #991b1b;
  --ok: #059669;
  --warn: #b45309;
  --err: #dc2626;
}

* {
  box-sizing: border-box;
}

body {
  width: 360px;
  margin: 0;
  padding: 14px;
  background: var(--bg);
  color: var(--ink);
  font: 400 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Heebo", "Noto Sans Arabic", sans-serif;
}

.ltr-isolate {
  direction: ltr;
  unicode-bidi: isolate;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-block-end: 12px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
}

.brand-mark {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: linear-gradient(155deg, var(--primary) 72%, var(--crimson) 100%);
  color: #ffffff;
  font-weight: 700;
  font-size: 12px;
  flex: none;
}

.brand-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
}

.brand-sub {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.lang-group {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  overflow: hidden;
}

.lang-btn {
  border: 0;
  background: transparent;
  color: var(--muted);
  font: 600 11px/1 inherit;
  padding: 6px 7px;
  cursor: pointer;
}

.lang-btn[aria-pressed="true"] {
  background: var(--primary);
  color: #ffffff;
}

.icon-btn {
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
  font-size: 15px;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
}

.card-title {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 700;
}

.section-label {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-block-end: 6px;
}

.section-head .section-label {
  margin: 0;
}

.muted {
  margin: 0 0 10px;
  color: var(--muted);
}

.otp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-block-end: 8px;
}

.otp-header .section-label {
  margin: 0;
}

.otp-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.chip {
  background: #f1f5f9;
  color: #334155;
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
}

.otp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-block-end: 10px;
}

.otp-digits {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--ink);
}

.ring-wrap {
  position: relative;
  width: 42px;
  height: 42px;
  flex: none;
}

.ring {
  width: 42px;
  height: 42px;
  transform: rotate(-90deg);
}

.ring-track {
  fill: none;
  stroke: var(--border);
  stroke-width: 3.5;
}

.ring-fill {
  fill: none;
  stroke: var(--primary);
  stroke-width: 3.5;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.25s linear;
}

.ring-text {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

.btn-row,
.btn-col {
  display: flex;
  gap: 8px;
}

.btn-col {
  flex-direction: column;
}

.btn-primary,
.btn-secondary {
  flex: 1;
  min-height: 36px;
  border-radius: 8px;
  padding: 7px 10px;
  font: 600 12px/1.2 inherit;
  cursor: pointer;
}

.btn-primary {
  border: 0;
  background: var(--primary);
  color: #ffffff;
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink);
}

.btn-secondary:hover {
  background: #f1f5f9;
}

.link-btn {
  border: 0;
  background: transparent;
  color: var(--primary);
  font: 600 11px/1.2 inherit;
  padding: 2px 4px;
  cursor: pointer;
}

.mini-actions {
  display: flex;
  gap: 6px;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-block: 5px;
  cursor: pointer;
}

.switch-input {
  appearance: none;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: #cbd5e1;
  position: relative;
  flex: none;
  cursor: pointer;
  transition: background 0.15s ease;
}

.switch-input::after {
  content: "";
  position: absolute;
  top: 2px;
  inset-inline-start: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.15s ease;
}

.switch-input:checked {
  background: var(--primary);
}

.switch-input:checked::after {
  transform: translateX(16px);
}

html[dir="rtl"] .switch-input:checked::after {
  transform: translateX(-16px);
}

:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.site-block + .site-block {
  margin-block-start: 6px;
  padding-block-start: 6px;
  border-top: 1px solid #f1f5f9;
}

.status-line {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--muted);
}

.status-line[data-tone="ok"] {
  color: var(--ok);
}

.status-line[data-tone="warn"] {
  color: var(--warn);
}

.status-line[data-tone="error"] {
  color: var(--err);
}

.unlock-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.unlock-form input {
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font: inherit;
}

.field-label {
  font-weight: 600;
  font-size: 12px;
}

.error-text,
.inline-feedback {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--err);
}

.foot {
  margin-block-start: 10px;
  text-align: center;
  font-size: 11px;
  color: var(--muted);
}
```

Write `src/popup/popup.ts`:
```ts
import { applyDocumentLocale, type MessageKey, t } from '../core/i18n';
import { generateTotp, getTotpWindowInfo } from '../core/totp';
import { formatCombinedOtp } from '../core/validation';
import type {
  CredentialAvailability,
  ExtensionSettings,
  KeepAliveSiteState,
  Language,
  PlainCredentials,
  RuntimeResponse
} from '../core/types';
import { ext } from '../shared/browser';
import { getKeepAliveStates, getSettings, updateSettings } from '../shared/storage';

let currentLang: Language = 'en';
let activeCreds: PlainCredentials | null = null;
let currentSettings: ExtensionSettings;
let lastRenderedCode = '';
let tickTimer: ReturnType<typeof setInterval> | undefined;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function applyTranslations(lang: Language): void {
  currentLang = lang;
  applyDocumentLocale(document, lang);

  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n as MessageKey;
    node.textContent = t(lang, key);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((node) => {
    const key = node.dataset.i18nAria as MessageKey;
    node.setAttribute('aria-label', t(lang, key));
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((node) => {
    const key = node.dataset.i18nTitle as MessageKey;
    node.title = t(lang, key);
  });
  document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.lang === lang ? 'true' : 'false');
  });
}

function formatAge(ts: number): string {
  const mins = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  return `${mins}m`;
}

function renderSiteStatus(targetId: string, state: KeepAliveSiteState): void {
  const node = el<HTMLElement>(targetId);
  const statusMap: Record<KeepAliveSiteState['status'], MessageKey> = {
    ok: 'statusOk',
    logged_out: 'statusLoggedOut',
    paused: 'statusPaused',
    error: 'statusError',
    never: 'statusNever'
  };
  let text = t(currentLang, statusMap[state.status]);
  if (state.status === 'ok' && state.lastPingAt) {
    text = `${text} · ${t(currentLang, 'lastRefreshed', { time: formatAge(state.lastPingAt) })}`;
  }
  node.textContent = text;
  node.dataset.tone =
    state.status === 'ok' ? 'ok' : state.status === 'error' ? 'error' : state.status === 'logged_out' ? 'warn' : 'muted';
}

async function updateLiveOtp(): Promise<void> {
  if (!activeCreds) return;
  const info = getTotpWindowInfo(Date.now(), activeCreds.period);
  const code = await generateTotp({
    secret: activeCreds.totpSecret,
    digits: activeCreds.digits,
    period: activeCreds.period,
    algorithm: activeCreds.algorithm
  });
  lastRenderedCode = code;
  el('live-otp-code').textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
  el('ring-seconds').textContent = t(currentLang, 'secondsLeft', { seconds: info.secondsRemaining });
  const circumference = 2 * Math.PI * 15;
  el('ring-progress').setAttribute('stroke-dashoffset', String(circumference * info.progress));
}

function showAvailability(avail: CredentialAvailability): void {
  el('view-unconfigured').hidden = avail.status !== 'unconfigured';
  el('view-locked').hidden = avail.status !== 'locked';
  el('view-otp').hidden = avail.status !== 'ready';

  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = undefined;
  }

  if (avail.status === 'ready') {
    activeCreds = avail.credentials;
    el('meta-id').textContent = t(currentLang, 'idSummary', { id9: activeCreds.id9 });
    el('meta-pin').textContent = t(currentLang, 'pinSummary', { pin4: activeCreds.pin4 });
    el('btn-lock-now').hidden = !currentSettings.lockEnabled;
    void updateLiveOtp();
    tickTimer = setInterval(() => void updateLiveOtp(), 500);
  } else {
    activeCreds = null;
  }
}

async function refreshAll(): Promise<void> {
  currentSettings = await getSettings();
  applyTranslations(currentSettings.language);

  const autofillEl = el<HTMLInputElement>('toggle-autofill');
  const autosubmitEl = el<HTMLInputElement>('toggle-autosubmit');
  const kaMoodleEl = el<HTMLInputElement>('toggle-ka-moodle');
  const kaCsEl = el<HTMLInputElement>('toggle-ka-cs');

  autofillEl.checked = currentSettings.autoFill;
  autosubmitEl.checked = currentSettings.autoSubmit;
  kaMoodleEl.checked = currentSettings.keepAliveMoodle;
  kaCsEl.checked = currentSettings.keepAliveCsMoodle;
  for (const sw of [autofillEl, autosubmitEl, kaMoodleEl, kaCsEl]) {
    sw.setAttribute('aria-checked', sw.checked ? 'true' : 'false');
  }

  const states = await getKeepAliveStates();
  renderSiteStatus('status-moodle', states.moodle);
  renderSiteStatus('status-cs', states.csMoodle);

  const statusRes = (await ext.runtime.sendMessage({
    type: 'GET_CREDENTIALS_STATUS'
  })) as RuntimeResponse<CredentialAvailability>;
  if (statusRes.ok) showAvailability(statusRes.data);
}

async function copyWithFeedback(btnId: string, text: string): Promise<void> {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  const btn = el<HTMLButtonElement>(btnId);
  const key = btn.dataset.i18n as MessageKey;
  btn.textContent = t(currentLang, 'copied');
  setTimeout(() => {
    btn.textContent = t(currentLang, key);
  }, 1200);
}

document.addEventListener('DOMContentLoaded', () => {
  void refreshAll();

  document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const lang = btn.dataset.lang as Language;
      await updateSettings({ language: lang });
      await refreshAll();
    });
  });

  el('open-options-btn').addEventListener('click', () => ext.runtime.openOptionsPage());
  el('btn-setup').addEventListener('click', () => ext.runtime.openOptionsPage());

  el('btn-capture-gauth').addEventListener('click', async () => {
    const feedback = el('gauth-feedback');
    feedback.textContent = '';
    const res = (await ext.runtime.sendMessage({ type: 'CAPTURE_OPEN_GAUTH' })) as RuntimeResponse;
    if (!res.ok) {
      feedback.textContent =
        res.error === 'no_gauth_tab'
          ? t(currentLang, 'captureNoGauthTab')
          : t(currentLang, 'captureNoQrFound');
      return;
    }
    await ext.runtime.sendMessage({
      type: 'OPEN_SETUP_WITH_IMPORT',
      payload: res.data as never
    });
  });

  el('unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = el<HTMLInputElement>('unlock-passphrase').value;
    const errEl = el('unlock-error');
    errEl.hidden = true;
    const res = (await ext.runtime.sendMessage({
      type: 'UNLOCK_CREDENTIALS',
      passphrase: pass
    })) as RuntimeResponse<CredentialAvailability>;
    if (!res.ok) {
      errEl.textContent = t(currentLang, 'wrongPassphrase');
      errEl.hidden = false;
      return;
    }
    showAvailability(res.data);
  });

  el('btn-lock-now').addEventListener('click', async () => {
    await ext.runtime.sendMessage({ type: 'LOCK_CREDENTIALS' });
    await refreshAll();
  });

  el('btn-copy-6').addEventListener('click', () => copyWithFeedback('btn-copy-6', lastRenderedCode));
  el('btn-copy-full').addEventListener('click', () => {
    if (!activeCreds || !lastRenderedCode) return;
    void copyWithFeedback('btn-copy-full', formatCombinedOtp(activeCreds.pin4, lastRenderedCode));
  });

  const bindSwitch = (
    id: string,
    key: 'autoFill' | 'autoSubmit' | 'keepAliveMoodle' | 'keepAliveCsMoodle',
    updateAlarm = false
  ) => {
    el<HTMLInputElement>(id).addEventListener('change', async (e) => {
      const target = e.currentTarget as HTMLInputElement;
      target.setAttribute('aria-checked', target.checked ? 'true' : 'false');
      await updateSettings({ [key]: target.checked });
      if (updateAlarm) await ext.runtime.sendMessage({ type: 'UPDATE_KEEPALIVE_ALARM' });
    });
  };

  bindSwitch('toggle-autofill', 'autoFill');
  bindSwitch('toggle-autosubmit', 'autoSubmit');
  bindSwitch('toggle-ka-moodle', 'keepAliveMoodle', true);
  bindSwitch('toggle-ka-cs', 'keepAliveCsMoodle', true);

  el('btn-ping-now').addEventListener('click', async () => {
    await ext.runtime.sendMessage({ type: 'PING_KEEPALIVE_NOW' });
    await refreshAll();
  });

  el('btn-open-moodle').addEventListener('click', () => {
    void ext.tabs.create({ url: 'https://moodle.huji.ac.il/' });
  });
});
```

- [ ] **Step 5: Implement Options/Setup page (`options.html`, `options.css`, `options.ts`)**

Write `src/options/options.html`:
```html
<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HUJI Key — Setup &amp; Settings</title>
  <link rel="stylesheet" href="options.css" />
</head>
<body>
  <header class="page-head">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">HK</span>
      <div>
        <h1 data-i18n="optionsTitle">HUJI Key — Setup &amp; Settings</h1>
        <p class="subtitle" data-i18n="unofficialNotice"></p>
      </div>
    </div>
    <div class="lang-group" role="group" data-i18n-aria="langLabel">
      <button type="button" class="lang-btn" data-lang="en" aria-pressed="true">EN</button>
      <button type="button" class="lang-btn" data-lang="he" aria-pressed="false">עב</button>
      <button type="button" class="lang-btn" data-lang="ar" aria-pressed="false">ع</button>
    </div>
  </header>

  <main class="container">
    <section class="card">
      <h2 data-i18n="onboardingHeading">1. Connect Your HUJI OTP</h2>

      <div class="tablist" role="tablist" data-i18n-aria="onboardingHeading">
        <button type="button" role="tab" id="tab-gauth" data-panel="panel-gauth" aria-selected="true" tabindex="0" data-i18n="tabGauth">gauth.huji.ac.il</button>
        <button type="button" role="tab" id="tab-qr" data-panel="panel-qr" aria-selected="false" tabindex="-1" data-i18n="tabQrImage">QR Image</button>
        <button type="button" role="tab" id="tab-uri" data-panel="panel-uri" aria-selected="false" tabindex="-1" data-i18n="tabUri">otpauth:// Link</button>
        <button type="button" role="tab" id="tab-manual" data-panel="panel-manual" aria-selected="false" tabindex="-1" data-i18n="tabManual">Manual Entry</button>
      </div>

      <div role="tabpanel" id="panel-gauth" aria-labelledby="tab-gauth" tabindex="0">
        <div class="panel-inner">
          <p class="hint" data-i18n="gauthStepInstructions"></p>
          <button type="button" id="btn-scan-gauth" class="btn-secondary" data-i18n="scanOpenGauthTab">Scan Open gauth.huji.ac.il Tab</button>
          <p id="gauth-scan-msg" class="inline-msg" role="status" aria-live="polite"></p>
        </div>
      </div>

      <div role="tabpanel" id="panel-qr" aria-labelledby="tab-qr" hidden="until-found">
        <div class="panel-inner">
          <div id="qr-dropzone" class="dropzone" tabindex="0">
            <p class="hint" data-i18n="qrDropLabel"></p>
            <input id="qr-file-input" type="file" accept="image/*" class="visually-hidden" />
            <button type="button" id="btn-qr-file" class="btn-secondary" data-i18n="qrSelectFile">Choose Image</button>
          </div>
          <p id="qr-scan-msg" class="inline-msg" role="status" aria-live="polite"></p>
        </div>
      </div>

      <div role="tabpanel" id="panel-uri" aria-labelledby="tab-uri" hidden="until-found">
        <div class="panel-inner">
          <label for="otpauth-uri" class="field-label" data-i18n="uriInputLabel">Paste otpauth://totp/... Link</label>
          <div class="inline-row">
            <input id="otpauth-uri" type="text" class="ltr-isolate" autocorrect="off" autocapitalize="none" spellcheck="false" />
            <button type="button" id="btn-parse-uri" class="btn-secondary" data-i18n="uriParseBtn">Load Link</button>
          </div>
          <p id="uri-msg" class="inline-msg" role="status" aria-live="polite"></p>
        </div>
      </div>

      <div role="tabpanel" id="panel-manual" aria-labelledby="tab-manual" hidden="until-found">
        <div class="panel-inner">
          <p class="hint" data-i18n="secretInputHint"></p>
        </div>
      </div>

      <form id="credentials-form" class="cred-form" novalidate>
        <p id="import-banner" class="banner ok" role="status" hidden></p>

        <div class="field">
          <label for="input-id9" class="field-label" data-i18n="idInputLabel">HUJI ID Number (9 digits)</label>
          <span id="hint-id9" class="hint" data-i18n="idInputHint"></span>
          <input id="input-id9" name="id9" type="text" inputmode="numeric" maxlength="9" pattern="\d{9}" required class="ltr-isolate" autocomplete="username" autocorrect="off" autocapitalize="none" spellcheck="false" aria-describedby="hint-id9" data-error="err-id9" />
          <span id="err-id9" class="error-msg" data-i18n="idInputError"></span>
          <span id="warn-id9" class="warn-msg" hidden data-i18n="idCheckDigitWarn"></span>
        </div>

        <div class="field">
          <label for="input-pin4" class="field-label" data-i18n="pinInputLabel">Fixed 4-Digit PIN</label>
          <span id="hint-pin4" class="hint" data-i18n="pinInputHint"></span>
          <input id="input-pin4" name="pin4" type="text" inputmode="numeric" maxlength="4" pattern="\d{4}" required class="ltr-isolate" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" aria-describedby="hint-pin4" data-error="err-pin4" />
          <span id="err-pin4" class="error-msg" data-i18n="pinInputError"></span>
        </div>

        <div class="field">
          <label for="input-secret" class="field-label" data-i18n="secretInputLabel">Base32 TOTP Secret</label>
          <span id="hint-secret" class="hint" data-i18n="secretInputHint"></span>
          <input id="input-secret" name="totpSecret" type="text" required class="ltr-isolate" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" aria-describedby="hint-secret" data-error="err-secret" />
          <span id="err-secret" class="error-msg" data-i18n="secretInputError"></span>
        </div>

        <div class="preview-box">
          <div>
            <h3 class="preview-title" data-i18n="previewHeading">Live Verification Preview</h3>
            <p class="hint" data-i18n="previewHint"></p>
          </div>
          <div class="preview-code-wrap">
            <span id="preview-code" class="preview-digits ltr-isolate">------</span>
            <span id="preview-timer" class="chip ltr-isolate"></span>
          </div>
        </div>

        <button type="submit" class="btn-primary" data-i18n="saveCredentialsBtn">Save Credentials Locally</button>
        <p id="save-banner" class="banner ok" role="status" hidden></p>
      </form>
    </section>

    <section class="card">
      <h2 data-i18n="securityHeading">2. Privacy &amp; Master Lock</h2>
      <p class="hint" data-i18n="privacySummary"></p>
      <div id="lock-setup-box">
        <div class="field">
          <label for="lock-pass-1" class="field-label" data-i18n="newPassphraseLabel"></label>
          <input id="lock-pass-1" type="password" minlength="4" autocomplete="new-password" />
        </div>
        <div class="field">
          <label for="lock-pass-2" class="field-label" data-i18n="confirmPassphraseLabel"></label>
          <input id="lock-pass-2" type="password" minlength="4" autocomplete="new-password" />
        </div>
        <button type="button" id="btn-enable-lock" class="btn-secondary" data-i18n="applyLockBtn">Enable Master Lock</button>
      </div>
      <div id="lock-disable-box" hidden>
        <div class="field">
          <label for="lock-pass-remove" class="field-label" data-i18n="disableLockPassphrasePrompt"></label>
          <input id="lock-pass-remove" type="password" autocomplete="current-password" />
        </div>
        <button type="button" id="btn-disable-lock" class="btn-secondary" data-i18n="disableLockBtn">Disable Master Lock</button>
      </div>
      <p id="lock-msg" class="inline-msg" role="status" aria-live="polite"></p>
    </section>

    <section class="card">
      <h2 data-i18n="keepAliveSettingsHeading">3. Moodle Keep-Alive &amp; Safety</h2>
      <div class="field">
        <label for="select-interval" class="field-label" data-i18n="intervalLabel">Background refresh interval</label>
        <select id="select-interval">
          <option value="10" data-i18n="interval10"></option>
          <option value="15" data-i18n="interval15"></option>
          <option value="20" data-i18n="interval20"></option>
        </select>
      </div>
      <label class="switch-row">
        <span data-i18n="moodleCsLabel">CS Moodle (moodle2.cs.huji.ac.il)</span>
        <input id="opt-ka-cs" class="switch-input" type="checkbox" role="switch" />
      </label>
      <div class="row-actions">
        <button type="button" id="btn-reset-guard" class="btn-secondary" data-i18n="resetGuardBtn">Reset Auto-Submit Pause</button>
      </div>
      <p id="safety-msg" class="inline-msg" role="status" aria-live="polite"></p>
    </section>

    <section class="card danger-card">
      <h2 data-i18n="dangerHeading">4. Local Data Control</h2>
      <button type="button" id="btn-open-wipe" class="btn-danger" data-i18n="wipeDataBtn">Delete All Stored Data</button>
      <p id="wipe-msg" class="inline-msg" role="status" aria-live="polite"></p>
    </section>
  </main>

  <dialog id="wipe-dialog" aria-labelledby="wipe-dialog-title">
    <h2 id="wipe-dialog-title" data-i18n="wipeDialogTitle">Delete all HUJI Key data?</h2>
    <p data-i18n="wipeDialogDesc"></p>
    <div class="dialog-actions">
      <button type="button" id="btn-cancel-wipe" class="btn-secondary" data-i18n="cancelBtn">Cancel</button>
      <button type="button" id="btn-confirm-wipe" class="btn-danger" data-i18n="confirmWipeBtn">Delete Everything</button>
    </div>
  </dialog>

  <script src="options.js"></script>
</body>
</html>
```

Write `src/options/options.css`:
```css
:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --border: #e2e8f0;
  --ink: #0f172a;
  --muted: #475569;
  --primary: #1d4ed8;
  --primary-hover: #1e40af;
  --crimson: #991b1b;
  --ok: #059669;
  --warn: #b45309;
  --err: #dc2626;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 24px 16px 48px;
  background: var(--bg);
  color: var(--ink);
  font: 400 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Heebo", "Noto Sans Arabic", sans-serif;
}

.ltr-isolate {
  direction: ltr;
  unicode-bidi: isolate;
}

.visually-hidden:where(:not(:focus-within, :active)) {
  position: absolute !important;
  clip-path: inset(50%) !important;
  overflow: hidden !important;
  width: 1px !important;
  height: 1px !important;
  margin: -1px !important;
  padding: 0 !important;
  border: 0 !important;
  white-space: nowrap !important;
}

.page-head,
.container {
  max-width: 720px;
  margin-inline: auto;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-block-end: 20px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-mark {
  display: inline-grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(155deg, var(--primary) 72%, var(--crimson) 100%);
  color: #ffffff;
  font-weight: 700;
}

.page-head h1 {
  margin: 0;
  font-size: 20px;
}

.subtitle {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.lang-group {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  overflow: hidden;
}

.lang-btn {
  border: 0;
  background: transparent;
  color: var(--muted);
  font: 600 12px/1 inherit;
  padding: 8px 11px;
  cursor: pointer;
}

.lang-btn[aria-pressed="true"] {
  background: var(--primary);
  color: #ffffff;
}

.container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px;
}

.card h2 {
  margin: 0 0 12px;
  font-size: 16px;
}

.tablist {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
  margin-block-end: 12px;
}

[role="tab"] {
  position: relative;
  flex: none;
  border: 0;
  background: transparent;
  color: var(--muted);
  font: 600 13px/1.2 inherit;
  padding: 10px 12px;
  cursor: pointer;
}

[role="tab"][aria-selected="true"] {
  color: var(--primary);
}

[role="tab"][aria-selected="true"]::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  border-block-end: 3px solid var(--primary);
}

.panel-inner {
  padding-block: 6px 14px;
}

.dropzone {
  border: 2px dashed #cbd5e1;
  border-radius: 10px;
  padding: 18px;
  text-align: center;
  background: #f8fafc;
}

.dropzone.dragover {
  border-color: var(--primary);
  background: #eff6ff;
}

.cred-form {
  margin-block-start: 14px;
  padding-block-start: 16px;
  border-top: 1px solid var(--border);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-block-end: 14px;
}

.field-label {
  font-weight: 600;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

input[type="text"],
input[type="password"],
select {
  font: inherit;
  font-size: max(1rem, 1em);
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid #94a3b8;
  border-radius: 8px;
  background: #ffffff;
  color: var(--ink);
}

:is(input:user-invalid) {
  border-color: var(--err);
  background: #fef2f2;
}

.error-msg {
  display: none;
  font-size: 12px;
  color: var(--err);
}

input:user-invalid ~ .error-msg,
input[aria-invalid="true"] ~ .error-msg {
  display: block;
}

.warn-msg {
  font-size: 12px;
  color: var(--warn);
}

.inline-row {
  display: flex;
  gap: 8px;
}

.inline-row input {
  flex: 1;
}

.preview-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  margin-block-end: 14px;
}

.preview-title {
  margin: 0 0 2px;
  font-size: 13px;
}

.preview-code-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-digits {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.chip {
  background: #e2e8f0;
  border-radius: 6px;
  padding: 2px 7px;
  font-size: 12px;
  font-weight: 600;
}

.btn-primary,
.btn-secondary,
.btn-danger {
  min-height: 42px;
  border-radius: 8px;
  padding: 8px 16px;
  font: 600 13px/1.2 inherit;
  cursor: pointer;
}

.btn-primary {
  border: 0;
  background: var(--primary);
  color: #ffffff;
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-secondary {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink);
}

.btn-danger {
  border: 0;
  background: var(--err);
  color: #ffffff;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-block: 8px;
  cursor: pointer;
}

.switch-input {
  appearance: none;
  width: 40px;
  height: 22px;
  border-radius: 999px;
  background: #cbd5e1;
  position: relative;
  cursor: pointer;
}

.switch-input::after {
  content: "";
  position: absolute;
  top: 2px;
  inset-inline-start: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.15s ease;
}

.switch-input:checked {
  background: var(--primary);
}

.switch-input:checked::after {
  transform: translateX(18px);
}

html[dir="rtl"] .switch-input:checked::after {
  transform: translateX(-18px);
}

:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: 2px;
}

.banner {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  margin-block: 10px 0;
}

.banner.ok {
  background: #ecfdf5;
  color: #065f46;
  border: 1px solid #a7f3d0;
}

.inline-msg {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--muted);
}

.row-actions {
  margin-block-start: 10px;
}

dialog {
  max-width: 420px;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px;
  background: var(--surface);
  color: var(--ink);
}

dialog::backdrop {
  background: rgba(15, 23, 42, 0.45);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-block-start: 16px;
}
```

Write `src/options/options.ts`:
```ts
import { decryptCredentials, encryptCredentials, isEncryptedEnvelope } from '../core/crypto';
import { applyDocumentLocale, type MessageKey, t } from '../core/i18n';
import { generateTotp, getTotpWindowInfo, parseOtpAuthUri } from '../core/totp';
import type {
  ExtensionSettings,
  Language,
  PendingGauthImport,
  PlainCredentials,
  RuntimeResponse,
  TotpAlgorithm
} from '../core/types';
import { validateIsraeliId, validatePin4, validateSecret } from '../core/validation';
import { ext } from '../shared/browser';
import { decodeQrFromBlob } from '../shared/qr';
import {
  clearAllData,
  getPendingGauthImport,
  getSettings,
  getStoredCredentials,
  getUnlockedCredentials,
  setPendingGauthImport,
  setStoredCredentials,
  setUnlockedCredentials,
  updateSettings
} from '../shared/storage';
import { initAccessibleValidation, initTablist } from '../shared/ui-a11y';

let currentLang: Language = 'en';
let parsedMeta: { issuer: string; digits: number; period: number; algorithm: TotpAlgorithm } = {
  issuer: 'HUJI',
  digits: 6,
  period: 30,
  algorithm: 'SHA-1'
};

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function applyTranslations(lang: Language): void {
  currentLang = lang;
  applyDocumentLocale(document, lang);

  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n as MessageKey;
    node.textContent = t(lang, key);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((node) => {
    const key = node.dataset.i18nAria as MessageKey;
    node.setAttribute('aria-label', t(lang, key));
  });
  document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.lang === lang ? 'true' : 'false');
  });
  el<HTMLInputElement>('otpauth-uri').placeholder = t(lang, 'uriPlaceholder');
}

async function updatePreview(): Promise<void> {
  const secretCheck = validateSecret(el<HTMLInputElement>('input-secret').value);
  const codeEl = el('preview-code');
  const timerEl = el('preview-timer');
  if (!secretCheck.valid) {
    codeEl.textContent = '------';
    timerEl.textContent = '';
    return;
  }
  const info = getTotpWindowInfo(Date.now(), parsedMeta.period);
  const code = await generateTotp({
    secret: secretCheck.normalized,
    digits: parsedMeta.digits,
    period: parsedMeta.period,
    algorithm: parsedMeta.algorithm
  });
  codeEl.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
  timerEl.textContent = t(currentLang, 'secondsLeft', { seconds: info.secondsRemaining });
}

function applyImportedCandidate(data: {
  totpSecret: string;
  pin4?: string;
  id9?: string;
  issuer?: string;
  digits?: number;
  period?: number;
  algorithm?: TotpAlgorithm;
}): void {
  el<HTMLInputElement>('input-secret').value = data.totpSecret;
  if (data.pin4) el<HTMLInputElement>('input-pin4').value = data.pin4;
  if (data.id9) el<HTMLInputElement>('input-id9').value = data.id9;
  parsedMeta = {
    issuer: data.issuer ?? 'HUJI',
    digits: data.digits ?? 6,
    period: data.period ?? 30,
    algorithm: data.algorithm ?? 'SHA-1'
  };
  const banner = el('import-banner');
  banner.textContent = t(currentLang, 'importedBanner');
  banner.hidden = false;
  void updatePreview();
}

async function handleQrBlob(blob: Blob): Promise<void> {
  const msg = el('qr-scan-msg');
  msg.textContent = '';
  try {
    const raw = await decodeQrFromBlob(blob);
    if (!raw) {
      msg.textContent = t(currentLang, 'qrInvalidImage');
      return;
    }
    const parsed = parseOtpAuthUri(raw);
    applyImportedCandidate(parsed);
  } catch {
    msg.textContent = t(currentLang, 'qrInvalidImage');
  }
}

async function loadInitialState(): Promise<void> {
  const settings: ExtensionSettings = await getSettings();
  applyTranslations(settings.language);

  el<HTMLSelectElement>('select-interval').value = String(settings.keepAliveIntervalMin);
  const csToggle = el<HTMLInputElement>('opt-ka-cs');
  csToggle.checked = settings.keepAliveCsMoodle;
  csToggle.setAttribute('aria-checked', csToggle.checked ? 'true' : 'false');

  el('lock-setup-box').hidden = settings.lockEnabled;
  el('lock-disable-box').hidden = !settings.lockEnabled;

  const stored = await getStoredCredentials();
  const active = isEncryptedEnvelope(stored) ? await getUnlockedCredentials() : stored;
  if (active) {
    el<HTMLInputElement>('input-id9').value = active.id9;
    el<HTMLInputElement>('input-pin4').value = active.pin4;
    el<HTMLInputElement>('input-secret').value = active.totpSecret;
    parsedMeta = {
      issuer: active.issuer,
      digits: active.digits,
      period: active.period,
      algorithm: active.algorithm
    };
  }

  const pending = await getPendingGauthImport();
  if (pending) {
    applyImportedCandidate(pending);
    await setPendingGauthImport(null);
  }

  await updatePreview();
}

document.addEventListener('DOMContentLoaded', () => {
  const tablist = document.querySelector<HTMLElement>('[role="tablist"]');
  if (tablist) initTablist(tablist);

  const { syncField, announce } = initAccessibleValidation(document);
  void loadInitialState();
  setInterval(() => void updatePreview(), 1000);

  document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const lang = btn.dataset.lang as Language;
      await updateSettings({ language: lang });
      applyTranslations(lang);
      await updatePreview();
    });
  });

  el('input-id9').addEventListener('blur', () => {
    const check = validateIsraeliId(el<HTMLInputElement>('input-id9').value);
    el('warn-id9').hidden = !(check.valid && check.checkDigitWarning);
  });

  el('input-secret').addEventListener('input', () => {
    const secretEl = el<HTMLInputElement>('input-secret');
    const res = validateSecret(secretEl.value);
    secretEl.setCustomValidity(res.valid ? '' : t(currentLang, 'secretInputError'));
    void updatePreview();
  });

  el('btn-scan-gauth').addEventListener('click', async () => {
    const msg = el('gauth-scan-msg');
    msg.textContent = '';
    const res = (await ext.runtime.sendMessage({
      type: 'CAPTURE_OPEN_GAUTH'
    })) as RuntimeResponse<PendingGauthImport>;
    if (!res.ok) {
      msg.textContent =
        res.error === 'no_gauth_tab'
          ? t(currentLang, 'captureNoGauthTab')
          : t(currentLang, 'captureNoQrFound');
      return;
    }
    applyImportedCandidate(res.data);
  });

  const fileInput = el<HTMLInputElement>('qr-file-input');
  el('btn-qr-file').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void handleQrBlob(file);
  });

  const dropzone = el('qr-dropzone');
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleQrBlob(file);
  });
  document.addEventListener('paste', (e) => {
    const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
    const blob = item?.getAsFile();
    if (blob) void handleQrBlob(blob);
  });

  el('btn-parse-uri').addEventListener('click', () => {
    const msg = el('uri-msg');
    msg.textContent = '';
    try {
      const parsed = parseOtpAuthUri(el<HTMLInputElement>('otpauth-uri').value);
      applyImportedCandidate(parsed);
    } catch {
      msg.textContent = t(currentLang, 'uriInvalid');
    }
  });

  el('credentials-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const idEl = el<HTMLInputElement>('input-id9');
    const pinEl = el<HTMLInputElement>('input-pin4');
    const secretEl = el<HTMLInputElement>('input-secret');

    const idCheck = validateIsraeliId(idEl.value);
    const pinCheck = validatePin4(pinEl.value);
    const secretCheck = validateSecret(secretEl.value);

    idEl.setCustomValidity(idCheck.valid ? '' : t(currentLang, 'idInputError'));
    pinEl.setCustomValidity(pinCheck.valid ? '' : t(currentLang, 'pinInputError'));
    secretEl.setCustomValidity(secretCheck.valid ? '' : t(currentLang, 'secretInputError'));

    syncField(idEl, false, true);
    syncField(pinEl, false, true);
    syncField(secretEl, false, true);

    const firstInvalid = [idEl, pinEl, secretEl].find((f) => !f.validity.valid);
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const creds: PlainCredentials = {
      id9: idCheck.normalized,
      pin4: pinCheck.normalized,
      totpSecret: secretCheck.normalized,
      ...parsedMeta
    };

    const settings = await getSettings();
    if (settings.lockEnabled) {
      const currentPass = prompt(t(currentLang, 'passphraseLabel')) || '';
      if (!currentPass) return;
      await setStoredCredentials(await encryptCredentials(creds, currentPass));
      await setUnlockedCredentials(creds);
    } else {
      await setStoredCredentials(creds);
    }

    const banner = el('save-banner');
    banner.textContent = t(currentLang, 'savedBanner');
    banner.hidden = false;
    announce(t(currentLang, 'savedBanner'));
  });

  el('btn-enable-lock').addEventListener('click', async () => {
    const p1 = el<HTMLInputElement>('lock-pass-1').value;
    const p2 = el<HTMLInputElement>('lock-pass-2').value;
    const msg = el('lock-msg');
    if (p1.length < 4) {
      msg.textContent = t(currentLang, 'passphraseTooShort');
      return;
    }
    if (p1 !== p2) {
      msg.textContent = t(currentLang, 'passphraseMismatch');
      return;
    }
    const stored = await getStoredCredentials();
    if (stored && !isEncryptedEnvelope(stored)) {
      await setStoredCredentials(await encryptCredentials(stored, p1));
      await setUnlockedCredentials(stored);
    }
    await updateSettings({ lockEnabled: true });
    el('lock-setup-box').hidden = true;
    el('lock-disable-box').hidden = false;
    msg.textContent = t(currentLang, 'lockUpdated');
  });

  el('btn-disable-lock').addEventListener('click', async () => {
    const pass = el<HTMLInputElement>('lock-pass-remove').value;
    const msg = el('lock-msg');
    const stored = await getStoredCredentials();
    try {
      if (stored && isEncryptedEnvelope(stored)) {
        const plain = await decryptCredentials(stored, pass);
        await setStoredCredentials(plain);
        await setUnlockedCredentials(null);
      }
      await updateSettings({ lockEnabled: false });
      el('lock-setup-box').hidden = false;
      el('lock-disable-box').hidden = true;
      msg.textContent = t(currentLang, 'lockUpdated');
    } catch {
      msg.textContent = t(currentLang, 'wrongPassphrase');
    }
  });

  el<HTMLSelectElement>('select-interval').addEventListener('change', async (e) => {
    const val = Number((e.currentTarget as HTMLSelectElement).value) as 10 | 15 | 20;
    await updateSettings({ keepAliveIntervalMin: val });
    await ext.runtime.sendMessage({ type: 'UPDATE_KEEPALIVE_ALARM' });
  });

  el<HTMLInputElement>('opt-ka-cs').addEventListener('change', async (e) => {
    const sw = e.currentTarget as HTMLInputElement;
    sw.setAttribute('aria-checked', sw.checked ? 'true' : 'false');
    await updateSettings({ keepAliveCsMoodle: sw.checked });
    await ext.runtime.sendMessage({ type: 'UPDATE_KEEPALIVE_ALARM' });
  });

  el('btn-reset-guard').addEventListener('click', async () => {
    await ext.runtime.sendMessage({ type: 'RESET_LOGIN_GUARD' });
    el('safety-msg').textContent = t(currentLang, 'guardResetDone');
  });

  const wipeDialog = el<HTMLDialogElement>('wipe-dialog');
  el('btn-open-wipe').addEventListener('click', () => wipeDialog.showModal());
  el('btn-cancel-wipe').addEventListener('click', () => wipeDialog.close());
  el('btn-confirm-wipe').addEventListener('click', async () => {
    await clearAllData();
    el<HTMLInputElement>('input-id9').value = '';
    el<HTMLInputElement>('input-pin4').value = '';
    el<HTMLInputElement>('input-secret').value = '';
    await updatePreview();
    wipeDialog.close();
    el('wipe-msg').textContent = t(currentLang, 'wipedDone');
    await loadInitialState();
  });
});
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/integration/ui.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ui-a11y.ts src/popup/ src/options/ tests/integration/ui.test.ts
git commit -m "feat: add accessible light trilingual popup and 4-way onboarding options UI"
```

---

### Task 10: Store Documentation, Build Validation & Packaging

**Files:**
- Create: `CHROMEWEBSTORE.md`
- Create: `PRIVACY.md`
- Create: `README.md`
- Test: `tests/unit/manifest-build.test.ts`

**Interfaces:**
- Consumes: `scripts/build.mjs`, `scripts/package.mjs`
- Produces: verified `dist/chrome/`, `dist/firefox/`, `.zip` packages, `CHROMEWEBSTORE.md`, `PRIVACY.md`, `README.md`

- [ ] **Step 1: Write failing build-output verification test `tests/unit/manifest-build.test.ts`**

```ts
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Chrome and Firefox MV3 builds', () => {
  it('produces valid Chrome and Firefox manifests with existing files and minimal permissions', () => {
    execSync('npm run build', { stdio: 'pipe' });

    for (const target of ['chrome', 'firefox'] as const) {
      const dir = path.resolve('dist', target);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

      expect(manifest.manifest_version).toBe(3);
      expect(manifest.permissions).toEqual(['storage', 'alarms']);
      expect(manifest.permissions).not.toContain('tabs');
      expect(manifest.host_permissions).toEqual([
        'https://idp.cc.huji.ac.il/*',
        'https://gauth.huji.ac.il/*',
        'https://moodle.huji.ac.il/*',
        'https://moodle2.cs.huji.ac.il/*'
      ]);

      for (const iconPath of Object.values(manifest.icons) as string[]) {
        expect(fs.existsSync(path.join(dir, iconPath))).toBe(true);
      }
      expect(fs.existsSync(path.join(dir, manifest.action.default_popup))).toBe(true);
      expect(fs.existsSync(path.join(dir, manifest.options_ui.page))).toBe(true);

      if (target === 'chrome') {
        expect(manifest.background.service_worker).toBe('background/worker.js');
        expect(manifest.background.scripts).toBeUndefined();
        expect(fs.existsSync(path.join(dir, 'background/worker.js'))).toBe(true);
      } else {
        expect(manifest.background.scripts).toEqual(['background/worker.js']);
        expect(manifest.background.service_worker).toBeUndefined();
        expect(manifest.browser_specific_settings.gecko.data_collection_permissions.required).toEqual([
          'none'
        ]);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to check current build status**

Run: `npx vitest run tests/unit/manifest-build.test.ts`
Expected: PASS (once built by the test) or verify any missing static asset errors are fixed immediately.

- [ ] **Step 3: Write `PRIVACY.md`, `CHROMEWEBSTORE.md`, and `README.md`**

Write `PRIVACY.md`:
```markdown
# Privacy Policy for HUJI Key

**Last updated:** 2026-11-27

HUJI Key is an unofficial, student-built browser extension for Hebrew University of Jerusalem (HUJI) portals.

## Data Collection & Transmission

HUJI Key **does not collect, log, sell, sync, or transmit** any personal data, browsing history, analytics, or telemetry to any developer server or third party.

## How Data Is Stored

All user-entered credentials (9-digit ID, 4-digit PIN, and TOTP secret) and extension preferences remain strictly on your device inside browser local extension storage (`storage.local`). If you enable the optional Master Passphrase lock, credentials are encrypted locally using AES-256-GCM before storage and unlocked only in memory for the current browser session.

## Website Access

Extension permissions are scoped exclusively to the HUJI login, OTP setup, and Moodle domains (`idp.cc.huji.ac.il`, `gauth.huji.ac.il`, `moodle.huji.ac.il`, and `moodle2.cs.huji.ac.il`). Authenticated Moodle session keep-alive checks communicate directly from your browser to HUJI Moodle servers only while enabled and signed in.

## User Control & Deletion

You can inspect, edit, lock, or permanently delete all locally stored credentials and preferences at any time from the extension's Settings page.

## Contact

Questions or privacy inquiries: open an issue on the project repository or contact `qusai.masalmeh@mail.huji.ac.il`.
```

Write `CHROMEWEBSTORE.md`:
```markdown
# Chrome Web Store Listing — HUJI Key — Auto OTP & Moodle Keep-Alive

> Last Updated: 2026-11-27

## Store Listing

**Extension Name**
HUJI Key — Auto OTP & Moodle Keep-Alive

**Short Description**
Unofficial HUJI student helper: instant local auto-OTP login, 1-click gauth QR import, and Moodle session keep-alive.

**Detailed Description**
Save time every time you sign in to Hebrew University of Jerusalem (HUJI) portals without compromising your privacy. HUJI Key is an unofficial, student-built helper that stores your login details locally on your device and automates HUJI OTP sign-in and Moodle session persistence.

Key features:
One-step setup: import your QR code directly from gauth.huji.ac.il, drop or paste a QR screenshot, paste an otpauth:// link, or enter details manually with a live 6-digit verification preview.
Automatic OTP login: automatically switches to the OTP tab, fills your 9-digit ID and combined 4-digit PIN plus rotating 6-digit code, waits cleanly at 30-second boundaries, and pauses automatically if an error appears.
Smart Moodle keep-alive: keeps moodle.huji.ac.il (and optionally moodle2.cs.huji.ac.il) sessions active while you are signed in and pauses automatically when logged out.
Trilingual light interface: full English, Hebrew (RTL), and Arabic (RTL) support with 1-click language switching and quick OTP copy buttons.

Privacy by design:
Everything runs locally in your browser with zero external servers, zero analytics, and no cloud sync. You can also protect your saved details with an optional local Master Passphrase lock and wipe all stored data in one click.

Disclaimer: HUJI Key is an independent, unofficial student tool and is not affiliated with or endorsed by The Hebrew University of Jerusalem.

**Category**
Productivity

**Single Purpose**
Automate HUJI OTP login and keep active HUJI Moodle sessions signed in locally.

**Primary Language**
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ✅ Ready | `dist/chrome/icons/icon-128.png` |
| Screenshot 1 | 1280×800 | ⬜ Capture from browser before upload | |
| Screenshot 2 | 1280×800 | ⬜ Capture from browser before upload | |

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Stores user preferences, keep-alive status, and user-provided HUJI login credentials locally on the device. |
| `alarms` | permissions | Schedules periodic background checks to refresh active HUJI Moodle sessions when keep-alive is enabled. |
| `https://idp.cc.huji.ac.il/*` | host_permissions | Fills the HUJI OTP login form and submits sign-in when auto-fill/auto-submit are enabled. |
| `https://gauth.huji.ac.il/*` | host_permissions | Detects and decodes the student's OTP QR code locally on the HUJI authenticator setup page for 1-click import. |
| `https://moodle.huji.ac.il/*` | host_permissions | Detects active Moodle sign-in status and refreshes the session when Moodle keep-alive is enabled. |
| `https://moodle2.cs.huji.ac.il/*` | host_permissions | Detects active CS Moodle sign-in status and refreshes the session when CS Moodle keep-alive is opted into. |

## Privacy & Data Use

**Does the extension collect user data?** No

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**
Host `PRIVACY.md` on GitHub Pages / public repository URL before submitting.

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-11-27 | Initial Chrome & Firefox MV3 release | Draft |
```

Write `README.md`:
```markdown
# HUJI Key — Auto OTP & Moodle Keep-Alive

Unofficial, free, 100% local browser extension for Hebrew University of Jerusalem (HUJI) students.

## Features

- **4-Way Local Onboarding:** 1-click capture on `gauth.huji.ac.il`, drag/drop/paste QR screenshot, `otpauth://` link paste, or manual entry with live TOTP verification preview.
- **Safe Auto-Login (`idp.cc.huji.ac.il`):** Selects the OTP tab, fills ID + 4-digit PIN + 6-digit TOTP, guards 30s boundaries, and pauses automatically on errors.
- **Smart Keep-Alive:** Refreshes `moodle.huji.ac.il` (and optionally `moodle2.cs.huji.ac.il`) while signed in and pauses automatically once logged out.
- **Privacy First:** Strict permissions (`storage`, `alarms`, and only the 4 HUJI domains — no `tabs` permission), zero telemetry, optional AES-256-GCM Master Lock.
- **Trilingual Light UI:** `EN | עב | ع` with full LTR/RTL support.

## Development & Build

```bash
npm install
npm run typecheck
npm test
npm run pack
```

Outputs:
- Chrome / Brave / Edge / Vivaldi unpacked folder: `dist/chrome/` (and `dist/huji-key-chrome-v1.0.0.zip`)
- Firefox unpacked / AMO package: `dist/firefox/` (and `dist/huji-key-firefox-v1.0.0.zip`)
```

- [ ] **Step 4: Run full verification suite and packaging**

Run:
```bash
npm run typecheck && npm test && npm run pack
```
Expected: All TypeScript checks pass, all unit + integration tests pass, `dist/chrome/` + `dist/firefox/` + both `.zip` archives exist cleanly.

- [ ] **Step 5: Commit**

```bash
git add CHROMEWEBSTORE.md PRIVACY.md README.md tests/unit/manifest-build.test.ts
git commit -m "docs: add Chrome Web Store listing, privacy policy, README, and manifest checks"
```

---

## Self-Review Against Design Spec

- **Permissions & Security:** `["storage", "alarms"]`, zero `"tabs"`, exact 4 HUJI origins, `PBKDF2` `310000` + `AES-256-GCM`, `storage.local` + `storage.session` covered in Tasks 1, 3, 6, 7, 10.
- **4-Way Onboarding:** `gauth` capture, QR image upload/drop/paste, `otpauth://` URI, manual entry + live 6-digit preview covered in Tasks 2, 6, 8, 9.
- **Safe Auto-Login:** `#hujicc-otp-tab`, `#hujicc-otp-username`, `#hujicc-otp-password`, `#hujicc-captcha-btn-otp`, 30s `<3s` boundary wait, loop-guard pause, lock resume covered in Tasks 4, 8.
- **Smart Keep-Alive:** `core_session_touch` + `/my/` `redirect: 'manual'` + auto-pause on `logged_out` covered in Tasks 4, 7, 8, 9.
- **Light UI & Trilingual `EN | עב | ع`:** Logical RTL/LTR CSS, accessible switches, roving-tabindex tabs, `:user-invalid` + synced ARIA, native `<dialog>` wipe confirmation covered in Tasks 5, 9.
