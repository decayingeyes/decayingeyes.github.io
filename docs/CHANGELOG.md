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

## 0.3.0 — 2026-10-30 (M3 + M4)
- M3: member portal (today/history/totals/reports), report queue, hourly auto-close of forgotten checkouts, alerts, Thai summary tabs.
- M4: corrections with two-person approval, period close/reopen, CSV export, admin page.
- **Head self-report (decision of 2026-10-29, option ก):** new action `me.selfReport` (deputy and up). A self-reported session counts 0 h (`NEEDS_REVIEW`) and creates a `SELF_REPORT` correction; it counts only after a unit admin approves. No photos (spec: "No photos"). Scanning yourself is still blocked.
- `Corrections`: added trailing columns `Type` (CORRECTION | SELF_REPORT), `WorkDate`, `ReportID`. Existing sheets get them automatically on the next setup run (trailing-column migration).
- Period export is written as a tab in the spreadsheet (and downloaded as CSV) instead of a separate Drive file, to avoid requesting an additional Drive scope.
- Closing a period is refused while sessions in the range are still OPEN or corrections are PENDING.
- Security: formula-injection guard on every sheet write and CSV cell; unit admins cannot modify super admins via roster import.

## 0.4.0 — 2026-10-30
- Site renamed: repository and URL are now `decaying-eyes` (https://0991189444a-source.github.io/decaying-eyes/).
- **Positions are assigned only by admins** (decision 2026-10-30): web roster imports ignore the Role column (new people join as `member`, existing roles are kept); roles change only via `role.set`. Unit admins assign up to `head` in their unit; creating or changing admins is for super admins. Nobody changes their own role. Sheet-menu import (owner) and TEST seed may still set roles.
- New action `roster.list` (admin member list). New log action `ROLE_SET`.
- Role/status changes apply immediately (per-member cache epoch) instead of after up to 10 minutes.
- Corrections may not overlap another session of the same member (checked on propose and again on approve); approval writes the hours before marking the request APPROVED.
- Site moved to https://decayingeyes.github.io/ (GitHub account renamed to `decayingeyes`, repository renamed to `decayingeyes.github.io`).

## 0.5.0 — 2026-10-30
- **Card photos (owner decision 2026-10-30; spec v4 said "No photos" — organizers should be informed).** Heads (own team) and unit admins photograph members in person; nobody sets their own photo. Stored as a small JPEG data URL in the new `Photos` sheet (no extra Google scope). Shown on the member card (screen + PNG) and large on the scan result screen for face comparison. New action `photo.set`, log action `PHOTO_SET`.
- Scan page: spoken confirmation ("ยืนยันการเข้างานของ <ชื่อ>") with an on/off toggle.
- Website default switched to PROD; demo data remains under `?env=test`.
- Roster import: only StudentID, first name, last name and nickname are required; blank department/team become "ยังไม่จัดฝ่าย"/"ยังไม่จัดทีม" for new people and are kept for existing people.
- **Self sign-up with admin approval (decision 2026-10-30):** `auth.signup` (public) creates a PENDING member (role member, "ยังไม่จัดทีม") with the chosen password; `signup.list` / `signup.review` let unit admins approve (ACTIVE) or reject (REJECTED, may sign up again). Login for a pending account says "รอแอดมินอนุมัติ" only after the password matched. Max 500 pending sign-ups. Activation codes keep working alongside.
