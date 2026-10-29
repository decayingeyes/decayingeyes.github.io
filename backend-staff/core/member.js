/**
 * Member portal views (spec 5.6) and auto-close selection (spec 5.9). Pure.
 */
var HHMember = (function () {
  function H() { return typeof HHHours !== 'undefined' ? HHHours : require('./hours'); }
  function S() { return typeof HHScan !== 'undefined' ? HHScan : require('./scan'); }

  var STATUS_TH = {
    OPEN: 'อยู่ในงาน',
    COMPLETE: 'เสร็จสมบูรณ์',
    NEEDS_REVIEW: 'รอตรวจสอบ (ลืมสแกนออก)',
    CORRECTED: 'แก้ไขแล้ว',
    LOCKED: 'ปิดงวดแล้ว',
  };

  function num(h) { return Math.round((Number(h) || 0) * 100) / 100; }

  function byIn(a, b) { return new Date(a.In) - new Date(b.In); }

  /**
   * "Today" card text for the member portal.
   * @param {Object[]} mine  the member's WorkSessions rows (any dates)
   * @param {Object} nick    studentId -> nickname (for "by <scanner>")
   * @return {{kind: string, text: string, sessions: Object[]}}
   *   kind: NOT_IN | IN | OUT | NEEDS_REVIEW
   */
  function today(mine, workDate, nick, fmtTime) {
    var list = mine.filter(function (s) { return String(s.WorkDate) === workDate; }).sort(byIn);
    var by = function (id) { return nick[String(id)] || String(id || ''); };
    var sessions = list.map(function (s) {
      return {
        in: fmtTime(new Date(s.In)),
        out: s.Out ? fmtTime(new Date(s.Out)) : '',
        countedHours: s.Out ? num(s.CountedHours) : null,
        status: String(s.Status),
        scannedInBy: by(s.ScannedInBy),
        scannedOutBy: by(s.ScannedOutBy),
      };
    });
    if (list.length === 0) return { kind: 'NOT_IN', text: 'ยังไม่ได้สแกนเข้า', sessions: [] };
    var last = list[list.length - 1];
    var lastV = sessions[sessions.length - 1];
    if (last.Status === 'OPEN') {
      return { kind: 'IN', text: 'สแกนเข้าแล้ว ' + lastV.in + ' โดย ' + lastV.scannedInBy, sessions: sessions };
    }
    if (last.Status === 'NEEDS_REVIEW') {
      return { kind: 'NEEDS_REVIEW', text: 'รอตรวจสอบ (ลืมสแกนออก)', sessions: sessions };
    }
    var total = list.reduce(function (t, s) { return t + (Number(s.CountedHours) || 0); }, 0);
    return { kind: 'OUT', text: 'สแกนออกแล้ว ' + lastV.out + ' (วันนี้นับ ' + num(total) + ' ชม.)', sessions: sessions };
  }

  /**
   * History grouped by work date, newest first, plus totals.
   * @param {Object[]} periods Periods rows of the member's unit (CLOSED ones lock sessions)
   * @param {(number|null)} pointsPerHour
   */
  function history(mine, periods, unitId, pointsPerHour, fmtTime) {
    var days = {};
    mine.forEach(function (s) {
      var d = String(s.WorkDate);
      (days[d] = days[d] || []).push(s);
    });
    var total = 0;
    var out = Object.keys(days).sort().reverse().map(function (d) {
      var locked = S().inClosedPeriod(periods, unitId, d);
      var dayTotal = 0;
      var sessions = days[d].sort(byIn).map(function (s) {
        var counted = s.Status === 'OPEN' ? null : num(s.CountedHours);
        dayTotal += counted || 0;
        var status = locked ? 'LOCKED' : String(s.Status);
        return {
          in: fmtTime(new Date(s.In)),
          out: s.Out ? fmtTime(new Date(s.Out)) : '',
          rawMinutes: s.Out ? Number(s.RawMinutes) || 0 : null,
          countedHours: counted,
          status: status,
          statusTh: STATUS_TH[status] || status,
        };
      });
      total += dayTotal;
      return { workDate: d, sessions: sessions, countedHours: num(dayTotal) };
    });
    return {
      days: out,
      totalHours: num(total),
      points: pointsPerHour ? num(total * pointsPerHour) : null,
    };
  }

  /** OPEN sessions whose work date has passed its auto-close time. */
  function staleOpenSessions(sessions, now, autoCloseHour) {
    return sessions.filter(function (s) {
      return s.Status === 'OPEN' && s.WorkDate && now >= H().autoCloseAt(String(s.WorkDate), autoCloseHour);
    });
  }

  /** @return {string|null} Thai problem with a report message */
  function reportProblem(message, workDate) {
    var m = String(message || '').trim();
    if (m.length < 3) return 'กรุณาอธิบายปัญหาสั้นๆ';
    if (m.length > 500) return 'ข้อความยาวเกินไป (ไม่เกิน 500 ตัวอักษร)';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(workDate || ''))) return 'กรุณาเลือกวันที่';
    return null;
  }

  return {
    STATUS_TH: STATUS_TH,
    today: today,
    history: history,
    staleOpenSessions: staleOpenSessions,
    reportProblem: reportProblem,
  };
})();

if (typeof module !== 'undefined') module.exports = HHMember;
