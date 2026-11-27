# HUJI Key — Auto OTP & Moodle Keep-Alive Design Spec

**Date:** 2026-11-27  
**Status:** Approved design draft awaiting final user spec review  
**Targets:** Chrome / Chromium (Brave, Edge, Vivaldi, Arc) & Mozilla Firefox (Manifest V3)

---

## 1. Overview & Goals

Build a free, open, privacy-first browser extension for Hebrew University of Jerusalem (HUJI) students that unifies three previously fragmented workflows into one polished, local-only tool:

1. **Effortless Onboarding (Zero Manual Secret Copying):** Capture the QR code + 4-digit PIN directly on `gauth.huji.ac.il`, upload/drag-and-drop/paste a QR screenshot, paste an `otpauth://` URI, or enter credentials manually — with a live 6-digit preview before saving.
2. **Fast, Safe Auto-Login:** Auto-fill ID (`tz9`) and `pin4 + totp6` on HUJI's unified SimpleSAML IdP (`idp.cc.huji.ac.il`) and optionally auto-submit with reCAPTCHA-safe click behavior, 30s-boundary guarding, and loop protection.
3. **Smart Moodle Keep-Alive:** Keep sessions active for `moodle.huji.ac.il` (and optionally `moodle2.cs.huji.ac.il`) via in-tab and periodic background checks while signed in, pausing automatically if logged out.
4. **Maximal Student Trust:** Strict minimal permissions (`["storage", "alarms"]`, **no `"tabs"`**), host access limited exclusively to the four HUJI domains, 100% local storage (`storage.local`), optional Master Lock encryption, zero analytics/network telemetry, and a clean light UI in **English (default, LTR)**, **Hebrew (RTL)**, and **Arabic (RTL)**.

> **Branding note for store compliance:** The extension must be clearly labeled as an **unofficial, student-built helper** for HUJI portals (not affiliated with or endorsed by The Hebrew University of Jerusalem).

---

## 2. Architecture & Cross-Browser Packaging

### 2.1 Directory Layout

```text
src/
  core/
    totp.ts          # RFC 6238 TOTP (WebCrypto HMAC-SHA1/256/512) + Base32 + otpauth:// parser
    crypto.ts        # Optional AES-GCM + PBKDF2 Master Lock encryption/decryption
    validation.ts    # 9-digit Israeli ID check-digit warning, 4-digit PIN, Base32 validation
    loop-guard.ts    # Pure state machine preventing repeat failed auto-submits
    keepalive.ts     # Moodle session ping / redirect-logout classifier
    i18n.ts          # Compile-time checked EN / HE / AR translations + RTL helpers
    types.ts         # Shared data & message contracts
  shared/
    browser.ts       # Promise-based cross-browser wrapper (storage, alarms, runtime, tabs)
    storage.ts       # Typed storage.local + storage.session accessors & defaults
    qr.ts            # Local QR decoding helper wrapping jsQR across ImageData/Canvas
  background/
    worker.ts        # MV3 service worker (Chrome) / event script (Firefox)
  content/
    idp-login.ts     # idp.cc.huji.ac.il OTP form filler, boundary guard, status pill
    gauth-capture.ts # gauth.huji.ac.il QR + 4-digit PIN detector & one-click import trigger
    moodle-keepalive.ts # In-tab Moodle logged-in detector & sesskey reporter
  popup/
    popup.html
    popup.css
    popup.ts
  options/
    options.html
    options.css
    options.ts
assets/
  icons/             # Generated PNG icons (16x16, 32x32, 48x48, 128x128)
scripts/
  generate-icons.mjs # Generates exact-size PNG icons from a single vector definition
  build.mjs          # esbuild bundler + per-browser manifest generator (dist/chrome, dist/firefox)
  package.mjs        # Creates store-ready .zip archives excluding dev artifacts
tests/
  fixtures/          # Sanitized real HUJI SimpleSAML login HTML & mock Moodle/gauth DOMs
  unit/              # Core logic tests
  integration/       # jsdom tests against HUJI DOM fixtures
```

### 2.2 Build Pipeline & Dual-Target Manifests

`scripts/build.mjs` compiles TypeScript with `esbuild` into self-contained IIFE scripts (avoiding ES-module chunk loading issues inside MV3 content scripts and service workers) and outputs two clean directories:

* **`dist/chrome/manifest.json`**
  * `"manifest_version": 3`
  * `"background": { "service_worker": "background/worker.js" }`
* **`dist/firefox/manifest.json`**
  * `"manifest_version": 3`
  * `"background": { "scripts": ["background/worker.js"] }`
  * `"browser_specific_settings": { "gecko": { "id": "huji-key@student-tools.local", "strict_min_version": "140.0", "data_collection_permissions": { "required": ["none"] } } }`

### 2.3 Permissions & Content Security Policy

* **`permissions`:** `["storage", "alarms"]`
  * Intentionally omits `"tabs"` so browsers do **not** display a *"Read your browsing history"* permission warning. Reading URLs via `tabs.query` works solely for tabs matching declared `host_permissions`.
* **`host_permissions`:**
  * `"https://idp.cc.huji.ac.il/*"`
  * `"https://gauth.huji.ac.il/*"`
  * `"https://moodle.huji.ac.il/*"`
  * `"https://moodle2.cs.huji.ac.il/*"`
* **`options_ui`:** `{ "page": "options/options.html", "open_in_tab": true }`
* **`content_scripts` (`run_at: "document_idle"`):**
  * `https://idp.cc.huji.ac.il/simplesaml/module.php/hujicc/login*` → `content/idp-login.js`
  * `https://gauth.huji.ac.il/*` → `content/gauth-capture.js`
  * `https://moodle.huji.ac.il/*`, `https://moodle2.cs.huji.ac.il/*` → `content/moodle-keepalive.js`
* **CSP:** Standard MV3 (`script-src 'self'; object-src 'self'`) — no inline scripts, no `eval`, no external network calls from extension pages.

---

## 3. Data Model & Security

### 3.1 `storage.local` Schema (Device-Only, Never Synced)

```ts
interface PlainCredentials {
  id9: string;        // 9-digit HUJI ID
  pin4: string;       // 4-digit fixed PIN prefix
  totpSecret: string; // Normalized Base32 secret
  issuer: string;     // Default "HUJI"
  digits: number;     // Default 6
  period: number;     // Default 30
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512'; // Default 'SHA-1'
}

interface EncryptedCredentialsEnvelope {
  encrypted: true;
  saltB64: string;       // 16-byte random salt
  ivB64: string;         // 12-byte random IV
  ciphertextB64: string; // AES-256-GCM over JSON(PlainCredentials)
  iterations: 310000;    // PBKDF2 SHA-256 iterations
}

interface ExtensionSettings {
  language: 'en' | 'he' | 'ar';       // Default 'en'
  autoFill: boolean;                  // Default true
  autoSubmit: boolean;                // Default true
  lockEnabled: boolean;               // Default false
  keepAliveMoodle: boolean;           // Default true
  keepAliveCsMoodle: boolean;         // Default false
  keepAliveIntervalMin: 10 | 15 | 20; // Default 15
}

type SiteKey = 'moodle' | 'csMoodle';
type SiteStatus = 'ok' | 'logged_out' | 'paused' | 'error' | 'never';

interface KeepAliveSiteState {
  status: SiteStatus;
  lastPingAt: number | null;
  lastLoggedInAt: number | null;
  lastError?: string;
  sesskey?: string; // Ephemeral Moodle sesskey hint when tab reported active session
}

// Stored under storage.local keys:
// - credentials: PlainCredentials | EncryptedCredentialsEnvelope | null
// - settings: ExtensionSettings
// - keepAliveStates: Record<SiteKey, KeepAliveSiteState>
```

### 3.2 `storage.session` Schema (Cleared on Browser Close)

* `unlockedCredentials`: `PlainCredentials | null` — populated only while Master Lock is enabled and unlocked for the current browser session.
* `loginAttemptGuard`: `{ attempts: Array<{ timestamp: number; authStateKey: string }>; pausedUntilErrorCleared: boolean }` — tracks recent auto-submits to prevent retry loops.
* `pendingGauthImport`: `{ totpSecret: string; pin4?: string; id9?: string; issuer?: string; digits?: number; period?: number; algorithm?: 'SHA-1' | 'SHA-256' | 'SHA-512'; capturedAt: number } | null` — handoff buffer when user clicks **Import** from `gauth.huji.ac.il`.

### 3.3 Master Lock Cryptography

* When Master Lock is enabled, the user chooses a passphrase.
* `PBKDF2` (SHA-256, 310,000 iterations, random 16-byte salt) derives a 256-bit `AES-GCM` key via WebCrypto (`crypto.subtle`).
* The plaintext credential JSON is encrypted with a fresh 12-byte IV (`EncryptedCredentialsEnvelope`) and replaces plaintext credentials in `storage.local`.
* Unlocking in the popup decrypts in memory and caches `unlockedCredentials` in `storage.session` (never persisted to disk). Locking immediately wipes `storage.session.unlockedCredentials`.

---

## 4. Core Component Flows

### 4.1 Four-Way Local Onboarding

Available in `options/options.html` (and triggered cleanly from popup empty state):

1. **1-Click `gauth.huji.ac.il` Capture:**
   * `gauth-capture.ts` watches the page (including dynamic DOM changes after clicking "Show QR") for any rendered QR code inside `<img>`, `<canvas>`, or `<svg>`.
   * Decodes via offscreen `<canvas>` + bundled `jsQR` (works identically in Chrome and Firefox).
   * Heuristically scans visible text near code/PIN labels for a standalone 4-digit PIN candidate (never auto-saves silently; pre-fills an editable confirmation card).
   * Clicking **"Save to HUJI Key"** sends `OPEN_SETUP_WITH_IMPORT` to `background/worker.ts`, which writes `storage.session.pendingGauthImport` and calls `runtime.openOptionsPage()` so the user confirms and saves in one click (or the user clicks **"Capture from open `gauth` tab"** inside Popup/Options).
2. **QR Image Upload / Drag-and-Drop / Paste:**
   * Accepts file picker (`png`, `jpg`, `jpeg`, `webp`, `svg`), drag-and-drop, and clipboard `paste` events (`Ctrl/Cmd+V`).
   * Renders the image to an offscreen `<canvas>` (using `createImageBitmap` or `Image` + canvas scaling for dense/high-DPI screenshots) and runs `jsQR`.
3. **`otpauth://` Link Paste:**
   * Parses `otpauth://totp/<label>?secret=...&issuer=...&digits=...&period=...&algorithm=...`, ignoring surrounding whitespace.
   * Rejects `otpauth://hotp/...` with a clear localized error explaining HUJI uses time-based TOTP.
4. **Manual Entry:**
   * 9-digit ID input (runs Israeli ID Luhn-variant check digit to show a *non-blocking* gentle warning if mistyped, allowing international/passport IDs if needed).
   * 4-digit numeric PIN input.
   * Base32 secret input (strips spaces/hyphens, uppercases, validates Base32 alphabet and minimum length).

All four paths share one **Live Verification Preview** before clicking Save: displays the real-time 6-digit TOTP and countdown bar so the student can verify it matches `gauth.huji.ac.il` or their phone before committing.

### 4.2 Safe Auto-Login (`content/idp-login.ts`)

Target page: `https://idp.cc.huji.ac.il/simplesaml/module.php/hujicc/login*`.

Selectors grounded in HUJI's SimpleSAML markup:
* Tab switch: `#hujicc-otp-tab`, pane `#hujicc-otp`
* Form: `#hujicc-form-otp`
* Inputs: `#hujicc-otp-username` (`name="username"`), `#hujicc-otp-password` (`name="o_password"`)
* Submit button: `#hujicc-captcha-btn-otp`

Execution flow:
1. Check `settings.autoFill`. If disabled, inject nothing beyond passive listener for manual popup fill trigger.
2. Ensure `#hujicc-otp-tab` is active (`aria-selected="true"` / `#hujicc-otp.active.show`); if `#hujicc-sms-tab` is active, click `#hujicc-otp-tab` cleanly.
3. Request decrypted credentials / lock status from background/storage:
   * **Unconfigured:** Show subtle light inline pill linking to Setup.
   * **Locked:** Show subtle inline pill prompting user to click the extension icon to unlock, and listen for `storage.onChanged` on `storage.session` so unlocking in the popup immediately resumes auto-fill on the already-open login tab!
4. **Error & Loop Guard Evaluation (`loop-guard.ts`):**
   * Check DOM for error indicators (`.alert-danger`, `.alert.alert-warning`, `[role="alert"]`, or server error text inside `#hujicc-form-otp` / `#hujicc-tabContent`).
   * Derive `authStateKey` from URL `AuthState` parameter prefix (fallback to pathname) and evaluate `storage.session.loginAttemptGuard`.
   * If a page error is visible OR `>= 2` auto-submit attempts occurred within the last `60s`, **pause auto-submit** and display an inline warning pill with a **"Fill & Retry Once"** button (resetting the guard only on explicit user click).
5. **TOTP Boundary Guard:**
   * Compute `secondsRemaining` in current 30s period.
   * If `secondsRemaining < 3` and `autoSubmit` is enabled, show *"Fresh code in Xs..."* in the inline pill and wait until the new TOTP step starts before filling and submitting.
6. **Fill & Submit:**
   * Compute `totp = await generateTotp(...)` and set `#hujicc-otp-username.value = id9`, `#hujicc-otp-password.value = pin4 + totp`, dispatching `input` and `change` events with `{ bubbles: true }`.
   * If `autoSubmit` is enabled and loop guard allows:
     * Record attempt timestamp in `storage.session.loginAttemptGuard`.
     * Wait up to `1500ms` for `#hujicc-captcha-btn-otp` to be enabled and the page's reCAPTCHA widget container (`iframe[src*="recaptcha"]` inside `#hujicc-form-otp`) to be mounted if reCAPTCHA is active on the page (never attempts to bypass or solve any challenge).
     * Trigger `#hujicc-captcha-btn-otp.click()`. If an interactive reCAPTCHA challenge appears or a form validation issue occurs, the extension stays hands-off so the user completes it normally.

### 4.3 Smart Moodle Keep-Alive (`content/moodle-keepalive.ts` + `background/worker.ts`)

Targets:
* Primary: `https://moodle.huji.ac.il/*` (enabled by default)
* CS Moodle: `https://moodle2.cs.huji.ac.il/*` (opt-in toggle, off by default)

How it works without generating false logins or broken requests:
1. **Session discovery (`moodle-keepalive.ts`):**
   * On any Moodle page load, checks whether the DOM represents an authenticated Moodle view (presence of user menu / `#user-menu-toggle` / `.usermenu` / logout link and absence of guest/login-only view) and extracts `M.cfg?.sesskey` (via inline script-safe DOM inspection such as `a[href*="logout.php?sesskey="]` or `input[name="sesskey"]` without violating isolated-world boundaries!).
   * Reports `{ origin, loggedIn: true, sesskey }` to the background worker, which marks the site `ok` and resets any `logged_out` pause.
   * If the user visits `/login/` or logout page, reports `loggedIn: false`, marking status `logged_out`.
2. **Periodic Keep-Alive (`background/worker.ts`):**
   * Uses `chrome.alarms` (`huji-moodle-keepalive`, interval 10 / 15 / 20 min, default 15 min; recreated idempotently on `onInstalled`, `onStartup`, and settings updates).
   * For each enabled site whose state is not `logged_out`:
     * If a valid `sesskey` was observed recently, sends `POST <origin>/lib/ajax/service.php?sesskey=<sesskey>&info=core_session_touch` with `credentials: 'include'` and payload `[{ index: 0, methodname: 'core_session_touch', args: {} }]`.
     * If `sesskey` is unavailable or returns an invalid-session/login-required error, falls back to `GET <origin>/my/` with `credentials: 'include'` and `redirect: 'manual'`.
     * **Classifier (`core/keepalive.ts`):**
       * HTTP `3xx` / `opaqueredirect`, or redirect/response pointing to `idp.cc.huji.ac.il` or `/login/`, or JSON `[{ error: true }]` session-expired errorcode (`servicerequireslogin` / `invalidsesskey`) → classifies as **`logged_out`**, clears stale `sesskey`, and **pauses** future background pings for that site until the student signs into Moodle again.
       * HTTP `200` (with `core_session_touch` success `[{ error: false, data: true }]` or authenticated `/my/` HTML containing `logout.php?sesskey=`) → refreshes cached `sesskey` if present, updates `lastPingAt`, and sets status `ok`.
       * Network failure (offline / campus VPN hiccup) → marks transient `error` without permanently pausing, retrying on the next alarm tick.

---

## 5. Light UI & Trilingual i18n (`EN` / `HE` / `AR`)

### 5.1 Visual System (Light Theme)

* **Surface & Contrast:** Background `#F8FAFC`, elevated cards `#FFFFFF`, hairline borders `#E2E8F0`, primary text `#0F172A`, secondary text `#475569`.
* **Accents:** Primary cobalt `#1D4ED8` (hover `#1E40AF`), subtle HUJI crimson accent `#991B1B` on the small brand mark only, emerald `#059669` for active status/copied states, amber `#B45309` for paused/warning states, soft red `#DC2626` for validation errors.
* **Typography:** System sans (`system-ui, -apple-system, "Segoe UI", Roboto, "Heebo", "Noto Sans Arabic", sans-serif`) + tabular numerals (`font-variant-numeric: tabular-nums`) on live 6-digit TOTP codes and countdown rings.
* **Layout & Accessibility:** Visible focus rings, semantic `<button>` / `<input type="checkbox" role="switch">` controls, `aria-live="polite"` status announcements, and zero horizontal scroll at `360px` popup width.

### 5.2 Trilingual Localization (`EN` default, `HE`, `AR`)

* Languages: `en` (English, default, `dir="ltr"`), `he` (עברית, `dir="rtl"`), `ar` (العربية, `dir="rtl"`).
* Stored in `src/core/i18n.ts` with a strict TypeScript type ensuring every string key exists across all three locales.
* Layout uses CSS logical properties (`padding-inline`, `margin-inline`, `inset-inline-end`, `text-align: start`) so RTL flips seamlessly.
* Numeric tokens (`id9`, `pin4`, 6-digit TOTP, `otpauth://`, HUJI URLs) always carry `dir="ltr"` and `unicode-bidi: isolate` inside RTL prose.
* Quick language pill (`EN | עב | ع`) sits in the top bar of both popup and options pages for instant 1-click switching.

---

## 6. Verification & Store Readiness

### 6.1 Automated Test Suite (`Vitest` + `jsdom`)

* **Unit tests (`tests/unit/`):**
  * `totp.test.ts`: RFC 6238 SHA-1/SHA-256/SHA-512 test vectors, Base32 normalization/padding, `otpauth://` parser valid/invalid/HOTP rejection.
  * `crypto.test.ts`: AES-GCM encrypt/decrypt round-trip, wrong passphrase failure, random salt/IV uniqueness.
  * `validation.test.ts`: 9-digit ID validation (valid/warning check-digit/length), 4-digit PIN, Base32 validation.
  * `loop-guard.test.ts`: Allows first 2 attempts, pauses on error alert or rapid repeat within 60s, resets after window or explicit retry.
  * `keepalive.test.ts`: Classifies `200 OK` vs `opaqueredirect` vs SAML redirect vs Moodle `servicerequireslogin` JSON vs network error.
  * `i18n.test.ts`: Verifies complete key parity and non-empty strings across `en`, `he`, `ar`.
* **Integration tests (`tests/integration/`):**
  * `idp-login.test.ts`: Runs against a sanitized fixture of HUJI's actual `idp.cc.huji.ac.il` SimpleSAML HTML (`#hujicc-otp-tab` switch, `#hujicc-otp-username` + `#hujicc-otp-password` filled with `pin4 + totp6`, `#hujicc-captcha-btn-otp` click, error banner pause, locked-state resume).
  * `qr-and-gauth.test.ts`: Generates real QR PNG/ImageData and verifies local `jsQR` decoding + `gauth` DOM QR + 4-digit PIN heuristic extraction.
  * `moodle-keepalive.test.ts`: Verifies Moodle logged-in `sesskey` extraction from `logout.php?sesskey=...` links and login-page `logged_out` detection.

### 6.2 Build, Packaging & Store Docs

* `npm run typecheck && npm test && npm run build` must succeed cleanly after final edits.
* Verify `dist/chrome/` and `dist/firefox/` manifests, PNG icon dimensions (`16`, `32`, `48`, `128`), and zero missing file references.
* Create `CHROMEWEBSTORE.md` and `PRIVACY.md` (with plain-English permission justifications, zero-data-collection disclosure, and unofficial-tool disclaimer) ready for Chrome Web Store and Firefox AMO submission.
