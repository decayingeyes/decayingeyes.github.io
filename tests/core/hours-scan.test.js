const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('../../backend-staff/core/hours');
const S = require('../../backend-staff/core/scan');
const { build } = require('../../backend-staff/core/config-defaults');

const cfg = build([]);
const hmacBytes = (key, msg) => [...crypto.createHmac('sha256', key).update(msg, 'utf8').digest()];
// Bangkok local time -> Date
const bkk = (s) => new Date(s + '+07:00');

test('work date: before WORKDAY_START_HOUR belongs to the previous day', () => {
  assert.equal(H.workDate(bkk('2026-10-31T13:00:00'), 5), '2026-10-31');
  assert.equal(H.workDate(bkk('2026-11-01T02:30:00'), 5), '2026-10-31'); // past midnight
  assert.equal(H.workDate(bkk('2026-11-01T05:00:00'), 5), '2026-11-01');
  assert.equal(H.workDate(bkk('2026-11-01T04:59:00'), 5), '2026-10-31');
  assert.equal(H.workDate(bkk('2026-01-01T03:00:00'), 5), '2025-12-31'); // year boundary
});

test('bangkok time formatting', () => {
  assert.equal(H.bangkokTime(bkk('2026-10-31T09:05:00')), '09:05');
  assert.equal(H.bangkokDate(new Date('2026-10-31T20:00:00Z')), '2026-11-01');
});

test('counted hours: minimum, rounding down, cap', () => {
  assert.equal(H.sessionHours(29, cfg), 0);
  assert.equal(H.sessionHours(30, cfg), 0.5);
  assert.equal(H.sessionHours(59, cfg), 0.5);
  assert.equal(H.sessionHours(335, cfg), 5.5); // 5h35 -> 5.5
  assert.equal(H.sessionHours(800, cfg), 13); // before daily cap
  assert.equal(H.capForDay(13, 0, cfg), 12);
  assert.equal(H.capForDay(5, 10, cfg), 2);
  assert.equal(H.capForDay(5, 12, cfg), 0);
});

test('counted hours across midnight', () => {
  const r = H.countedHours(bkk('2026-10-31T20:00:00'), bkk('2026-11-01T01:40:00'), 0, cfg);
  assert.deepEqual(r, { rawMinutes: 340, countedHours: 5.5 });
});

test('counted hours with custom config', () => {
  const c = build([['ROUNDING_MINUTES', 15], ['MIN_SESSION_MINUTES', 0], ['MAX_HOURS_PER_DAY', 8]]);
  assert.equal(H.sessionHours(50, c), 0.75);
  assert.equal(H.countedHours(bkk('2026-10-31T08:00:00'), bkk('2026-10-31T18:00:00'), 0, c).countedHours, 8);
});

const head = { studentId: 'H1', role: 'head', unitId: 'U01', teamId: 'T01' };
const deputy = { studentId: 'D1', role: 'deputy', unitId: 'U01', teamId: 'T01' };
const admin = { studentId: 'A1', role: 'unit_admin', unitId: 'U01', teamId: 'T09' };
const member = (o) => ({ StudentID: 'M1', UnitID: 'U01', TeamID: 'T01', Shift: 'กะ 1', Status: 'ACTIVE', CurrentState: 'OUT', ...o });
const base = (o) => ({
  actor: head, member: member(), now: bkk('2026-10-31T13:00:00'), cfg,
  assignments: [], periods: [], schedules: [], lastScanAt: null, method: 'BARCODE', ...o,
});

test('decide: normal check-in and check-out with preview', () => {
  const inn = S.decide(base());
  assert.equal(inn.blocked, null);
  assert.equal(inn.action, 'IN');
  assert.equal(inn.requiresReason, false);
  assert.equal(inn.workDate, '2026-10-31');

  const out = S.decide(base({
    member: member({ CurrentState: 'IN' }), now: bkk('2026-10-31T18:40:00'),
    openSessionIn: bkk('2026-10-31T13:05:00'), countedToday: 0,
  }));
  assert.equal(out.action, 'OUT');
  assert.equal(out.previewHours, 5.5);
});

test('decide: self-scan blocked for every role', () => {
  for (const actor of [head, deputy, admin, { ...admin, role: 'super_admin' }]) {
    assert.equal(S.decide(base({ actor, member: member({ StudentID: actor.studentId }) })).blocked, 'SELF_SCAN');
  }
});

test('decide: duplicate within 60 s ignored, after 60 s allowed', () => {
  const now = bkk('2026-10-31T13:00:00');
  assert.equal(S.decide(base({ now, lastScanAt: new Date(now - 59000) })).blocked, 'DUPLICATE_SCAN');
  assert.equal(S.decide(base({ now, lastScanAt: new Date(now - 61000) })).blocked, null);
});

test('decide: other team needs reason; other unit blocked', () => {
  const r = S.decide(base({ member: member({ TeamID: 'T02' }) }));
  assert.equal(r.blocked, null);
  assert.equal(r.requiresReason, true);
  assert.ok(r.flags.includes('OUT_OF_TEAM'));
  assert.equal(S.decide(base({ member: member({ UnitID: 'U02' }) })).blocked, 'OTHER_UNIT');
  assert.equal(S.decide(base({ actor: admin, member: member({ TeamID: 'T05' }) })).requiresReason, false);
});

test('decide: deputy needs an assignment (date/shift aware)', () => {
  assert.equal(S.decide(base({ actor: deputy })).requiresReason, true);
  const a = { StudentID: 'D1', UnitID: 'U01', TeamID: 'T01', Date: '', Shift: '' };
  assert.equal(S.decide(base({ actor: deputy, assignments: [a] })).requiresReason, false);
  assert.equal(S.decide(base({ actor: deputy, assignments: [{ ...a, Date: '2026-11-01' }] })).requiresReason, true);
  assert.equal(S.decide(base({ actor: deputy, assignments: [{ ...a, Date: '2026-10-31' }] })).requiresReason, false);
  assert.equal(S.decide(base({ actor: deputy, assignments: [{ ...a, Shift: 'กะ 2' }] })).requiresReason, true);
});

test('decide: closed period blocks', () => {
  const periods = [{ UnitID: 'U01', StartDate: '2026-10-30', EndDate: '2026-10-31', Status: 'CLOSED' }];
  assert.equal(S.decide(base({ periods })).blocked, 'PERIOD_CLOSED');
  assert.equal(S.decide(base({ periods: [{ ...periods[0], Status: 'OPEN' }] })).blocked, null);
});

test('decide: schedules -> not-scheduled warning only when schedules exist', () => {
  assert.equal(S.decide(base()).flags.includes('NOT_SCHEDULED'), false);
  const other = [{ StudentID: 'X9', TeamID: '', WorkDate: '2026-10-31' }];
  const r = S.decide(base({ schedules: other }));
  assert.equal(r.blocked, null);
  assert.ok(r.flags.includes('NOT_SCHEDULED'));
  assert.equal(S.decide(base({ schedules: [{ StudentID: '', TeamID: 'T01', WorkDate: '2026-10-31' }] })).flags.includes('NOT_SCHEDULED'), false);
});

test('decide: disabled member and manual flag', () => {
  assert.equal(S.decide(base({ member: member({ Status: 'DISABLED' }) })).blocked, 'MEMBER_DISABLED');
  assert.ok(S.decide(base({ method: 'MANUAL' })).flags.includes('MANUAL'));
});

test('lookup token: roundtrip, tamper, expiry, wrong secret', () => {
  const now = new Date('2026-10-31T06:00:00Z');
  const t = S.signLookup({ target: 'M1', scanner: 'H1', action: 'IN', flags: ['ชื่อไทย'] }, now, 'k', hmacBytes);
  assert.deepEqual(S.verifyLookup(t, now, 'k', hmacBytes).flags, ['ชื่อไทย']);
  assert.equal(S.verifyLookup(t, new Date(now.getTime() + S.TOKEN_TTL_MS + 1), 'k', hmacBytes), null);
  assert.equal(S.verifyLookup(t, now, 'other', hmacBytes), null);
  const [p, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ target: 'M1', scanner: 'H1', action: 'OUT', exp: now.getTime() + 1e6 })).toString('base64url');
  assert.equal(S.verifyLookup(forged + '.' + sig, now, 'k', hmacBytes), null);
  assert.equal(S.verifyLookup(p, now, 'k', hmacBytes), null);
  assert.equal(S.verifyLookup(null, now, 'k', hmacBytes), null);
});
