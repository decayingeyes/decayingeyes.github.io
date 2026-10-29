/**
 * team.* and roster handlers for heads and unit admins.
 */

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
