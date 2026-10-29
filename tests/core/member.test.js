const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../backend-staff/core/member');
const H = require('../../backend-staff/core/hours');

const bkk = (s) => new Date(s + '+07:00');
const nick = { H1: 'ตู่' };
const s = (o) => ({ StudentID: 'M1', ScannedInBy: 'H1', ScannedOutBy: 'H1', ...o });

test('today: not in / in / out / needs review', () => {
  assert.equal(M.today([], '2026-10-31', nick, H.bangkokTime).kind, 'NOT_IN');
  const open = [s({ WorkDate: '2026-10-31', In: bkk('2026-10-31T13:05:00'), Status: 'OPEN' })];
  assert.deepEqual(
    (({ kind, text }) => ({ kind, text }))(M.today(open, '2026-10-31', nick, H.bangkokTime)),
    { kind: 'IN', text: 'สแกนเข้าแล้ว 13:05 โดย ตู่' });
  const done = [s({ WorkDate: '2026-10-31', In: bkk('2026-10-31T13:05:00'), Out: bkk('2026-10-31T18:40:00'), CountedHours: 5.5, Status: 'COMPLETE' })];
  assert.equal(M.today(done, '2026-10-31', nick, H.bangkokTime).text, 'สแกนออกแล้ว 18:40 (วันนี้นับ 5.5 ชม.)');
  const review = [s({ WorkDate: '2026-10-31', In: bkk('2026-10-31T13:05:00'), Status: 'NEEDS_REVIEW', CountedHours: 0 })];
  assert.equal(M.today(review, '2026-10-31', nick, H.bangkokTime).kind, 'NEEDS_REVIEW');
  // other days ignored
  assert.equal(M.today(done, '2026-11-01', nick, H.bangkokTime).kind, 'NOT_IN');
});

test('history: grouped newest first, totals, points, locked periods', () => {
  const mine = [
    s({ WorkDate: '2026-10-30', In: bkk('2026-10-30T17:00:00'), Out: bkk('2026-10-30T19:00:00'), RawMinutes: 120, CountedHours: 2, Status: 'COMPLETE' }),
    s({ WorkDate: '2026-10-31', In: bkk('2026-10-31T13:00:00'), Out: bkk('2026-10-31T18:40:00'), RawMinutes: 340, CountedHours: 5.5, Status: 'COMPLETE' }),
    s({ WorkDate: '2026-10-31', In: bkk('2026-10-31T19:00:00'), Status: 'OPEN' }),
  ];
  const periods = [{ UnitID: 'U01', StartDate: '2026-10-30', EndDate: '2026-10-30', Status: 'CLOSED' }];
  const h = M.history(mine, periods, 'U01', 10, H.bangkokTime);
  assert.deepEqual(h.days.map((d) => d.workDate), ['2026-10-31', '2026-10-30']);
  assert.equal(h.days[0].countedHours, 5.5);
  assert.equal(h.days[0].sessions[1].countedHours, null); // open session not counted yet
  assert.equal(h.days[1].sessions[0].status, 'LOCKED');
  assert.equal(h.totalHours, 7.5);
  assert.equal(h.points, 75);
  assert.equal(M.history(mine, [], 'U01', null, H.bangkokTime).points, null);
});

test('auto-close time: next day at AUTO_CLOSE_HOUR Bangkok', () => {
  assert.equal(H.autoCloseAt('2026-10-31', 5).toISOString(), bkk('2026-11-01T05:00:00').toISOString());
  assert.equal(H.autoCloseAt('2026-12-31', 5).toISOString(), bkk('2027-01-01T05:00:00').toISOString());
});

test('stale open sessions are only past their auto-close time', () => {
  const sessions = [
    { WorkDate: '2026-10-31', Status: 'OPEN' },
    { WorkDate: '2026-11-01', Status: 'OPEN' },
    { WorkDate: '2026-10-31', Status: 'COMPLETE' },
  ];
  assert.equal(M.staleOpenSessions(sessions, bkk('2026-11-01T04:59:00'), 5).length, 0);
  assert.deepEqual(M.staleOpenSessions(sessions, bkk('2026-11-01T05:00:00'), 5), [sessions[0]]);
});

test('report validation', () => {
  assert.ok(M.reportProblem('', '2026-10-31'));
  assert.ok(M.reportProblem('ลืมสแกนออก', 'yesterday'));
  assert.ok(M.reportProblem('x'.repeat(501), '2026-10-31'));
  assert.equal(M.reportProblem('ลืมสแกนออกค่ะ', '2026-10-31'), null);
});
