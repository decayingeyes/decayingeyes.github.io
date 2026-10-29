/**
 * Thai summary tabs in the spreadsheet: "วันนี้" (today) and "สรุปรายวัน"
 * (members x work dates). Pure: returns 2-D arrays + a state per row for colouring.
 */
var HHSummary = (function () {
  function T() { return typeof HHTeam !== 'undefined' ? HHTeam : require('./team'); }

  var STATE_TH = { IN: '🟢 อยู่ในงาน', LEFT: '🔵 กลับแล้ว', NOT_HERE: '⚪ ยังไม่มา' };
  var TODAY_HEADER = ['สถานะ', 'ชื่อเล่น', 'ชื่อ-นามสกุล', 'รหัสนักศึกษา', 'ฝ่าย', 'ทีม',
    'เวลาเข้า', 'เวลาออก', 'ชั่วโมงที่นับ (วันนี้)', 'สแกนโดย'];

  function num(h) { return Math.round(h * 100) / 100; }

  /**
   * @param {Object} org { teams: {id: name}, depts: {id: name}, nick: {studentId: nickname} }
   * @return {{rows: Array<Array>, states: string[], counts}}
   */
  function today(members, sessions, org, workDate, fmtTime) {
    var built = T().build(members, sessions, null, workDate, fmtTime);
    var deptOf = {};
    members.forEach(function (m) { deptOf[String(m.StudentID)] = org.depts[String(m.DeptID)] || ''; });
    var rows = built.members.map(function (r) {
      var first = r.sessions[0];
      var lastS = r.sessions[r.sessions.length - 1];
      var scanners = [];
      r.sessions.forEach(function (s) {
        [s.scannedInBy, s.scannedOutBy].forEach(function (id) {
          var n = org.nick[id] || id;
          if (n && scanners.indexOf(n) === -1) scanners.push(n);
        });
      });
      return [
        STATE_TH[r.state], r.nickname, r.fullName, r.studentId, deptOf[r.studentId], org.teams[r.teamId] || '',
        r.sessions.map(function (s) { return s.in; }).join(', '),
        r.sessions.map(function (s) { return s.status === 'NEEDS_REVIEW' ? 'ลืมสแกนออก' : (s.out || '(ยังอยู่)'); }).join(', '),
        r.sessions.length ? num(r.hoursToday) : '',
        scanners.join(', '),
      ];
    });
    return { rows: rows, states: built.members.map(function (r) { return r.state; }), counts: built.counts };
  }

  /**
   * Members x work dates. Cell: "13:05–18:40 · 5.5 ชม." per session (joined by
   * new lines), "13:05– (ยังอยู่)" for an open session, "" when absent.
   * @param {string[]} dates ascending yyyy-MM-dd
   */
  function matrix(members, sessions, org, dates, fmtTime) {
    var header = ['ชื่อเล่น', 'ชื่อ-นามสกุล', 'รหัสนักศึกษา', 'ทีม'].concat(dates).concat(['รวมชั่วโมง', 'จำนวนวันที่มา']);
    var key = function (sid, d) { return sid + '|' + d; };
    var cells = {};
    sessions.forEach(function (s) {
      var k = key(String(s.StudentID), String(s.WorkDate));
      (cells[k] = cells[k] || []).push(s);
    });
    var rows = members
      .filter(function (m) { return m.Status === 'ACTIVE'; })
      .slice()
      .sort(function (a, b) {
        return String(a.TeamID).localeCompare(String(b.TeamID)) || String(a.Nickname).localeCompare(String(b.Nickname), 'th');
      })
      .map(function (m) {
        var sid = String(m.StudentID);
        var total = 0;
        var days = 0;
        var dayCells = dates.map(function (d) {
          var list = (cells[key(sid, d)] || []).slice().sort(function (a, b) { return new Date(a.In) - new Date(b.In); });
          if (list.length === 0) return '';
          days++;
          return list.map(function (s) {
            if (s.Status === 'NEEDS_REVIEW') return fmtTime(new Date(s.In)) + '– ลืมสแกนออก (0 ชม.)';
            if (!s.Out) return fmtTime(new Date(s.In)) + '– (ยังอยู่)';
            var h = Number(s.CountedHours) || 0;
            total += h;
            return fmtTime(new Date(s.In)) + '–' + fmtTime(new Date(s.Out)) + ' · ' + num(h) + ' ชม.';
          }).join('\n');
        });
        return [String(m.Nickname), String(m.FirstName) + ' ' + String(m.LastName), sid, org.teams[String(m.TeamID)] || '']
          .concat(dayCells).concat([num(total), days]);
      });
    return { header: header, rows: rows };
  }

  /** Distinct work dates in sessions plus `todayDate`, ascending. */
  function dates(sessions, todayDate) {
    var set = {};
    sessions.forEach(function (s) { if (s.WorkDate) set[String(s.WorkDate)] = true; });
    set[todayDate] = true;
    return Object.keys(set).sort();
  }

  return {
    STATE_TH: STATE_TH,
    TODAY_HEADER: TODAY_HEADER,
    today: today,
    matrix: matrix,
    dates: dates,
  };
})();

if (typeof module !== 'undefined') module.exports = HHSummary;
