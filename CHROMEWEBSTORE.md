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
