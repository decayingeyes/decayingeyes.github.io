/**
 * team.* and roster handlers for heads and unit admins.
 */

/** Live status of the teams the caller may see, for today's work date (or payload.date). */
function handleTeamStatus_(payload, ctx) {
  var cfg = HHConfig.get();
  var workDate = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || ''))
    ? String(payload.date)
    : HHHours.workDate(new Date(), cfg.WORKDAY_START_HOUR);
  var unitId = String(ctx.actor.unitId);
  var inUnit = function (r) { return String(r.UnitID) === unitId; };
  var members = HHSheets.readAll('Members').filter(inUnit);
  var teams = HHSheets.readAll('Teams').filter(inUnit);
  var teamIds = HHTeam.visibleTeams(ctx.actor, HHSheets.readAll('ScannerAssignments').filter(inUnit), workDate,
    teams.map(function (t) { return String(t.TeamID); }));
  var sessions = HHSheets.readAll('WorkSessions').filter(inUnit);
  var result = HHTeam.build(members, sessions, teamIds, workDate, HHHours.bangkokTime);

  // Overdue: still IN longer than MAX_OPEN_HOURS (spec 5.13).
  var overdueBefore = Date.now() - cfg.MAX_OPEN_HOURS * 3600 * 1000;
  var overdue = {};
  sessions.forEach(function (s) {
    if (s.Status === 'OPEN' && new Date(s.In).getTime() < overdueBefore) overdue[String(s.StudentID)] = true;
  });
  var withPhoto = HHPhotos.idsWithPhoto(unitId);
  result.members.forEach(function (r) { r.overdue = !!overdue[r.studentId]; r.hasPhoto = !!withPhoto[r.studentId]; });

  var nick = {};
  members.forEach(function (m) { nick[String(m.StudentID)] = String(m.Nickname); });
  var teamName = {};
  teams.forEach(function (t) { teamName[String(t.TeamID)] = String(t.Name); });
  result.members.forEach(function (r) {
    r.teamName = teamName[r.teamId] || '';
    r.sessions.forEach(function (s) {
      s.scannedInBy = nick[s.scannedInBy] || s.scannedInBy;
      s.scannedOutBy = nick[s.scannedOutBy] || s.scannedOutBy;
    });
  });
  result.teams = (teamIds === null ? teams : teams.filter(function (t) { return teamIds.indexOf(String(t.TeamID)) !== -1; }))
    .map(function (t) { return { teamId: String(t.TeamID), name: String(t.Name) }; });
  result.serverTime = HHHours.bangkokTime(new Date());
  return result;
}

function handleTeamActivationCodeIssue_(payload, ctx) {
  return HHAccounts.issueCode(payload.studentId, ctx.actor, ctx.requestId);
}

/** payload.csv: CSV text with a header row. Unit admins are scoped to their own unit. */
function handleRosterImport_(payload, ctx) {
  if (typeof payload.csv !== 'string' || payload.csv.trim() === '') {
    throw new HHErrors.AppError('VALIDATION', 'กรุณาวางข้อมูล CSV');
  }
  var unitId = ctx.actor.role === 'super_admin' ? null : ctx.actor.unitId;
  // Web imports never set positions: new people join as member; roles come from role.set.
  var result = HHAccounts.importRoster(HHRoster.parseCsv(payload.csv), {
    unitId: unitId, actorId: ctx.actor.studentId, requestId: ctx.requestId, rolesFromCsv: false,
  });
  HHOrg.clearCache();
  return result;
}

/** Open member reports for the teams the caller may see. */
function handleTeamReports_(payload, ctx) {
  var unitId = String(ctx.actor.unitId);
  var inUnit = function (r) { return String(r.UnitID) === unitId; };
  var members = HHSheets.readAll('Members').filter(inUnit);
  var teamOf = {}, nick = {};
  members.forEach(function (m) { teamOf[String(m.StudentID)] = String(m.TeamID); nick[String(m.StudentID)] = String(m.Nickname); });
  var cfg = HHConfig.get();
  var teamIds = HHTeam.visibleTeams(ctx.actor, HHSheets.readAll('ScannerAssignments').filter(inUnit),
    HHHours.workDate(new Date(), cfg.WORKDAY_START_HOUR), HHSheets.readAll('Teams').filter(inUnit).map(function (t) { return String(t.TeamID); }));
  var visible = function (sid) { return teamIds === null || teamIds.indexOf(teamOf[sid]) !== -1; };
  var reports = HHSheets.readAll('Reports').filter(function (r) {
    return inUnit(r) && r.Status === 'OPEN' && visible(String(r.StudentID)) && String(r.StudentID) !== ctx.actor.studentId;
  }).map(function (r) {
    return { reportId: String(r.ReportID), studentId: String(r.StudentID), nickname: nick[String(r.StudentID)] || '',
      workDate: String(r.WorkDate), message: String(r.Message) };
  });
  var alerts = HHSheets.readAll('Alerts').filter(function (a) {
    return inUnit(a) && a.Status === 'OPEN' && visible(String(a.StudentID));
  }).map(function (a) {
    return { alertId: String(a.AlertID), type: String(a.Type), studentId: String(a.StudentID),
      nickname: nick[String(a.StudentID)] || '', detail: String(a.Detail) };
  });
  return { reports: reports, alerts: alerts };
}

/** Mark a report resolved with a note. Nobody resolves their own report. */
function handleTeamReportResolve_(payload, ctx) {
  var note = String(payload.note || '').trim().slice(0, 300);
  if (!note) throw new HHErrors.AppError('VALIDATION', 'กรุณาเขียนบันทึกการตรวจสอบ');
  return HHLock.withLock(function () {
    var r = HHRepo.findBy('Reports', 'ReportID', String(payload.reportId || ''));
    if (!r || String(r.data.UnitID) !== String(ctx.actor.unitId)) throw new HHErrors.AppError('NOT_FOUND');
    if (String(r.data.StudentID) === ctx.actor.studentId) throw new HHErrors.AppError('FORBIDDEN', 'ตรวจเรื่องของตัวเองไม่ได้');
    if (r.data.Status !== 'OPEN') throw new HHErrors.AppError('VALIDATION', 'เรื่องนี้ตรวจสอบไปแล้ว');
    if (ctx.actor.role !== 'unit_admin' && ctx.actor.role !== 'super_admin') {
      var m = HHRepo.findBy('Members', 'StudentID', String(r.data.StudentID));
      var cfg = HHConfig.get();
      var ok = m && HHScan.coversTeam(ctx.actor, m.data.TeamID,
        HHSheets.readAll('ScannerAssignments'), HHHours.workDate(new Date(), cfg.WORKDAY_START_HOUR), '');
      if (!ok) throw new HHErrors.AppError('FORBIDDEN', 'สมาชิกคนนี้ไม่ได้อยู่ทีมของคุณ');
    }
    HHRepo.update('Reports', r.row, { Status: 'RESOLVED', ResolvedBy: ctx.actor.studentId, ResolvedNote: note });
    return { reportId: String(r.data.ReportID), status: 'RESOLVED' };
  });
}
