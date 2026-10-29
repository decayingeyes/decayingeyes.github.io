const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../backend-staff/core/team');
const H = require('../../backend-staff/core/hours');

const m = (id, team, state, o) => ({
  StudentID: id, TeamID: team, Nickname: 'n' + id, FirstName: 'f', LastName: 'l',
  Role: 'member', Status: 'ACTIVE', CurrentState: state, ...o,
});
const members = [m('1', 'T01', 'IN'), m('2', 'T01', 'OUT'), m('3', 'T01', 'OUT'), m('4', 'T02', 'IN'), m('5', 'T01', 'OUT', { Status: 'DISABLED' })];
const sessions = [
  { StudentID: '1', WorkDate: '2026-10-31', In: new Date('2026-10-31T06:00:00Z'), Status: 'OPEN', ScannedInBy: 'H1' },
  { StudentID: '2', WorkDate: '2026-10-31', In: new Date('2026-10-31T06:00:00Z'), Out: new Date('2026-10-31T08:40:00Z'), RawMinutes: 160, CountedHours: 2.5, Status: 'COMPLETE' },
  { StudentID: '2', WorkDate: '2026-10-30', In: new Date('2026-10-30T06:00:00Z'), Out: new Date('2026-10-30T07:00:00Z'), CountedHours: 1, Status: 'COMPLETE' },
];

test('visible teams by role', () => {
  const all = ['T01', 'T02', 'T03'];
  assert.equal(T.visibleTeams({ role: 'unit_admin' }, [], '2026-10-31', all), null);
  assert.deepEqual(T.visibleTeams({ studentId: 'H1', role: 'head', unitId: 'U01', teamId: 'T01' }, [], '2026-10-31', all), ['T01']);
  const a = [{ StudentID: 'D1', UnitID: 'U01', TeamID: 'T03', Date: '', Shift: '' }];
  assert.deepEqual(T.visibleTeams({ studentId: 'D1', role: 'deputy', unitId: 'U01', teamId: 'T01' }, a, '2026-10-31', all), ['T01', 'T03']);
});

test('build: states, today-only sessions, hours, disabled hidden, sorted', () => {
  const r = T.build(members, sessions, ['T01'], '2026-10-31', H.bangkokTime);
  assert.deepEqual(r.members.map((x) => [x.studentId, x.state]), [['1', 'IN'], ['2', 'LEFT'], ['3', 'NOT_HERE']]);
  assert.deepEqual(r.counts, { in: 1, left: 1, notHere: 1 });
  const two = r.members[1];
  assert.equal(two.sessions.length, 1); // yesterday excluded
  assert.deepEqual(two.sessions[0], { in: '13:00', out: '15:40', countedHours: 2.5, rawMinutes: 160, scannedInBy: '', scannedOutBy: '', status: 'COMPLETE' });
  assert.equal(two.hoursToday, 2.5);
  assert.equal(r.members[0].sessions[0].out, '');
  assert.equal(r.members[0].sessions[0].countedHours, null);
});

test('build: unit admin sees all teams', () => {
  assert.equal(T.build(members, sessions, null, '2026-10-31', H.bangkokTime).members.length, 4);
});
