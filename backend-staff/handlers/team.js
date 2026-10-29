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
  var result = HHAccounts.importRoster(HHRoster.parseCsv(payload.csv), {
    unitId: unitId, actorId: ctx.actor.studentId, requestId: ctx.requestId,
  });
  HHOrg.clearCache();
  return result;
}
