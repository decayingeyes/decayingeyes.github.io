# Project Spec v4: Event Staff Attendance + Haunted House Ticket Booking

> Build-ready spec for Claude Code. Replaces v1–v3.
> v4 adds: no self-scanning, backup scanners, approval flow for corrections, auto-close of open sessions, hour-counting rules, period closing, test mode, error log, server-time-only rule, shift schedules, and a summary dashboard. It also adds repo layout, API list, milestones and acceptance criteria.

---

## 0. Instructions for Claude Code
- Work **milestone by milestone** (section 10). Finish and test one before starting the next. At the end of each milestone, update `docs/README-TH.md` and list what was done and what is left.
- **Separate pure logic from Google services.** Put rules (hour calculation, rounding, permissions, barcode check, validation) in plain JS files with no Apps Script globals, so they can be unit-tested in Node. Apps Script files are thin adapters (Sheets, Cache, Lock, Properties).
- Use **clasp** for Apps Script projects; keep them deployable by copy-paste too (documented in README).
- **Do not change the data model** (section 6) without writing the change and reason into `docs/CHANGELOG.md`.
- Default to the **test environment** while developing; never write to the production spreadsheet from tests.
- If something in this spec is ambiguous, pick the safer option, implement it behind a `Config` value, and note it in `docs/OPEN-QUESTIONS.md`.

---

## 1. Context
- University student event, unpaid volunteers. Haunted house unit (แผนก): ~40 people. Whole event: ~190 people across several units. If successful, the system will be proposed to the other units → **multi-unit from day one**.
- Volunteers earn activity points from hours worked → data must be trustworthy, and members must be able to check their own records.
- Each member: **student ID**, first/last name, **nickname**, unit, department (ฝ่าย), team (ทีม), optional shift (e.g. ghost actors กะ 1 / กะ 2).
- Everything **free**; minimize staff needed to run it.
- UI **Thai**; code/comments/docs for developers **English**; user guides **Thai**. Mobile-first, mainly iPhone Safari.
- Accepted by organizers (not concerns): venue internet quality, personal-data policy. **No photos, no face comparison.**

## 2. Core concept (staff attendance)
- Every member has a **fixed, official personal barcode** (Code 128). It never rotates.
- **Heads scan members in person.** Anti-cheating relies on the head physically seeing and knowing the person. If someone does not come, they are simply not scanned.
- Members **log in to a member portal** that shows only their own card and attendance — a separate, limited page, not the admin backend.

## 3. Systems
| System | Scope | Users |
|---|---|---|
| **B. Staff Attendance** (core, multi-unit) | ID cards, scanning, member portal, head tools, admin, schedules, dashboard | ~190 staff, heads, deputies, admins |
| **A. Ticket Booking** (haunted house module) | Time-slot booking with payment slip, verified at the door | Visitors, door staff |

Systems are independent: separate Apps Script backend and spreadsheet each.

## 4. Architecture
- **Frontend**: static site on **GitHub Pages** (free HTTPS). Required because Apps Script HtmlService runs in a sandboxed iframe that cannot use the camera on iOS. Plain HTML/CSS/JS or a light framework with static build.
- **Backend**: **Google Apps Script web app** (Execute as: Me, Access: Anyone) as a JSON API.
- **Database**: **Google Sheets**; payment slips in **Google Drive**.
- **API**: one `doPost(e)` routing by `action`. Requests use `Content-Type: text/plain;charset=utf-8` with a JSON string body (avoids CORS preflight; Apps Script cannot answer OPTIONS). Responses are JSON via `ContentService`: `{ ok, data | error: { code, messageTh }, requestId, apiVersion, env }`.
- **Auth enforced server-side**: identity and role always come from the session token; the server never trusts student ID, unit, role or timestamps sent by the client.
- **Server time only**: every timestamp is created on the server (`new Date()` in Apps Script, timezone `Asia/Bangkok`). The client never sends times. The frontend may display server time.
- Config in `Config` sheet (cached in `CacheService`); secrets (HMAC key, password pepper) in **Script Properties**.
- `LockService` around every check-then-write.
- **Environments**: `TEST` and `PROD`, each with its own spreadsheet and deployment. Script Property `ENV`. Frontend selects backend from `frontend/config.js` (`?env=test` switches to test). Test mode shows a visible banner **"โหมดทดสอบ"**.

### 4.1 Repo layout
```
/frontend            static site for GitHub Pages
  config.js          backend URLs per env
  staff/             activate, login, portal, scan, team, admin, dashboard
  booking/           booking + confirmation
/backend-staff       Apps Script (clasp) — System B
  core/              pure logic (unit-tested)
  adapters/          Sheets/Cache/Lock/Properties wrappers
/backend-booking     Apps Script (clasp) — System A
/tests               Node tests for core logic + API contract tests against TEST env
/docs                README-TH.md, ADOPTION-GUIDE-TH.md, CHANGELOG.md, OPEN-QUESTIONS.md
/.github/workflows   Pages deploy
```

---

## 5. System B — Staff Attendance

### 5.1 Organization model
`Unit (แผนก)` → `Department (ฝ่าย)` → `Team (ทีม)` → `Member`. All are data rows, not hard-coded. Every record carries `UnitID`. Phase 1 loads only the haunted house unit.

### 5.2 Roles and permissions
| Role | Can do | Can see |
|---|---|---|
| **member** | Log in, view/save own card, view own attendance, report a problem | Only own data |
| **deputy** (รองหัวหน้า / ผู้สแกนสำรอง) | Scan members of assigned team(s) | Assigned team status |
| **head** (หัวหน้าทีม) | Scan own team, issue activation codes for own team, **propose** corrections, resolve reports | Own team |
| **unit_admin** | Scan anyone in unit, manage roster/teams/roles/schedules, **approve** corrections, close periods, export | Own unit only |
| **super_admin** | Manage units and unit admins, reopen closed periods | All units |

Hard rules (enforced in core logic, unit-tested):
1. **Nobody can scan themselves** in or out. A head/deputy must be scanned by another head, deputy or admin.
2. **Nobody can propose or approve a correction to their own record.**
3. **Approver ≠ proposer**, and approver must be `unit_admin` or higher in the same unit.
4. Members cannot read anyone else's data; member endpoints take **no** student ID parameter.
5. Unit admins are scoped to their unit on every query.
6. Only super admins have direct spreadsheet edit access; everyone else uses web pages.

**Backup scanners**: a head can be absent or late, so scanning permission is also granted via `ScannerAssignments` (deputy for a team, optionally limited to a date/shift). Unit admins can always scan within their unit.

### 5.3 Activation and login
1. Admin imports roster (CSV paste or sheet): StudentID, FirstName, LastName, Nickname, Unit, Department, Team, Shift, Role.
2. System generates a **one-time activation code** per member (6 chars, only hash stored). Heads hand codes out in person (prevents someone claiming a friend's account first).
3. Member activates with student ID + activation code + new password (min 8 chars).
4. Login: student ID + password → session token (server-side `AuthSessions`, default 7 days for members, 12 h for scanner roles; configurable). Token kept in `localStorage` (try/catch). Multiple devices allowed. Logout button everywhere.
5. Forgot password → head (own team) or admin issues a new activation code.
- Password hashing: per-user salt + server pepper, iterated SHA-256 via `Utilities.computeDigest` (≥ 1,000 rounds). No plaintext stored or logged.
- Login rate limit per student ID: 5 failures → 10-min lock (`CacheService`).

### 5.4 Official barcode
- Payload: `<studentId>-<check>`; `check` = first 4 chars (base32 uppercase) of HMAC(secret, studentId + ":" + CodeVersion).
- **Code 128**, human-readable student ID below.
- Reissue: admin increments `CodeVersion` → old code becomes invalid.
- Card works **offline on the member's phone**: portal offers "บันทึกบัตรเป็นรูป" (PNG) and a print view.

### 5.5 Card design (phone portrait, full screen)
Top → bottom: event/unit name · **nickname (very large)** · first + last name · student ID · **department/team colored band** (color from `Departments`) · **Code 128 barcode** full width, black on pure white with quiet zones. Dark theme allowed except the barcode area. Hint: "เปิดความสว่างหน้าจอให้สูงสุดก่อนสแกน".

### 5.6 Member portal
- **My card** (view, save as image)
- **Today**: "สแกนเข้าแล้ว 13:05 โดย <scanner nickname>" / "ยังไม่ได้สแกนเข้า" / "สแกนออกแล้ว 18:40 (นับ 5.5 ชม.)" / "รอตรวจสอบ (ลืมสแกนออก)"
- **My schedule** (when schedules exist): upcoming shifts
- **My history**: by work date — in, out, raw duration, **counted hours** (after rules), status (COMPLETE / NEEDS_REVIEW / CORRECTED / LOCKED)
- **Total counted hours** (+ points if configured)
- **Report a problem**: short message linked to a date → head/unit admin queue; member sees status of their reports
- Never shows other members, internal notes, flags, or admin controls.

### 5.7 Scan flow (heads, deputies, unit admins)
Target 3–5 s per person.
1. Tap **สแกน** → rear camera (`getUserMedia`, started on user tap). Library that decodes Code 128 on iOS Safari (e.g. ZXing-js / html5-qrcode); restrict to Code 128.
2. On read: vibrate (if supported) + beep, pause camera, call `scan.lookup` → returns member summary, current state, the action that will be taken, warnings, and a short-lived signed `lookupToken`.
3. Result screen: nickname, full name, student ID, department/team, status, schedule info for today (if any), one big button **ยืนยันเข้างาน** / **ยืนยันออกงาน** (checkout shows counted hours preview), and **ยกเลิก**.
4. `scan.confirm(lookupToken, reason?)` → writes record → auto-return to camera.
Rules:
- Invalid check / old CodeVersion → red "บัตรไม่ถูกต้อง".
- **Self-scan → blocked** "ไม่สามารถสแกนบัตรของตัวเองได้".
- Outside scanner's team → allowed only with a typed **reason**; flagged.
- Member not scheduled today (when schedules exist) → yellow warning, allowed, flagged.
- Same member within 60 s → ignored as duplicate.
- Date inside a **closed period** → blocked.
- Camera unavailable → manual student-ID entry → same lookup/confirm, `Method=MANUAL`, flagged.
- In-app browsers (LINE/Instagram/Facebook) → "กรุณาเปิดใน Safari หรือ Chrome" + copy link.
- Optional keyboard-wedge input for USB/Bluetooth barcode scanners.
- Every record stores **ScannedBy**.

### 5.8 Hour-counting rules (all configurable in `Config`)
Defaults below are placeholders — **organizers must confirm** (list in `OPEN-QUESTIONS.md`):
| Key | Default | Meaning |
|---|---|---|
| `WORKDAY_START_HOUR` | 5 | A session belongs to the work date starting at 05:00 (supports events running past midnight) |
| `ROUNDING_MINUTES` | 30 | Counted time is **rounded down** to this step |
| `MIN_SESSION_MINUTES` | 30 | Shorter sessions count 0 (still recorded) |
| `MAX_HOURS_PER_DAY` | 12 | Cap on counted hours per member per work date |
| `POINTS_PER_HOUR` | empty | If set, portal shows points = counted hours × value |
Raw duration is always stored; counted hours are derived and recomputable.

### 5.9 Auto-close of forgotten checkouts
- Time-driven trigger at `AUTO_CLOSE_HOUR` (default = `WORKDAY_START_HOUR`, 05:00): any session still OPEN for the previous work date → status **NEEDS_REVIEW**, counted hours 0, member state reset to OUT, alert created, member sees "รอตรวจสอบ".
- Fix only via the correction flow (5.10).

### 5.10 Correction flow (two-person rule)
1. Head (or unit admin) **proposes**: target session or new session, proposed in/out, reason. Can be created from a member's report.
2. Unit admin **approves or rejects** with a note. Rules from 5.2 apply (no self, approver ≠ proposer).
3. Approved → session status CORRECTED; original values kept; `Log` gets `CORRECTION` entry with proposer and approver.
4. Member sees result in history and report status.

### 5.11 Period closing
- Unit admin closes a period (date range) after points are submitted → no scans, corrections or rebuilds can change sessions inside it. Status LOCKED shown in portal.
- Only super admin can reopen, with a mandatory reason (logged).
- Closing produces a **final export** (CSV per member: student ID, name, department, team, counted hours, points) stored in Drive.

### 5.12 Shift schedules
- `Schedules`: assign members or whole teams to work dates + shift + expected start/end. Import via CSV; editable by unit admin.
- Team view classifies each scheduled member per day: **มาแล้ว / มาสาย** (after `LATE_MINUTES`, default 15) **/ ยังไม่มา / ขาด** (after shift end) and separately lists **มาโดยไม่มีเวร**.
- Without schedules, the system still works; team view then shows only present / not scanned.

### 5.13 Head team view
- Live list: present now, scheduled-but-not-here, late, open beyond `MAX_OPEN_HOURS`.
- Member reports queue (resolve or turn into correction proposal).
- Issue activation code for own team members.

### 5.14 Dashboard (unit_admin, super_admin)
- Counted hours by department/team, attendance per day, late/absent rate (if schedules), number of flagged scans, open reports, pending corrections.
- Super admin: cross-unit totals.
- Fed by a `DashboardCache` sheet refreshed by an hourly trigger (no heavy computation on page load). Good-looking enough to be used when presenting the system to other units.

### 5.15 Error log and test mode
- Every API error is written to `Errors`: Timestamp | Env | RequestId | Action | StudentID (if known) | Code | Message | Stack (trimmed). The frontend shows "รหัสอ้างอิง: <requestId>" in error messages so users can report it.
- `TEST` env has a **seed action** (menu in test spreadsheet) creating a demo unit, departments, teams, ~50 fake members, schedules and a few days of sample sessions — used for development, testing and demos to other units. Seed is disabled in `PROD`.

### 5.16 Scale (~190 users, more units later)
- Peak: many check-ins within ~15 minutes at shift start. Two light calls per scan, roster index cached (StudentID → row), append-only writes.
- Archive `Log`/`WorkSessions` by period without breaking the portal.
- Document Apps Script limits (≈30 simultaneous executions, 6-min run cap, daily quotas) and the point where moving off Sheets would be justified.

---

## 6. Data model (System B spreadsheet)
- `Config`: key | value | description
- `Units`: UnitID | Name | Active
- `Departments`: DeptID | UnitID | Name | Color
- `Teams`: TeamID | UnitID | DeptID | Name
- `Members`: StudentID | UnitID | DeptID | TeamID | FirstName | LastName | Nickname | Shift | Role | PasswordHash | Salt | ActivationCodeHash | ActivatedAt | CodeVersion | Status (ACTIVE/DISABLED) | CurrentState (IN/OUT) | OpenSessionID
- `ScannerAssignments`: StudentID | UnitID | TeamID | Date (optional) | Shift (optional) | GrantedBy | GrantedAt
- `AuthSessions`: Token | StudentID | CreatedAt | ExpiresAt | UserAgent
- `Log` (append-only, source of truth): Timestamp | RequestId | UnitID | StudentID | Action (IN / OUT / AUTO_CLOSE / CORRECTION / REJECT / BLOCKED_SELF / ACTIVATE / RESET / LOGIN_FAIL / PERIOD_CLOSE / PERIOD_REOPEN) | ActorID | Method (BARCODE / MANUAL / ADMIN / SYSTEM) | Flags | Reason | Note
- `WorkSessions`: SessionID | UnitID | StudentID | WorkDate | In | Out | RawMinutes | CountedHours | ScannedInBy | ScannedOutBy | Status (OPEN / COMPLETE / NEEDS_REVIEW / CORRECTED) | Locked (bool) | Note
- `Corrections`: CorrectionID | UnitID | TargetStudentID | SessionID (optional) | ProposedIn | ProposedOut | Reason | ProposedBy | ProposedAt | Status (PENDING / APPROVED / REJECTED) | ReviewedBy | ReviewedAt | ReviewNote
- `Reports`: ReportID | UnitID | StudentID | WorkDate | Message | Status (OPEN / RESOLVED / CONVERTED) | ResolvedBy | ResolvedNote
- `Schedules`: ScheduleID | UnitID | StudentID or TeamID | WorkDate | Shift | ExpectedStart | ExpectedEnd
- `Periods`: PeriodID | UnitID | StartDate | EndDate | Status (OPEN / CLOSED) | ClosedBy | ClosedAt | ExportLink | ReopenReason
- `Alerts`: AlertID | UnitID | Type | StudentID | Detail | CreatedAt | Status
- `DashboardCache`: UnitID | Metric | Key | Value | UpdatedAt
- `Errors`: see 5.15
Protected ranges on headers/formulas; header validation at startup; admin action **"rebuild WorkSessions from Log"** (respects locked periods).

## 7. API actions (System B)
| Group | Actions |
|---|---|
| auth | `auth.activate`, `auth.login`, `auth.logout`, `auth.me` |
| member | `me.card`, `me.today`, `me.history`, `me.schedule`, `me.reports`, `me.report.create` |
| scan | `scan.lookup` (code or manual studentId), `scan.confirm` |
| head | `team.status`, `team.reports`, `team.report.resolve`, `team.activationCode.issue`, `correction.propose` |
| admin | `correction.list`, `correction.approve`, `correction.reject`, `roster.import`, `roster.update`, `role.set`, `scanner.assign`, `code.reissue`, `schedule.import`, `schedule.update`, `period.close`, `period.reopen` (super), `export.summary`, `dashboard.get`, `rebuild.fromLog` |
| system | `health` (returns env, apiVersion, server time) |
Each action declares required role and scope in one permissions table in `core/`, unit-tested.

---

## 8. System A — Ticket Booking (haunted house)
- Public page (no login): full name, phone (Thai format), email, party size, date + time slot (only slots with enough seats; show remaining), payment slip (jpg/png ≤ 5 MB → Drive); shows total price and PromptPay/bank info.
- Server re-checks capacity under `LockService`, generates booking code `HH-0001`, emails confirmation (`MailApp` ~100/day on consumer Gmail; also show code on screen and ask to screenshot).
- `Config`: event dates, daily start/end, slot interval (placeholder until floor plan/walk time decided), capacity per slot, price, max party size, booking open switch, payment info.
- `Bookings`: Timestamp | Booking Code | Name | Phone | Email | Party Size | Date | Slot | Total | Slip Link | Payment Verified | Checked In | Check-in Time | Source (Online/Walk-in) | Notes
- Door staff (1–2) on a phone: `Door` view by slot → search code → check name → open slip → tick Checked In (auto server time). Reused codes highlighted. `Slot Summary` with remaining seats; walk-ins (Source = Walk-in) count against capacity.
- Visitor rules: arrive 10 min early; booking released if more than 10 min late.
- Uses the same TEST/PROD, Errors log and server-time rules as System B.
- Round scheduling inside the haunted house is out of scope; interval/capacity stay configurable.

## 9. Software risks and mitigations
| # | Risk | Mitigation |
|---|---|---|
| 1 | iOS camera issues / in-app browsers | HTTPS, start on tap, in-app browser detection, manual entry fallback, test ≥ 3 iPhone models |
| 2 | Code 128 hard to read off phone screens | Full-width barcode, white quiet zones, short payload, brightness hint, Code 128-only decoding |
| 3 | Latency/concurrency at shift start | 2 calls per scan, cached roster index, append-only writes, loading states |
| 4 | CORS GitHub Pages ↔ Apps Script | `text/plain` POST, no custom headers |
| 5 | Account takeover before activation | One-time activation codes in person |
| 6 | Reading other members' data (IDOR) | Identity from token only; no studentId params on member endpoints; tests |
| 7 | Cross-unit data exposure | Unit scope on every admin query; sheet access only for super admins |
| 8 | Weak passwords / brute force | Salt + pepper + iterated hash; rate limit |
| 9 | Forged/leaked barcode | HMAC check; reissue via CodeVersion; physical verification by scanner |
| 10 | Self check-in by heads | Self-scan blocked in core logic |
| 11 | Head absent → nobody can scan | Deputies / ScannerAssignments; unit admins can scan |
| 12 | Friends inflating hours via corrections | Two-person approval; no self-corrections; full audit in Log |
| 13 | Forgotten checkout inflating hours | Auto-close to NEEDS_REVIEW with 0 counted hours |
| 14 | Disputes over counting | Explicit configurable rules; raw minutes kept; recomputable |
| 15 | Changes after points submitted | Period closing; reopen only by super admin with reason |
| 16 | Device clock manipulation | Server time only |
| 17 | Hard-to-debug failures | `Errors` sheet + requestId shown to users |
| 18 | Testing pollutes real data | Separate TEST env + seed data |
| 19 | Manual sheet edits break data | Protected ranges, header validation, rebuild from Log |
| 20 | Redeploys break frontend | Update existing deployment version (same URL); single config; apiVersion check |
| 21 | Single owner / data loss | Second super admin; scheduled backup copies; Log as source of truth |

## 10. Milestones and acceptance criteria
**M0 – Foundation**: repo layout, clasp projects, TEST/PROD env, API router, error log with requestId, permissions table, spreadsheet initializer, GitHub Pages deploy.
✓ `health` works in both envs; test banner shows in TEST; unit tests run in Node.

**M1 – Accounts & card**: roster import, activation codes, login/logout, rate limit, member card + save as PNG.
✓ Member cannot activate without the right code; 6th failed login is locked; card PNG scans correctly with the scan page.

**M2 – Scanning & hours**: scan.lookup/confirm, all rules in 5.7, ScannerAssignments, hour rules 5.8, WorkSessions.
✓ Self-scan blocked; cross-team requires reason; duplicate within 60 s ignored; counted hours match rule tests (rounding, minimum, daily cap, past-midnight work date).

**M3 – Portal & team view**: today, history, reports, team view, auto-close trigger, alerts.
✓ Member sees only own data (tested by tampering requests); forgotten checkout becomes NEEDS_REVIEW with 0 hours.

**M4 – Corrections, periods, export** → **Phase 1 complete for haunted house**.
✓ No self-proposal/approval; approver ≠ proposer; closed period blocks scans/corrections; final CSV export generated.

**M5 – System A booking**.
✓ Concurrent bookings never exceed capacity; walk-ins counted; door flow works on a phone.

**M6 – Phase 2 (multi-unit rollout)**: web admin pages, schedules + late/absent, dashboard, add-unit flow, `ADOPTION-GUIDE-TH.md`, TEST seed for demos.
✓ A second demo unit can be added and run without seeing the first unit's data; dashboard loads from cache.

## 11. Deliverables
1. Frontend (GitHub Pages): staff — activate, login, portal, scan, team view, admin, dashboard; booking — form and confirmation.
2. Apps Script backends for B and A (`appsscript.json`: timezone `Asia/Bangkok`, V8) with core logic separated and unit-tested.
3. Spreadsheet initializers and TEST seed.
4. Docs: `README-TH.md` (setup, deploy, env switch, roster import, activation codes, how members/heads/door staff use it, safe redeploy, backups), `ADOPTION-GUIDE-TH.md` (for other units), `CHANGELOG.md`, `OPEN-QUESTIONS.md`.
5. Test plan + automated tests for core rules and API permissions; manual checklist for iPhone camera scanning.
