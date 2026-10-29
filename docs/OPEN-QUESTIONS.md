# Open questions (need organizer decisions)

Each item is implemented with the safer default behind a `Config` value.

## Hour counting (spec 5.8) — placeholders, organizers must confirm
| Key | Current default | Question |
|---|---|---|
| `WORKDAY_START_HOUR` | 5 | Does a work date start at 05:00? |
| `ROUNDING_MINUTES` | 30 | Round counted time **down** to 30-min steps? |
| `MIN_SESSION_MINUTES` | 30 | Sessions under 30 min count 0 h? |
| `MAX_HOURS_PER_DAY` | 12 | Daily cap 12 h? |
| `POINTS_PER_HOUR` | blank | Show points, and how many per hour? |
| `LATE_MINUTES` | 15 | Late after 15 min? |

## Other
- **Frontend default env** is `test` (`frontend/config.js`) during development. Switch to `prod` before the real event.
- **Accounts**: TEST/PROD currently run on the developer's personal Google/GitHub accounts. Move to an event-owned account before handover; add a second super admin (spec risk #21).
- **Errors log volume**: every API error is logged, including expected ones (e.g. expired login). If the sheet grows too fast, consider skipping `UNAUTHENTICATED`.
