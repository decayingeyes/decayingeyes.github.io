# Changelog

## 0.1.0 — 2026-10-29 (M0)
- Project skeleton, API router, permissions table, error log, spreadsheet initializer, env switching, Pages workflow.

### Data model deviations from spec v4 section 6
- `Schedules`: the spec column "StudentID or TeamID" is split into two columns, `StudentID` and `TeamID`; exactly one is filled per row. Reason: a single column holding two kinds of id is ambiguous to validate and to filter.
- `Log.Action`: added `ROSTER_IMPORT` (roster import is not a password reset; `RESET` stays for activation-code issuing).
- `AuthSessions.Token` stores the SHA-256 of the token, not the token itself, so the sheet cannot be used to log in.
