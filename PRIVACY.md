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
