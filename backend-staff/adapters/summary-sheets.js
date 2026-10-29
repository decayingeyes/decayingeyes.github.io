/**
 * Writes the Thai summary tabs ("📅 วันนี้", "🗓️ สรุปรายวัน") as the first two
 * tabs of the spreadsheet. Rebuilt by a 1-minute trigger only when a scan
 * marked them dirty (or the work date changed), to stay inside free quotas.
 */
var HHSummarySheets = (function () {
  var TODAY_SHEET = '📅 วันนี้';
  var MATRIX_SHEET = '🗓️ สรุปรายวัน';
  var DIRTY_KEY = 'summary:dirty';
  var BUILT_DATE_KEY = 'SUMMARY_BUILT_DATE';
  var STATE_BG = { IN: '#d9f5e3', LEFT: '#dbe9ff', NOT_HERE: '#f1f1f4' };

  function markDirty() {
    CacheService.getScriptCache().put(DIRTY_KEY, '1', 21600);
  }

  /** Trigger entry: rebuild only when needed. */
  function tick() {
    var cfg = HHConfig.get();
    var today = HHHours.workDate(new Date(), cfg.WORKDAY_START_HOUR);
    var dirty = CacheService.getScriptCache().get(DIRTY_KEY) === '1';
    if (!dirty && HHProps.get(BUILT_DATE_KEY) === today) return false;
    refresh();
    return true;
  }

  function sheetAt_(book, name, index) {
    var sh = book.getSheetByName(name) || book.insertSheet(name, index);
    if (sh.getIndex() !== index + 1) {
      book.setActiveSheet(sh);
      book.moveActiveSheet(index + 1);
    }
    return sh;
  }

  function orgMaps_(members) {
    var teams = {}, depts = {}, nick = {};
    HHSheets.readAll('Teams').forEach(function (t) { teams[String(t.TeamID)] = String(t.Name); });
    HHSheets.readAll('Departments').forEach(function (d) { depts[String(d.DeptID)] = String(d.Name); });
    members.forEach(function (m) { nick[String(m.StudentID)] = String(m.Nickname); });
    return { teams: teams, depts: depts, nick: nick };
  }

  function refresh() {
    CacheService.getScriptCache().remove(DIRTY_KEY);
    var cfg = HHConfig.get();
    var now = new Date();
    var today = HHHours.workDate(now, cfg.WORKDAY_START_HOUR);
    var members = HHSheets.readAll('Members');
    var sessions = HHSheets.readAll('WorkSessions');
    var org = orgMaps_(members);
    var book = HHSheets.ss();
    var stamp = 'อัปเดตอัตโนมัติ ' + HHHours.bangkokDate(now) + ' ' + HHHours.bangkokTime(now) + ' น. (ทุก 1 นาทีเมื่อมีการสแกน) · แก้ไขในแท็บนี้จะถูกเขียนทับ';

    // --- today ---
    var t = HHSummary.today(members, sessions, org, today, HHHours.bangkokTime);
    var sh = sheetAt_(book, TODAY_SHEET, 0);
    sh.clear();
    var title = 'สรุปการเข้างานวันที่ ' + today + '  ·  🟢 อยู่ในงาน ' + t.counts.in + '  ·  🔵 กลับแล้ว ' + t.counts.left + '  ·  ⚪ ยังไม่มา ' + t.counts.notHere;
    sh.getRange(1, 1).setValue(title).setFontWeight('bold').setFontSize(14);
    sh.getRange(2, 1).setValue(stamp).setFontColor('#777777');
    var header = HHSummary.TODAY_HEADER;
    sh.getRange(4, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#2b2b33').setFontColor('#ffffff');
    if (t.rows.length > 0) {
      var body = sh.getRange(5, 1, t.rows.length, header.length);
      body.setNumberFormat('@').setValues(t.rows.map(function (r) { return r.map(function (v) { return HHSheets.safe(String(v)); }); }));
      body.setBackgrounds(t.states.map(function (s) { return header.map(function () { return STATE_BG[s]; }); }));
    }
    sh.setFrozenRows(4);
    // Fixed widths: auto-resize would stretch column A to the long title in A1.
    [120, 80, 180, 110, 90, 90, 90, 100, 130, 120].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    protectView_(sh);

    // --- matrix ---
    var dates = HHSummary.dates(sessions, today);
    var mx = HHSummary.matrix(members, sessions, org, dates, HHHours.bangkokTime);
    var sh2 = sheetAt_(book, MATRIX_SHEET, 1);
    sh2.clear();
    sh2.getRange(1, 1).setValue('สรุปการเข้างานรายวัน (แต่ละช่อง = เวลาเข้า–ออก · ชั่วโมงที่นับ, ว่าง = ไม่มา)').setFontWeight('bold').setFontSize(14);
    sh2.getRange(2, 1).setValue(stamp).setFontColor('#777777');
    sh2.getRange(4, 1, 1, mx.header.length).setNumberFormat('@').setValues([mx.header])
      .setFontWeight('bold').setBackground('#2b2b33').setFontColor('#ffffff');
    if (mx.rows.length > 0) {
      var r2 = sh2.getRange(5, 1, mx.rows.length, mx.header.length);
      r2.setNumberFormat('@').setValues(mx.rows.map(function (r) { return r.map(function (v) { return HHSheets.safe(String(v)); }); })).setVerticalAlignment('top').setWrap(true);
      r2.setBackgrounds(mx.rows.map(function (r) {
        return r.map(function (v, i) {
          var isDate = i >= 4 && i < 4 + dates.length;
          if (!isDate) return null;
          return v === '' ? '#f6f6f8' : '#d9f5e3';
        });
      }));
    }
    sh2.setFrozenRows(4);
    sh2.setFrozenColumns(2);
    [80, 180, 110, 80].forEach(function (w, i) { sh2.setColumnWidth(i + 1, w); });
    if (dates.length > 0) sh2.setColumnWidths(5, dates.length, 170);
    sh2.setColumnWidths(5 + dates.length, 2, 100);
    protectView_(sh2);

    HHProps.set(BUILT_DATE_KEY, today);
  }

  /** Warn (not block) the owner before editing a generated tab. */
  function protectView_(sh) {
    var existing = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    if (existing.length === 0) sh.protect().setDescription('สร้างอัตโนมัติ — แก้ที่นี่จะถูกเขียนทับ').setWarningOnly(true);
  }

  return {
    TODAY_SHEET: TODAY_SHEET,
    MATRIX_SHEET: MATRIX_SHEET,
    markDirty: markDirty,
    tick: tick,
    refresh: refresh,
  };
})();

/** Time-driven trigger entry point (installed by the setup menu). */
function summaryTick() {
  HHSummarySheets.tick();
}
