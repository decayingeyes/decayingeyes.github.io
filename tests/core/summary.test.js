const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../backend-staff/core/summary');
const H = require('../../backend-staff/core/hours');

const m = (id, nick, team, state) => ({
  StudentID: id, Nickname: nick, FirstName: 'ชื่อ' + id, LastName: 'สกุล', TeamID: team, DeptID: 'D01',
  Role: 'member', Status: 'ACTIVE', CurrentState: state,
});
const members = [m('1', 'ก', 'T01', 'IN'), m('2', 'ข', 'T01', 'OUT'), m('3', 'ค', 'T02', 'OUT')];
const bkk = (s) => new Date(s + '+07:00');
const sessions = [
  { StudentID: '1', WorkDate: '2026-10-31', In: bkk('2026-10-31T13:05:00'), Status: 'OPEN', ScannedInBy: 'H1' },
  { StudentID: '2', WorkDate: '2026-10-31', In: bkk('2026-10-31T13:00:00'), Out: bkk('2026-10-31T18:40:00'), CountedHours: 5.5, Status: 'COMPLETE', ScannedInBy: 'H1', ScannedOutBy: 'H2' },
  { StudentID: '2', WorkDate: '2026-10-30', In: bkk('2026-10-30T17:00:00'), Out: bkk('2026-10-30T19:00:00'), CountedHours: 2, Status: 'COMPLETE' },
];
const org = { teams: { T01: 'ผีกะ 1', T02: 'ผีกะ 2' }, depts: { D01: 'นักแสดง' }, nick: { H1: 'ตู่', H2: 'แพรว' } };

test('today: state order, Thai labels, times, scanners', () => {
  const t = S.today(members, sessions, org, '2026-10-31', H.bangkokTime);
  assert.deepEqual(t.states, ['IN', 'LEFT', 'NOT_HERE']);
  assert.deepEqual(t.rows[0], ['🟢 อยู่ในงาน', 'ก', 'ชื่อ1 สกุล', '1', 'นักแสดง', 'ผีกะ 1', '13:05', '(ยังอยู่)', 0, 'ตู่']);
  assert.deepEqual(t.rows[1].slice(6), ['13:00', '18:40', 5.5, 'ตู่, แพรว']);
  assert.deepEqual(t.rows[2].slice(0, 2), ['⚪ ยังไม่มา', 'ค']);
  assert.equal(t.rows[2][8], '');
  assert.equal(t.rows[0].length, S.TODAY_HEADER.length);
});

test('matrix: one column per date, totals, open session', () => {
  const dates = S.dates(sessions, '2026-11-01');
  assert.deepEqual(dates, ['2026-10-30', '2026-10-31', '2026-11-01']);
  const mx = S.matrix(members, sessions, org, dates, H.bangkokTime);
  assert.deepEqual(mx.header.slice(4), ['2026-10-30', '2026-10-31', '2026-11-01', 'รวมชั่วโมง', 'จำนวนวันที่มา']);
  const row2 = mx.rows.find((r) => r[2] === '2');
  assert.deepEqual(row2.slice(4), ['17:00–19:00 · 2 ชม.', '13:00–18:40 · 5.5 ชม.', '', 7.5, 2]);
  const row1 = mx.rows.find((r) => r[2] === '1');
  assert.deepEqual(row1.slice(4), ['', '13:05– (ยังอยู่)', '', 0, 1]);
});

test('auto-closed sessions read as forgotten checkout, not still inside', () => {
  const closed = [{ StudentID: '3', WorkDate: '2026-10-31', In: bkk('2026-10-31T13:00:00'), Status: 'NEEDS_REVIEW', CountedHours: 0 }];
  const t = S.today(members, closed, org, '2026-10-31', H.bangkokTime);
  const row = t.rows.find((r) => r[3] === '3');
  assert.equal(row[7], 'ลืมสแกนออก');
  const mx = S.matrix(members, closed, org, ['2026-10-31'], H.bangkokTime);
  assert.equal(mx.rows.find((r) => r[2] === '3')[4], '13:00– ลืมสแกนออก (0 ชม.)');
});
