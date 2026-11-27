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

## Support

HUJI Key is completely free and local-only for all students. If it saved you time: [Buy me a coffee](https://buymeacoffee.com/qusaidev) ☕
