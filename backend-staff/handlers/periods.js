/**
 * Period closing, reopening and export (spec 5.11).
 * The final export is written as a tab in the spreadsheet (no extra Drive
 * scope needed; see CHANGELOG) and returned as CSV for download.
 */

function exportFor_(unitId, startDate, endDate) {
  var cfg = HHConfig.get();
  var org = { depts: {}, teams: {} };
  unitRows_('Departments', unitId).forEach(function (d) { org.depts[String(d.DeptID)] = String(d.Name); });
  unitRows_('Teams', unitId).forEach(function (t) { org.teams[String(t.TeamID)] = String(t.Name); });
  return HHCorrections.exportRows(unitRows_('Members', unitId), unitRows_('WorkSessions', unitId), org,
    startDate, endDate, cfg.POINTS_PER_HOUR);
}

function handleExportSummary_(payload, ctx) {
  var p = HHCorrections.periodProblem(payload.startDate, payload.endDate);
  if (p) throw new HHErrors.AppError('VALIDATION', p);
  var rows = exportFor_(ctx.actor.unitId, String(payload.startDate), String(payload.endDate));
  return {
    filename: 'hours_' + payload.startDate + '_' + payload.endDate + '.csv',
    csv: HHCorrections.toCsv(rows),
    members: rows.length - 1,
  };
}

function handlePeriodClose_(payload, ctx) {
  var start = String(payload.startDate || ''), end = String(payload.endDate || '');
  var p = HHCorrections.periodProblem(start, end);
  if (p) throw new HHErrors.AppError('VALIDATION', p);
  var unitId = String(ctx.actor.unitId);
  var inRange = function (r) { return String(r.WorkDate) >= start && String(r.WorkDate) <= end; };

  return HHLock.withLock(function () {
    var open = unitRows_('WorkSessions', unitId).filter(function (s) { return inRange(s) && s.Status === 'OPEN'; });
    if (open.length > 0) {
      throw new HHErrors.AppError('VALIDATION', 'ยังมีคนสแกนเข้าค้างอยู่ ' + open.length + ' คนในช่วงนี้ ให้สแกนออกหรือรอปิดอัตโนมัติก่อน');
    }
    var pending = unitRows_('Corrections', unitId).filter(function (c) { return inRange(c) && c.Status === 'PENDING'; });
    if (pending.length > 0) {
      throw new HHErrors.AppError('VALIDATION', 'ยังมีคำขอแก้ไข/รายงานตัวรออนุมัติ ' + pending.length + ' รายการในช่วงนี้');
    }

    var rows = exportFor_(unitId, start, end);
    var book = HHSheets.ss();
    var name = 'ส่งออก ' + start + ' ถึง ' + end;
    var old = book.getSheetByName(name);
    if (old) book.deleteSheet(old);
    var sh = book.insertSheet(name);
    sh.getRange(1, 1, rows.length, rows[0].length).setNumberFormat('@')
      .setValues(rows.map(function (r) { return r.map(function (v) { return HHSheets.safe(String(v)); }); }));
    sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.protect().setDescription('ผลส่งออกตอนปิดงวด').setWarningOnly(true);
    var link = book.getUrl() + '#gid=' + sh.getSheetId();

    var periodId = newId_('P');
    HHSheets.append('Periods', {
      PeriodID: periodId, UnitID: unitId, StartDate: start, EndDate: end, Status: 'CLOSED',
      ClosedBy: ctx.actor.studentId, ClosedAt: new Date(), ExportLink: link,
    });
    HHRepo.all('WorkSessions').forEach(function (s) {
      if (String(s.data.UnitID) === unitId && inRange(s.data)) HHRepo.update('WorkSessions', s.row, { Locked: true });
    });
    HHLog.append({ unitId: unitId, action: 'PERIOD_CLOSE', actorId: ctx.actor.studentId, method: 'ADMIN',
      note: periodId + ' ' + start + '..' + end });
    return { periodId: periodId, exportLink: link, members: rows.length - 1, csv: HHCorrections.toCsv(rows),
      filename: 'hours_' + start + '_' + end + '.csv' };
  });
}

function handlePeriodReopen_(payload, ctx) {
  var reason = String(payload.reason || '').trim().slice(0, 300);
  if (reason.length < 3) throw new HHErrors.AppError('REASON_REQUIRED');
  return HHLock.withLock(function () {
    var p = HHRepo.findBy('Periods', 'PeriodID', String(payload.periodId || ''));
    if (!p) throw new HHErrors.AppError('NOT_FOUND');
    if (p.data.Status !== 'CLOSED') throw new HHErrors.AppError('VALIDATION', 'งวดนี้ไม่ได้ปิดอยู่');
    HHRepo.update('Periods', p.row, { Status: 'OPEN', ReopenReason: reason });
    var start = String(p.data.StartDate), end = String(p.data.EndDate);
    // Unlock only days not covered by another still-closed period.
    var stillClosed = HHSheets.readAll('Periods').filter(function (x) {
      return String(x.UnitID) === String(p.data.UnitID) && x.Status === 'CLOSED' && String(x.PeriodID) !== String(p.data.PeriodID);
    });
    HHRepo.all('WorkSessions').forEach(function (s) {
      var wd = String(s.data.WorkDate);
      if (String(s.data.UnitID) !== String(p.data.UnitID) || wd < start || wd > end) return;
      if (!HHScan.inClosedPeriod(stillClosed, p.data.UnitID, wd)) HHRepo.update('WorkSessions', s.row, { Locked: false });
    });
    HHLog.append({ unitId: p.data.UnitID, action: 'PERIOD_REOPEN', actorId: ctx.actor.studentId, method: 'ADMIN',
      reason: reason, note: String(p.data.PeriodID) });
    return { periodId: String(p.data.PeriodID), status: 'OPEN' };
  });
}
