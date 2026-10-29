const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../backend-staff/core/roster');

const CSV = [
  'StudentID,FirstName,LastName,Nickname,Unit,Department,Team,Shift,Role',
  '6510001,สมชาย,ใจดี,ชาย,บ้านผีสิง,นักแสดง,ผีกะ1,กะ 1,head',
  '6510002,"สมหญิง, จูเนียร์",รักงาน,หญิง,บ้านผีสิง,นักแสดง,ผีกะ1,กะ 1,',
  '6510003,ก้อง,ดีงาม,ก้อง,บ้านผีสิง,ฉาก,ทีมฉาก,,รองหัวหน้า',
].join('\r\n');

const EMPTY = { units: [], departments: [], teams: [], members: [] };

test('parseCsv handles quotes, commas, CRLF, BOM and blank lines', () => {
  const rows = R.parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n,\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('validate: good rows, role aliases, Thai headers', () => {
  const v = R.validate(R.parseCsv(CSV));
  assert.deepEqual(v.errors, []);
  assert.equal(v.rows.length, 3);
  assert.equal(v.rows[1].FirstName, 'สมหญิง, จูเนียร์');
  assert.deepEqual(v.rows.map((r) => r.Role), ['head', 'member', 'deputy']);

  const thai = R.validate([
    ['รหัสนักศึกษา', 'ชื่อ', 'นามสกุล', 'ชื่อเล่น', 'แผนก', 'ฝ่าย', 'ทีม'],
    ['6510009', 'ก', 'ข', 'ค', 'บ้านผีสิง', 'ฉาก', 'ทีมฉาก'],
  ]);
  assert.deepEqual(thai.errors, []);
  assert.equal(thai.rows[0].Role, 'member');
});

test('validate: reports bad rows with line numbers, keeps good ones', () => {
  const v = R.validate([
    ['StudentID', 'FirstName', 'LastName', 'Nickname', 'Unit', 'Department', 'Team', 'Role'],
    ['6510001', 'a', 'b', 'c', 'U', 'D', 'T', ''],
    ['bad id!', 'a', 'b', 'c', 'U', 'D', 'T', ''],
    ['6510001', 'a', 'b', 'c', 'U', 'D', 'T', ''],
    ['6510004', 'a', 'b', '', 'U', 'D', 'T', 'boss'],
  ]);
  assert.equal(v.rows.length, 1);
  assert.deepEqual(v.errors.map((e) => e.line), [3, 4, 5]);
  assert.match(v.errors[1].messageTh, /ซ้ำ/);
});

test('validate: missing columns', () => {
  const v = R.validate([['StudentID', 'FirstName'], ['6510001', 'a']]);
  assert.equal(v.rows.length, 0);
  assert.match(v.errors[0].messageTh, /ขาดคอลัมน์/);
});

test('plan: creates org once, inserts members', () => {
  const p = R.plan(R.validate(R.parseCsv(CSV)).rows, EMPTY, { unitId: null });
  assert.equal(p.newUnits.length, 1);
  assert.deepEqual(p.newDepartments.map((d) => d.Name), ['นักแสดง', 'ฉาก']);
  assert.deepEqual(p.newTeams.map((t) => t.TeamID), ['T01', 'T02']);
  assert.equal(p.inserts.length, 3);
  assert.equal(p.inserts[0].TeamID, p.inserts[1].TeamID);
  assert.ok(p.newDepartments[0].Color);
});

test('plan: existing members are updates, ids continue numbering', () => {
  const current = {
    units: [{ UnitID: 'U01', Name: 'บ้านผีสิง' }],
    departments: [{ DeptID: 'D07', UnitID: 'U01', Name: 'นักแสดง' }],
    teams: [{ TeamID: 'T03', UnitID: 'U01', DeptID: 'D07', Name: 'ผีกะ1' }],
    members: [{ StudentID: '6510001', UnitID: 'U01' }],
  };
  const p = R.plan(R.validate(R.parseCsv(CSV)).rows, current, { unitId: null });
  assert.equal(p.newUnits.length, 0);
  assert.deepEqual(p.newDepartments.map((d) => d.DeptID), ['D08']);
  assert.deepEqual(p.newTeams.map((t) => t.TeamID), ['T04']);
  assert.deepEqual(p.updates.map((u) => u.StudentID), ['6510001']);
  assert.equal(p.inserts.length, 2);
});

test('plan: unit admin cannot import into another unit or grant super_admin', () => {
  const current = { ...EMPTY, units: [{ UnitID: 'U01', Name: 'บ้านผีสิง' }, { UnitID: 'U02', Name: 'อื่น' }] };
  const rows = R.validate([
    ['StudentID', 'FirstName', 'LastName', 'Nickname', 'Unit', 'Department', 'Team', 'Role'],
    ['6510001', 'a', 'b', 'c', 'อื่น', 'D', 'T', ''],
    ['6510002', 'a', 'b', 'c', 'ใหม่', 'D', 'T', ''],
    ['6510003', 'a', 'b', 'c', 'บ้านผีสิง', 'D', 'T', 'super_admin'],
    ['6510004', 'a', 'b', 'c', 'บ้านผีสิง', 'D', 'T', ''],
  ]).rows;
  const p = R.plan(rows, current, { unitId: 'U01' });
  assert.deepEqual(p.errors.map((e) => e.studentId), ['6510001', '6510002', '6510003']);
  assert.deepEqual(p.inserts.map((i) => i.StudentID), ['6510004']);
  assert.equal(p.newUnits.length, 0);
});

test('plan: unit admin cannot modify an existing super_admin (or demote them)', () => {
  const current = {
    units: [{ UnitID: 'U01', Name: 'บ้านผีสิง' }], departments: [], teams: [],
    members: [{ StudentID: '6510001', UnitID: 'U01', Role: 'super_admin' }],
  };
  const rows = R.validate([
    ['StudentID', 'FirstName', 'LastName', 'Nickname', 'Unit', 'Department', 'Team', 'Role'],
    ['6510001', 'a', 'b', 'c', 'บ้านผีสิง', 'D', 'T', 'member'],
  ]).rows;
  const scoped = R.plan(rows, current, { unitId: 'U01' });
  assert.equal(scoped.updates.length, 0);
  assert.equal(scoped.errors.length, 1);
  // unscoped (super admin / sheet menu) may still update
  assert.equal(R.plan(rows, current, { unitId: null }).updates.length, 1);
});

test('teams can be decided later: blank dept/team -> placeholders for new, kept for existing', () => {
  const v = R.validate([
    ['รหัสนักศึกษา', 'ชื่อ', 'นามสกุล', 'ชื่อเล่น', 'แผนก'],
    ['6510001', 'สมชาย', 'ใจดี', 'ชาย', 'บ้าน'],
    ['6510002', 'สมหญิง', 'รักงาน', 'หญิง', 'บ้าน'],
  ]);
  assert.deepEqual(v.errors, []);
  const current = {
    units: [{ UnitID: 'U01', Name: 'บ้าน' }],
    departments: [{ DeptID: 'D01', UnitID: 'U01', Name: 'นักแสดง' }],
    teams: [{ TeamID: 'T01', UnitID: 'U01', DeptID: 'D01', Name: 'ผีกะ 1' }],
    members: [{ StudentID: '6510002', UnitID: 'U01', DeptID: 'D01', TeamID: 'T01', Role: 'member' }],
  };
  const p = R.plan(v.rows, current, { unitId: 'U01', rolesFromCsv: false });
  assert.deepEqual(p.newDepartments.map((d) => d.Name), [R.NO_DEPT]);
  assert.deepEqual(p.newTeams.map((t) => t.Name), [R.NO_TEAM]);
  assert.equal(p.inserts[0].TeamID, p.newTeams[0].TeamID);
  assert.equal(p.updates[0].TeamID, 'T01'); // existing person keeps their team
});

test('name and nickname are required (Thai messages)', () => {
  const v = R.validate([
    ['StudentID', 'FirstName', 'LastName', 'Nickname', 'Unit'],
    ['6510001', '', 'ใจดี', '', 'บ้าน'],
  ]);
  assert.match(v.errors[0].messageTh, /ไม่มีชื่อ.*ไม่มีชื่อเล่น/);
});
