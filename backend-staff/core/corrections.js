/**
 * Corrections (spec 5.10), self-reports (decision 2026-10-29: heads report
 * themselves, counted only after admin approval) and period export (5.11). Pure.
 */
var HHCorrections = (function () {
  function H() { return typeof HHHours !== 'undefined' ? HHHours : require('./hours'); }
  function S() { return typeof HHScan !== 'undefined' ? HHScan : require('./scan'); }
  function P() { return typeof HHPermissions !== 'undefined' ? HHPermissions : require('./permissions'); }

  var BANGKOK_OFFSET_MS = 7 * 3600 * 1000;
  var MAX_SESSION_HOURS = 24;
  var SELF_MARK = '[รายงานตัวเอง]';

  /**
   * "HH:mm" on a work date -> Date. Times before WORKDAY_START_HOUR belong to
   * the next calendar day (work dates run past midnight).
   */
  function timeOn(workDate, hhmm, workdayStartHour) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(String(workDate))) return null;
    var h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    var p = String(workDate).split('-').map(Number);
    var dayOffset = h < workdayStartHour ? 1 : 0;
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + dayOffset, h, min) - BANGKOK_OFFSET_MS);
  }

  /**
   * Can `actor` propose a correction for `target`? (heads: own/assigned team,
   * unit admins: their unit; never yourself; never inside a closed period.)
   * @return {string|null} Thai reason when not allowed
   */
  function proposeProblem(actor, target, workDate, assignments, periods) {
    if (String(target.StudentID) === String(actor.studentId)) return 'ขอแก้ไขชั่วโมงของตัวเองไม่ได้';
    if (actor.role !== 'super_admin' && String(target.UnitID) !== String(actor.unitId)) return 'สมาชิกคนนี้อยู่แผนกอื่น';
    if (!P().atLeast(actor.role, 'head')) return 'ต้องเป็นหัวหน้าขึ้นไป';
    if (S().inClosedPeriod(periods, target.UnitID, workDate)) return 'ช่วงวันนี้ปิดงวดแล้ว แก้ไขไม่ได้';
    if (actor.role === 'head' && !S().coversTeam(actor, target.TeamID, assignments, workDate, '')) {
      return 'สมาชิกคนนี้ไม่ได้อยู่ทีมของคุณ';
    }
    return null;
  }

  /** @return {string|null} Thai reason when the proposed times are invalid */
  function timesProblem(inTime, outTime) {
    if (!inTime || !outTime) return 'กรุณาใส่เวลาเข้าและออกให้ถูกต้อง (เช่น 13:05)';
    if (outTime <= inTime) return 'เวลาออกต้องหลังเวลาเข้า';
    if (outTime - inTime > MAX_SESSION_HOURS * 3600 * 1000) return 'ช่วงเวลายาวเกิน 24 ชั่วโมง';
    return null;
  }

  /**
   * Who may approve/reject: unit admin or higher of the same unit, not the
   * proposer and not the person whose hours change (two-person rule).
   * @param {Object} c Corrections row
   * @return {string|null}
   */
  function reviewProblem(actor, c, periods) {
    if (!P().atLeast(actor.role, 'unit_admin')) return 'ต้องเป็นแอดมินแผนกขึ้นไป';
    if (actor.role !== 'super_admin' && String(c.UnitID) !== String(actor.unitId)) return 'คำขอนี้อยู่แผนกอื่น';
    if (c.Status !== 'PENDING') return 'คำขอนี้พิจารณาไปแล้ว';
    if (String(c.ProposedBy) === String(actor.studentId)) return 'ผู้อนุมัติต้องไม่ใช่คนเดียวกับผู้เสนอ';
    if (String(c.TargetStudentID) === String(actor.studentId)) return 'อนุมัติชั่วโมงของตัวเองไม่ได้';
    if (S().inClosedPeriod(periods, c.UnitID, String(c.WorkDate))) return 'ช่วงวันนี้ปิดงวดแล้ว แก้ไขไม่ได้';
    return null;
  }

  /**
   * Which existing session a correction applies to: the given id, else the
   * day's NEEDS_REVIEW session, else the only session, else the latest one.
   * @return {Object|null} WorkSessions row, null = create a new session
   */
  function pickSession(daySessions, sessionId) {
    if (sessionId) {
      return daySessions.filter(function (s) { return String(s.SessionID) === String(sessionId); })[0] || null;
    }
    var review = daySessions.filter(function (s) { return s.Status === 'NEEDS_REVIEW'; });
    if (review.length > 0) return review[review.length - 1];
    if (daySessions.length === 0) return null;
    return daySessions.slice().sort(function (a, b) { return new Date(a.In) - new Date(b.In); })[daySessions.length - 1];
  }

  /** Short text of a session's original values, kept in Note when corrected. */
  function originalNote(s, fmtTime) {
    return 'เดิม: ' + fmtTime(new Date(s.In)) + '–' + (s.Out ? fmtTime(new Date(s.Out)) : '?') +
      ' (' + (Number(s.CountedHours) || 0) + ' ชม., ' + s.Status + ')';
  }

  function isSelfSession(s) {
    return String(s.Note || '').indexOf(SELF_MARK) !== -1;
  }

  /**
   * Hours per member for a date range (export, spec 5.11). Counts COMPLETE and
   * CORRECTED sessions only; pending/needs-review count 0.
   * @return {Array<Array>} rows incl. header
   */
  function exportRows(members, sessions, org, startDate, endDate, pointsPerHour) {
    var hours = {};
    sessions.forEach(function (s) {
      var d = String(s.WorkDate);
      if (d < startDate || d > endDate) return;
      if (s.Status !== 'COMPLETE' && s.Status !== 'CORRECTED') return;
      hours[String(s.StudentID)] = (hours[String(s.StudentID)] || 0) + (Number(s.CountedHours) || 0);
    });
    var header = ['รหัสนักศึกษา', 'ชื่อ', 'นามสกุล', 'ชื่อเล่น', 'ฝ่าย', 'ทีม', 'ชั่วโมงที่นับ'];
    if (pointsPerHour) header.push('แต้ม');
    var rows = members
      .filter(function (m) { return m.Status === 'ACTIVE'; })
      .slice()
      .sort(function (a, b) {
        return String(a.TeamID).localeCompare(String(b.TeamID)) || String(a.StudentID).localeCompare(String(b.StudentID));
      })
      .map(function (m) {
        var h = Math.round((hours[String(m.StudentID)] || 0) * 100) / 100;
        var row = [String(m.StudentID), String(m.FirstName), String(m.LastName), String(m.Nickname),
          org.depts[String(m.DeptID)] || '', org.teams[String(m.TeamID)] || '', h];
        if (pointsPerHour) row.push(Math.round(h * pointsPerHour * 100) / 100);
        return row;
      });
    return [header].concat(rows);
  }

  /** RFC 4180 CSV with a UTF-8 BOM so Excel shows Thai correctly. */
  function toCsv(rows) {
    return '﻿' + rows.map(function (r) {
      return r.map(function (v) {
        var s = String(v === null || v === undefined ? '' : v);
        // Same formula-injection guard as the sheet writer.
        if (/^[=+\-@]/.test(s)) s = "'" + s;
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  /** @return {string|null} */
  function periodProblem(startDate, endDate) {
    var re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(String(startDate)) || !re.test(String(endDate))) return 'กรุณาเลือกวันที่เริ่มและวันที่สิ้นสุด';
    if (String(endDate) < String(startDate)) return 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม';
    return null;
  }

  return {
    SELF_MARK: SELF_MARK,
    timeOn: timeOn,
    proposeProblem: proposeProblem,
    timesProblem: timesProblem,
    reviewProblem: reviewProblem,
    pickSession: pickSession,
    originalNote: originalNote,
    isSelfSession: isSelfSession,
    exportRows: exportRows,
    toCsv: toCsv,
    periodProblem: periodProblem,
  };
})();

if (typeof module !== 'undefined') module.exports = HHCorrections;
