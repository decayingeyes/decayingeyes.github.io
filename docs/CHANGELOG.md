# Changelog

## 0.1.0 — 2026-10-29 (M0)
- Project skeleton, API router, permissions table, error log, spreadsheet initializer, env switching, Pages workflow.

### Data model deviations from spec v4 section 6
- `Schedules`: the spec column "StudentID or TeamID" is split into two columns, `StudentID` and `TeamID`; exactly one is filled per row. Reason: a single column holding two kinds of id is ambiguous to validate and to filter.
- `Log.Action`: added `ROSTER_IMPORT` (roster import is not a password reset; `RESET` stays for activation-code issuing).
- `AuthSessions.Token` stores the SHA-256 of the token, not the token itself, so the sheet cannot be used to log in.

## 0.2.0 — 2026-10-29 (M2)
- Scanning: `scan.lookup` / `scan.confirm`, hour rules, WorkSessions writes, scan page.
- **Card shows a QR code of the same payload under the official Code 128 barcode; the scanner accepts both.** Reason: in testing, phone cameras did not read Code 128 off a phone/monitor screen, while QR (error correction, 2-D finder patterns) reads reliably. Code 128 stays for USB/Bluetooth scanners and printed cards. Payload and HMAC check are unchanged, so security is the same.
- Scanner switched from html5-qrcode to ZXing directly (full HD, TRY_HARDER).
