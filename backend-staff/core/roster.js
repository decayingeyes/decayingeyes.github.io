/**
 * Roster import (spec 5.3 step 1): parse CSV, validate rows, and plan which
 * units/departments/teams/members to create or update. Pure: returns a plan,
 * the adapter writes it.
 *
 * CSV columns (header row required, order free, Thai or English header names):
 *   StudentID, FirstName, LastName, Nickname, Unit, Department, Team, Shift, Role
 */
var HHRoster = (function () {
  function A() { return typeof HHAuth !== 'undefined' ? HHAuth : require('./auth'); }
  function P() { return typeof HHPermissions !== 'undefined' ? HHPermissions : require('./permissions'); }

  var COLUMN_ALIASES = {
    StudentID: ['studentid', 'student id', 'รหัสนักศึกษา', 'รหัส'],
    FirstName: ['firstname', 'first name', 'ชื่อ'],
    LastName: ['lastname', 'last name', 'นามสกุล'],
    Nickname: ['nickname', 'ชื่อเล่น'],
    Unit: ['unit', 'แผนก'],
    Department: ['department', 'dept', 'ฝ่าย'],
    Team: ['team', 'ทีม'],
    Shift: ['shift', 'กะ', 'เวร'],
    Role: ['role', 'บทบาท', 'ตำแหน่ง'],
  };
  var REQUIRED = ['StudentID', 'FirstName', 'LastName', 'Nickname', 'Unit'];
  // Teams can be decided later: blank department/team go here for new people
  // (existing people keep their current ones).
  var NO_DEPT = 'ยังไม่จัดฝ่าย';
  var NO_TEAM = 'ยังไม่จัดทีม';

  var ROLE_ALIASES = {
    '': 'member', member: 'member', 'สมาชิก': 'member',
    deputy: 'deputy', 'รองหัวหน้า': 'deputy', 'ผู้สแกนสำรอง': 'deputy',
    head: 'head', 'หัวหน้า': 'head', 'หัวหน้าทีม': 'head',
    unit_admin: 'unit_admin', admin: 'unit_admin', 'แอดมิน': 'unit_admin',
    super_admin: 'super_admin',
  };

  /** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF, commas in quotes). */
  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var s = String(text || '').replace(/^﻿/, '');
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (inQuotes) {
        if (c === '"' && s.charAt(i + 1) === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s.charAt(i + 1) === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += c;
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); });
  }

  function mapHeader(headerRow) {
    var map = {};
    headerRow.forEach(function (h, i) {
      var key = String(h).trim().toLowerCase();
      Object.keys(COLUMN_ALIASES).forEach(function (col) {
        if (map[col] === undefined && COLUMN_ALIASES[col].indexOf(key) !== -1) map[col] = i;
      });
    });
    return map;
  }

  function normalizeRole(raw) {
    var key = String(raw || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(ROLE_ALIASES, key) ? ROLE_ALIASES[key] : null;
  }

  /**
   * Parse and validate roster rows (2D array incl. header, e.g. from parseCsv or a sheet).
   * @return {{rows: Object[], errors: {line: number, messageTh: string}[]}}
   *   line is 1-based and counts the header as line 1.
   */
  function validate(table) {
    var errors = [];
    if (!table || table.length < 2) {
      return { rows: [], errors: [{ line: 1, messageTh: 'ไม่มีข้อมูล (ต้องมีหัวตาราง + อย่างน้อย 1 แถว)' }] };
    }
    var map = mapHeader(table[0]);
    var missing = REQUIRED.filter(function (c) { return map[c] === undefined; });
    if (missing.length > 0) {
      return { rows: [], errors: [{ line: 1, messageTh: 'หัวตารางขาดคอลัมน์: ' + missing.join(', ') }] };
    }
    var seen = {};
    var rows = [];
    for (var i = 1; i < table.length; i++) {
      var line = i + 1;
      var raw = table[i];
      var get = function (col) {
        return map[col] === undefined ? '' : String(raw[map[col]] === undefined ? '' : raw[map[col]]).trim();
      };
      var r = {
        StudentID: A().normalizeStudentId(get('StudentID')),
        FirstName: get('FirstName'),
        LastName: get('LastName'),
        Nickname: get('Nickname'),
        Unit: get('Unit'),
        Department: get('Department'),
        Team: get('Team'),
        Shift: get('Shift'),
        Role: normalizeRole(get('Role')),
      };
      var problems = [];
      if (!A().isValidStudentId(r.StudentID)) problems.push('รหัสนักศึกษาไม่ถูกต้อง');
      var LABEL = { FirstName: 'ชื่อ', LastName: 'นามสกุล', Nickname: 'ชื่อเล่น', Unit: 'แผนก' };
      REQUIRED.slice(1).forEach(function (c) { if (!r[c]) problems.push('ไม่มี' + (LABEL[c] || c)); });
      if (r.Role === null) problems.push('บทบาทไม่ถูกต้อง: "' + get('Role') + '"');
      else if (!P().isRole(r.Role)) problems.push('บทบาทไม่ถูกต้อง');
      if (seen[r.StudentID]) problems.push('รหัสซ้ำกับบรรทัด ' + seen[r.StudentID]);
      if (problems.length > 0) {
        errors.push({ line: line, messageTh: problems.join(', ') });
      } else {
        seen[r.StudentID] = line;
        rows.push(r);
      }
    }
    return { rows: rows, errors: errors };
  }

  function nextId(prefix, existingIds) {
    var max = 0;
    existingIds.forEach(function (id) {
      var m = new RegExp('^' + prefix + '(\\d+)$').exec(String(id));
      if (m) max = Math.max(max, Number(m[1]));
    });
    return function () {
      max += 1;
      return prefix + (max < 10 ? '0' + max : String(max));
    };
  }

  var DEPT_COLORS = ['#e5484d', '#2f80ed', '#2fbf71', '#f2b632', '#9b51e0', '#ff7a1a', '#14b8a6', '#ec4899'];

  /**
   * Plan the import against current org/member data. Matching is by name
   * (unit name; department name within unit; team name within department).
   * Existing members keep password, codes and state; only profile/org/role update.
   *
   * @param {Object[]} rows validated rows
   * @param {{units: Object[], departments: Object[], teams: Object[], members: Object[]}} current
   * @param {{unitId: (string|null)}} scope  unit_admin imports are limited to their unit
   * @return {{newUnits, newDepartments, newTeams, inserts, updates, errors}}
   */
  function plan(rows, current, scope) {
    var units = current.units.slice();
    var depts = current.departments.slice();
    var teams = current.teams.slice();
    var newUnits = [];
    var newDepartments = [];
    var newTeams = [];
    var errors = [];
    var unitId = nextId('U', units.map(function (u) { return u.UnitID; }));
    var deptId = nextId('D', depts.map(function (d) { return d.DeptID; }));
    var teamId = nextId('T', teams.map(function (t) { return t.TeamID; }));

    function findOrCreateUnit(name) {
      var u = units.filter(function (x) { return x.Name === name; })[0];
      if (u) return u;
      u = { UnitID: unitId(), Name: name, Active: true };
      units.push(u); newUnits.push(u);
      return u;
    }
    function findOrCreateDept(uid, name) {
      var d = depts.filter(function (x) { return x.UnitID === uid && x.Name === name; })[0];
      if (d) return d;
      var colorIndex = depts.filter(function (x) { return x.UnitID === uid; }).length % DEPT_COLORS.length;
      d = { DeptID: deptId(), UnitID: uid, Name: name, Color: DEPT_COLORS[colorIndex] };
      depts.push(d); newDepartments.push(d);
      return d;
    }
    function findOrCreateTeam(uid, did, name) {
      var t = teams.filter(function (x) { return x.UnitID === uid && x.DeptID === did && x.Name === name; })[0];
      if (t) return t;
      t = { TeamID: teamId(), UnitID: uid, DeptID: did, Name: name };
      teams.push(t); newTeams.push(t);
      return t;
    }

    var byId = {};
    current.members.forEach(function (m) { byId[String(m.StudentID).toUpperCase()] = m; });

    var inserts = [];
    var updates = [];
    rows.forEach(function (r) {
      var existingUnit = units.filter(function (x) { return x.Name === r.Unit; })[0];
      if (scope.unitId && (!existingUnit || existingUnit.UnitID !== scope.unitId)) {
        errors.push({ studentId: r.StudentID, messageTh: 'นำเข้าได้เฉพาะแผนกของตัวเอง' });
        return;
      }
      var existing = byId[r.StudentID];
      if (scope.unitId && existing && existing.UnitID !== scope.unitId) {
        errors.push({ studentId: r.StudentID, messageTh: 'รหัสนี้อยู่แผนกอื่น' });
        return;
      }
      // Unit admins may not edit (e.g. demote) an existing super admin.
      if (scope.unitId && existing && existing.Role === 'super_admin') {
        errors.push({ studentId: r.StudentID, messageTh: 'แก้ไขข้อมูลผู้ดูแลระบบสูงสุดไม่ได้' });
        return;
      }
      // Only unscoped imports (super admin / sheet menu) may grant super_admin.
      if (scope.unitId && scope.rolesFromCsv !== false && r.Role === 'super_admin') {
        errors.push({ studentId: r.StudentID, messageTh: 'ตั้งบทบาท super_admin ไม่ได้' });
        return;
      }
      var u = findOrCreateUnit(r.Unit);
      var d, t;
      if (!r.Department && !r.Team && existing && String(existing.UnitID) === u.UnitID) {
        // No team given for someone already placed: keep where they are.
        d = { DeptID: existing.DeptID };
        t = { TeamID: existing.TeamID };
      } else {
        d = findOrCreateDept(u.UnitID, r.Department || NO_DEPT);
        t = findOrCreateTeam(u.UnitID, d.DeptID, r.Team || NO_TEAM);
      }
      var fields = {
        StudentID: r.StudentID, UnitID: u.UnitID, DeptID: d.DeptID, TeamID: t.TeamID,
        FirstName: r.FirstName, LastName: r.LastName, Nickname: r.Nickname, Shift: r.Shift, Role: r.Role,
      };
      // Web imports: positions are assigned only through role.set, never by CSV.
      if (scope.rolesFromCsv === false) {
        if (existing) delete fields.Role;
        else fields.Role = 'member';
      }
      if (existing) updates.push(fields);
      else inserts.push(fields);
    });

    return {
      newUnits: newUnits, newDepartments: newDepartments, newTeams: newTeams,
      inserts: inserts, updates: updates, errors: errors,
    };
  }

  return {
    NO_DEPT: NO_DEPT,
    NO_TEAM: NO_TEAM,
    parseCsv: parseCsv,
    normalizeRole: normalizeRole,
    validate: validate,
    plan: plan,
  };
})();

if (typeof module !== 'undefined') module.exports = HHRoster;
