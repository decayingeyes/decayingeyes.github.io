/**
 * me.* handlers: only the caller's own data. No studentId parameter is read.
 */

function handleMeCard_(payload, ctx) {
  var m = HHRepo.findBy('Members', 'StudentID', ctx.actor.studentId);
  var secret = HHProps.get(HHProps.KEYS.HMAC_SECRET);
  if (!secret) throw new HHErrors.AppError('NOT_CONFIGURED', null, 'HMAC_SECRET missing');
  var p = profileOf_(m.data);
  p.eventName = HHConfig.get().EVENT_NAME;
  p.barcode = HHBarcode.payload(String(m.data.StudentID), Number(m.data.CodeVersion) || 1, secret, HHCrypto.hmacBytes);
  p.photo = HHPhotos.get(m.data.StudentID);
  return p;
}

function mySessions_(studentId) {
  return HHSheets.readAll('WorkSessions').filter(function (s) { return String(s.StudentID) === String(studentId); });
}

function nicknames_(unitId) {
  var nick = {};
  HHSheets.readAll('Members').forEach(function (m) {
    if (String(m.UnitID) === String(unitId)) nick[String(m.StudentID)] = String(m.Nickname);
  });
  return nick;
}

function handleMeToday_(payload, ctx) {
  var cfg = HHConfig.get();
  var workDate = HHHours.workDate(new Date(), cfg.WORKDAY_START_HOUR);
  var t = HHMember.today(mySessions_(ctx.actor.studentId), workDate, nicknames_(ctx.actor.unitId), HHHours.bangkokTime);
  t.workDate = workDate;
  return t;
}

function handleMeHistory_(payload, ctx) {
  var cfg = HHConfig.get();
  var periods = HHSheets.readAll('Periods').filter(function (p) { return String(p.UnitID) === String(ctx.actor.unitId); });
  return HHMember.history(mySessions_(ctx.actor.studentId), periods, ctx.actor.unitId, cfg.POINTS_PER_HOUR, HHHours.bangkokTime);
}

var REPORT_STATUS_TH = { OPEN: 'รอหัวหน้าตรวจสอบ', RESOLVED: 'ตรวจสอบแล้ว', CONVERTED: 'ส่งขอแก้ไขชั่วโมงแล้ว' };

function handleMeReports_(payload, ctx) {
  return HHSheets.readAll('Reports')
    .filter(function (r) { return String(r.StudentID) === ctx.actor.studentId; })
    .reverse()
    .map(function (r) {
      return {
        reportId: String(r.ReportID), workDate: String(r.WorkDate), message: String(r.Message),
        status: String(r.Status), statusTh: REPORT_STATUS_TH[r.Status] || String(r.Status),
        resolvedNote: String(r.ResolvedNote || ''),
      };
    });
}

function handleMeReportCreate_(payload, ctx) {
  var problem = HHMember.reportProblem(payload.message, payload.workDate);
  if (problem) throw new HHErrors.AppError('VALIDATION', problem);
  var open = HHSheets.readAll('Reports').filter(function (r) {
    return String(r.StudentID) === ctx.actor.studentId && r.Status === 'OPEN';
  }).length;
  if (open >= 5) throw new HHErrors.AppError('VALIDATION', 'มีเรื่องที่รอตรวจสอบอยู่ 5 เรื่องแล้ว กรุณารอหัวหน้าตรวจก่อน');
  var id = 'R' + Date.now().toString(36) + HHIds.randomString(3, function () { return HHCrypto.randInt(36) / 36; });
  HHSheets.append('Reports', {
    ReportID: id, UnitID: ctx.actor.unitId, StudentID: ctx.actor.studentId,
    WorkDate: String(payload.workDate), Message: String(payload.message).trim().slice(0, 500), Status: 'OPEN',
  });
  return { reportId: id };
}
