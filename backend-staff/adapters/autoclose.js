/**
 * Auto-close forgotten checkouts (spec 5.9). Hourly trigger: every OPEN session
 * past its work date's AUTO_CLOSE_HOUR becomes NEEDS_REVIEW with 0 counted
 * hours, the member is reset to OUT, and an alert is raised for the head.
 * Fixing the hours goes through the correction flow (M4).
 */
var HHAutoClose = (function () {
  /** @return {number} sessions closed */
  function run(now) {
    now = now || new Date();
    var cfg = HHConfig.get();
    var hour = cfg.AUTO_CLOSE_HOUR;
    var stale = HHMember.staleOpenSessions(HHSheets.readAll('WorkSessions'), now, hour);
    if (stale.length === 0) return 0;

    return HHLock.withLock(function () {
      var sessions = HHRepo.all('WorkSessions');
      var members = HHRepo.all('Members');
      var memberRow = {};
      members.forEach(function (m) { memberRow[String(m.data.StudentID)] = m; });
      var closed = 0;
      sessions.forEach(function (s) {
        // Re-check under the lock: someone may have scanned out meanwhile.
        if (s.data.Status !== 'OPEN' || !s.data.WorkDate) return;
        if (now < HHHours.autoCloseAt(String(s.data.WorkDate), hour)) return;
        var sid = String(s.data.StudentID);
        HHRepo.update('WorkSessions', s.row, {
          Status: 'NEEDS_REVIEW', CountedHours: 0,
          Note: [s.data.Note, 'ลืมสแกนออก — ปิดอัตโนมัติ'].filter(String).join(' | '),
        });
        var m = memberRow[sid];
        if (m && String(m.data.OpenSessionID) === String(s.data.SessionID)) {
          HHRepo.update('Members', m.row, { CurrentState: 'OUT', OpenSessionID: '' });
        }
        HHLog.append({
          unitId: s.data.UnitID, studentId: sid, action: 'AUTO_CLOSE', actorId: 'SYSTEM', method: 'SYSTEM',
          note: 'session ' + s.data.SessionID + ' of ' + s.data.WorkDate,
        });
        HHSheets.append('Alerts', {
          AlertID: 'A' + Date.now().toString(36) + closed,
          UnitID: s.data.UnitID, Type: 'FORGOT_CHECKOUT', StudentID: sid,
          Detail: 'ลืมสแกนออกวันที่ ' + s.data.WorkDate + ' (เข้า ' + HHHours.bangkokTime(new Date(s.data.In)) + ') — นับ 0 ชม. รอแก้ไข',
          CreatedAt: now, Status: 'OPEN',
        });
        closed++;
      });
      if (closed > 0) HHSummarySheets.markDirty();
      return closed;
    }, 30000);
  }

  return { run: run };
})();

/** Time-driven trigger entry point (installed by the setup menu). */
function autoCloseTick() {
  HHAutoClose.run(new Date());
}
