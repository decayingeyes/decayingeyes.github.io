const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../backend-staff/core/corrections');

const bkk = (s) => new Date(s + '+07:00');
const head = { studentId: 'H1', role: 'head', unitId: 'U01', teamId: 'T01' };
const admin = { studentId: 'A1', role: 'unit_admin', unitId: 'U01', teamId: 'T09' };
const admin2 = { studentId: 'A2', role: 'unit_admin', unitId: 'U01', teamId: 'T09' };
const member = (o) => ({ StudentID: 'M1', UnitID: 'U01', TeamID: 'T01', ...o });

test('timeOn: same day, past midnight, invalid', () => {
  assert.equal(C.timeOn('2026-10-31', '13:05', 5).toISOString(), bkk('2026-10-31T13:05:00').toISOString());
  assert.equal(C.timeOn('2026-10-31', '01:30', 5).toISOString(), bkk('2026-11-01T01:30:00').toISOString());
  assert.equal(C.timeOn('2026-10-31', '25:00', 5), null);
  assert.equal(C.timeOn('2026-10-31', 'abc', 5), null);
  assert.equal(C.timeOn('31/10/2026', '13:00', 5), null);
});

test('times validation', () => {
  assert.ok(C.timesProblem(null, bkk('2026-10-31T13:00:00')));
  assert.ok(C.timesProblem(bkk('2026-10-31T13:00:00'), bkk('2026-10-31T12:00:00')));
  assert.ok(C.timesProblem(bkk('2026-10-31T13:00:00'), bkk('2026-11-01T14:00:00')));
  assert.equal(C.timesProblem(bkk('2026-10-31T13:00:00'), bkk('2026-10-31T18:00:00')), null);
});

test('propose: own record, other team, other unit, closed period, member role', () => {
  const closed = [{ UnitID: 'U01', StartDate: '2026-10-31', EndDate: '2026-10-31', Status: 'CLOSED' }];
  assert.equal(C.proposeProblem(head, member(), '2026-10-31', [], []), null);
  assert.ok(C.proposeProblem(head, member({ StudentID: 'H1' }), '2026-10-31', [], []));
  assert.ok(C.proposeProblem(head, member({ TeamID: 'T02' }), '2026-10-31', [], []));
  assert.equal(C.proposeProblem(admin, member({ TeamID: 'T02' }), '2026-10-31', [], []), null);
  assert.ok(C.proposeProblem(admin, member({ UnitID: 'U02' }), '2026-10-31', [], []));
  assert.ok(C.proposeProblem(head, member(), '2026-10-31', [], closed));
  assert.ok(C.proposeProblem({ ...head, role: 'deputy' }, member(), '2026-10-31', [], []));
});

test('review: two-person rule', () => {
  const c = { UnitID: 'U01', Status: 'PENDING', ProposedBy: 'H1', TargetStudentID: 'M1', WorkDate: '2026-10-31' };
  assert.equal(C.reviewProblem(admin, c, []), null);
  assert.ok(C.reviewProblem(head, c, [])); // not an admin
  assert.ok(C.reviewProblem(admin, { ...c, ProposedBy: 'A1' }, [])); // approver = proposer
  assert.ok(C.reviewProblem(admin, { ...c, TargetStudentID: 'A1' }, [])); // own hours
  assert.ok(C.reviewProblem(admin2, { ...c, UnitID: 'U02' }, []));
  assert.ok(C.reviewProblem(admin, { ...c, Status: 'APPROVED' }, []));
  assert.ok(C.reviewProblem(admin, c, [{ UnitID: 'U01', StartDate: '2026-10-01', EndDate: '2026-10-31', Status: 'CLOSED' }]));
  // self-report: proposer = target (the head), approver is an admin -> allowed
  assert.equal(C.reviewProblem(admin, { ...c, ProposedBy: 'H1', TargetStudentID: 'H1' }, []), null);
});

test('pickSession', () => {
  const day = [
    { SessionID: 'a', In: bkk('2026-10-31T10:00:00'), Status: 'COMPLETE' },
    { SessionID: 'b', In: bkk('2026-10-31T14:00:00'), Status: 'NEEDS_REVIEW' },
    { SessionID: 'c', In: bkk('2026-10-31T18:00:00'), Status: 'COMPLETE' },
  ];
  assert.equal(C.pickSession(day, 'a').SessionID, 'a');
  assert.equal(C.pickSession(day, '').SessionID, 'b');
  assert.equal(C.pickSession([day[0], day[2]], '').SessionID, 'c');
  assert.equal(C.pickSession([], ''), null);
  assert.equal(C.pickSession(day, 'zzz'), null);
});

test('export: only COMPLETE/CORRECTED in range, points, CSV escaping', () => {
  const members = [
    { StudentID: '1', FirstName: 'ก', LastName: 'ข', Nickname: '=evil', DeptID: 'D1', TeamID: 'T1', Status: 'ACTIVE' },
    { StudentID: '2', FirstName: 'a, b', LastName: 'c"d', Nickname: 'n', DeptID: 'D1', TeamID: 'T1', Status: 'ACTIVE' },
  ];
  const sessions = [
    { StudentID: '1', WorkDate: '2026-10-30', CountedHours: 2, Status: 'COMPLETE' },
    { StudentID: '1', WorkDate: '2026-10-31', CountedHours: 3, Status: 'CORRECTED' },
    { StudentID: '1', WorkDate: '2026-10-31', CountedHours: 5, Status: 'NEEDS_REVIEW' },
    { StudentID: '1', WorkDate: '2026-11-05', CountedHours: 9, Status: 'COMPLETE' },
  ];
  const org = { depts: { D1: 'นักแสดง' }, teams: { T1: 'ผีกะ 1' } };
  const rows = C.exportRows(members, sessions, org, '2026-10-30', '2026-10-31', 10);
  assert.deepEqual(rows[0].slice(-2), ['ชั่วโมงที่นับ', 'แต้ม']);
  assert.deepEqual(rows[1].slice(-2), [5, 50]);
  assert.deepEqual(rows[2].slice(-2), [0, 0]);
  const csv = C.toCsv(rows);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes("'=evil"));
  assert.ok(csv.includes('"a, b","c""d"'));
});

test('period validation', () => {
  assert.ok(C.periodProblem('', '2026-10-31'));
  assert.ok(C.periodProblem('2026-11-01', '2026-10-31'));
  assert.equal(C.periodProblem('2026-10-30', '2026-10-31'), null);
});
