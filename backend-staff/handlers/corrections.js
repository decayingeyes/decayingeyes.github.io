/**
 * Corrections (two-person rule, spec 5.10) and head self-reports.
 * Self-reports: a head/deputy reports themselves in/out with server time; the
 * session counts 0 h (NEEDS_REVIEW) until a unit admin approves the
 * automatically created SELF_REPORT correction.
 */

function newId_(prefix) {
  return prefix + Date.now().toString(36) + HHIds.randomString(3, function () { return HHCrypto.randInt(36) / 36; });
}

function unitRows_(sheet, unitId) {
  return HHSheets.readAll(sheet).filter(function (r) { return String(r.UnitID) === String(unitId); });
}

/** Create a PENDING SELF_REPORT correction for a just-closed self-reported session. Caller holds the lock. */
function createSelfReportCorrection_(session, outTime, reason) {
  HHSheets.append('Corrections', {
    CorrectionID: newId_('C'), UnitID: session.UnitID, TargetStudentID: session.StudentID,
    SessionID: session.SessionID, ProposedIn: new Date(session.In), ProposedOut: outTime,
    Reason: reason || 'รายงานตัวเอง', ProposedBy: session.StudentID, ProposedAt: new Date(),
    Status: 'PENDING', Type: 'SELF_REPORT', WorkDate: String(session.WorkDate),
  });
}

function handleMeSelfReport_(payload, ctx) {
  var reason = String(payload.reason || '').trim().slice(0, 300);
  if (reason.length < 3) throw new HHErrors.AppError('REASON_REQUIRED', 'กรุณาบอกเหตุผลสั้นๆ ว่าทำไมไม่มีคนสแกนให้');
  var now = new Date();
  var cfg = HHConfig.get();
  return HHLock.withLock(function () {
    var row = HHRepo.findBy('Members', 'StudentID', ctx.actor.studentId);
    var m = row.data;
    var last = lastScanAt_(String(m.StudentID));
    if (last && now - last < cfg.DUPLICATE_SCAN_SECONDS * 1000) throw new HHErrors.AppError('DUPLICATE_SCAN');
    var wd = HHHours.workDate(now, cfg.WORKDAY_START_HOUR);
    var result = { time: HHHours.bangkokTime(now) };

    if (m.CurrentState !== 'IN' || !m.OpenSessionID) {
      if (HHScan.inClosedPeriod(unitRows_('Periods', m.UnitID), m.UnitID, wd)) throw new HHErrors.AppError('PERIOD_CLOSED');
      var sessionId = 'S' + wd.replace(/-/g, '') + '-' + HHIds.randomString(6, function () { return HHCrypto.randInt(36) / 36; });
      HHSheets.append('WorkSessions', {
        SessionID: sessionId, UnitID: m.UnitID, StudentID: m.StudentID, WorkDate: wd, In: now,
        ScannedInBy: m.StudentID, Status: 'OPEN', Locked: false,
        Note: HHCorrections.SELF_MARK + ' IN: ' + reason,
      });
      HHRepo.update('Members', row.row, { CurrentState: 'IN', OpenSessionID: sessionId });
      HHLog.append({ requestId: ctx.requestId, unitId: m.UnitID, studentId: m.StudentID, action: 'IN',
        actorId: m.StudentID, method: 'SELF', flags: ['SELF_REPORT'], reason: reason });
      result.action = 'IN';
    } else {
      var s = HHRepo.findBy('WorkSessions', 'SessionID', m.OpenSessionID);
      if (!s) throw new HHErrors.AppError('STATE_CHANGED');
      var raw = HHHours.rawMinutes(new Date(s.data.In), now);
      HHRepo.update('WorkSessions', s.row, {
        Out: now, RawMinutes: raw, CountedHours: 0, ScannedOutBy: m.StudentID, Status: 'NEEDS_REVIEW',
        Note: [s.data.Note, HHCorrections.SELF_MARK + ' OUT: ' + reason].filter(String).join(' | '),
      });
      HHRepo.update('Members', row.row, { CurrentState: 'OUT', OpenSessionID: '' });
      createSelfReportCorrection_(s.data, now, reason);
      HHLog.append({ requestId: ctx.requestId, unitId: m.UnitID, studentId: m.StudentID, action: 'OUT',
        actorId: m.StudentID, method: 'SELF', flags: ['SELF_REPORT'], reason: reason });
      result.action = 'OUT';
      result.rawMinutes = raw;
    }
    CacheService.getScriptCache().put(lastScanKey_(String(m.StudentID)), String(now.getTime()), LAST_SCAN_CACHE_SECONDS);
    HHSummarySheets.markDirty();
    return result;
  });
}

/**
 * payload: { studentId, workDate, in: "HH:mm", out: "HH:mm", reason, sessionId?, reportId? }
 */
function handleCorrectionPropose_(payload, ctx) {
  var cfg = HHConfig.get();
  var reason = String(payload.reason || '').trim().slice(0, 300);
  if (reason.length < 3) throw new HHErrors.AppError('REASON_REQUIRED');
  var sid = HHAuth.normalizeStudentId(payload.studentId);
  var wd = String(payload.workDate || '');
  var inT = HHCorrections.timeOn(wd, payload.in, cfg.WORKDAY_START_HOUR);
  var outT = HHCorrections.timeOn(wd, payload.out, cfg.WORKDAY_START_HOUR);
  // An out time earlier than the in time on the same side of midnight means the next day.
  if (inT && outT && outT <= inT) outT = new Date(outT.getTime() + 24 * 3600 * 1000);
  var tp = HHCorrections.timesProblem(inT, outT);
  if (tp) throw new HHErrors.AppError('VALIDATION', tp);

  return HHLock.withLock(function () {
    var target = HHRepo.findBy('Members', 'StudentID', sid);
    if (!target) throw new HHErrors.AppError('NOT_FOUND', 'ไม่พบรหัสนักศึกษานี้');
    var problem = HHCorrections.proposeProblem(ctx.actor, target.data, wd,
      unitRows_('ScannerAssignments', target.data.UnitID), unitRows_('Periods', target.data.UnitID));
    if (problem) throw new HHErrors.AppError('FORBIDDEN', problem);
    var day = HHSheets.readAll('WorkSessions').filter(function (s) {
      return String(s.StudentID) === sid && String(s.WorkDate) === wd;
    });
    var session = HHCorrections.pickSession(day, payload.sessionId);
    if (payload.sessionId && !session) throw new HHErrors.AppError('NOT_FOUND', 'ไม่พบรอบเข้างานที่เลือก');
    var mine = HHSheets.readAll('WorkSessions').filter(function (s) { return String(s.StudentID) === sid; });
    var clash = HHCorrections.overlapProblem(mine, session ? session.SessionID : '', inT, outT, new Date(), HHHours.bangkokTime);
    if (clash) throw new HHErrors.AppError('VALIDATION', clash);
    var reportId = '';
    if (payload.reportId) {
      var rep = HHRepo.findBy('Reports', 'ReportID', String(payload.reportId));
      if (rep && String(rep.data.StudentID) === sid && rep.data.Status === 'OPEN') {
        HHRepo.update('Reports', rep.row, { Status: 'CONVERTED', ResolvedBy: ctx.actor.studentId, ResolvedNote: 'ส่งขอแก้ไขชั่วโมงแล้ว' });
        reportId = String(rep.data.ReportID);
      }
    }
    var id = newId_('C');
    HHSheets.append('Corrections', {
      CorrectionID: id, UnitID: target.data.UnitID, TargetStudentID: sid,
      SessionID: session ? session.SessionID : '', ProposedIn: inT, ProposedOut: outT, Reason: reason,
      ProposedBy: ctx.actor.studentId, ProposedAt: new Date(), Status: 'PENDING',
      Type: 'CORRECTION', WorkDate: wd, ReportID: reportId,
    });
    return { correctionId: id, appliesTo: session ? 'แก้รอบเดิม (เข้า ' + HHHours.bangkokTime(new Date(session.In)) + ')' : 'เพิ่มรอบใหม่' };
  });
}

/** Pending corrections and recent decisions for the admin's unit, plus periods. */
function handleCorrectionList_(payload, ctx) {
  var unitId = String(ctx.actor.unitId);
  var members = unitRows_('Members', unitId);
  var nick = {}, team = {};
  members.forEach(function (m) { nick[String(m.StudentID)] = String(m.Nickname); team[String(m.StudentID)] = String(m.TeamID); });
  var teamName = {};
  unitRows_('Teams', unitId).forEach(function (t) { teamName[String(t.TeamID)] = String(t.Name); });
  var sessions = {};
  unitRows_('WorkSessions', unitId).forEach(function (s) { sessions[String(s.SessionID)] = s; });
  var fmt = function (d) { return d ? HHHours.bangkokTime(new Date(d)) : ''; };
  var all = unitRows_('Corrections', unitId).reverse().map(function (c) {
    var s = sessions[String(c.SessionID)];
    return {
      correctionId: String(c.CorrectionID), type: String(c.Type || 'CORRECTION'),
      studentId: String(c.TargetStudentID), nickname: nick[String(c.TargetStudentID)] || '',
      teamName: teamName[team[String(c.TargetStudentID)]] || '',
      workDate: String(c.WorkDate), proposedIn: fmt(c.ProposedIn), proposedOut: fmt(c.ProposedOut),
      current: s ? { in: fmt(s.In), out: fmt(s.Out), countedHours: Number(s.CountedHours) || 0, status: String(s.Status) } : null,
      reason: String(c.Reason), proposedBy: nick[String(c.ProposedBy)] || String(c.ProposedBy),
      status: String(c.Status), reviewedBy: nick[String(c.ReviewedBy)] || String(c.ReviewedBy || ''),
      reviewNote: String(c.ReviewNote || ''),
      canReview: c.Status === 'PENDING' && !HHCorrections.reviewProblem(ctx.actor, c, unitRows_('Periods', unitId)),
    };
  });
  return {
    pending: all.filter(function (c) { return c.status === 'PENDING'; }),
    recent: all.filter(function (c) { return c.status !== 'PENDING'; }).slice(0, 20),
    periods: unitRows_('Periods', unitId).reverse().map(function (p) {
      return { periodId: String(p.PeriodID), startDate: String(p.StartDate), endDate: String(p.EndDate),
        status: String(p.Status), closedBy: nick[String(p.ClosedBy)] || String(p.ClosedBy || ''),
        exportLink: String(p.ExportLink || ''), reopenReason: String(p.ReopenReason || '') };
    }),
  };
}

function reviewCorrection_(payload, ctx, approve) {
  var note = String(payload.note || '').trim().slice(0, 300);
  if (!approve && note.length < 3) throw new HHErrors.AppError('VALIDATION', 'กรุณาเขียนเหตุผลที่ปฏิเสธ');
  var cfg = HHConfig.get();
  var now = new Date();
  return HHLock.withLock(function () {
    var c = HHRepo.findBy('Corrections', 'CorrectionID', String(payload.correctionId || ''));
    if (!c) throw new HHErrors.AppError('NOT_FOUND');
    var problem = HHCorrections.reviewProblem(ctx.actor, c.data, unitRows_('Periods', c.data.UnitID));
    if (problem) throw new HHErrors.AppError('FORBIDDEN', problem);
    var d = c.data;
    var result = { correctionId: String(d.CorrectionID), status: approve ? 'APPROVED' : 'REJECTED' };
    // Apply first: it validates (e.g. overlaps) before writing. Sheets has no
    // rollback, so the request is marked APPROVED only after the hours are written.
    if (approve) result.countedHours = applyCorrection_(d, cfg);
    HHRepo.update('Corrections', c.row, {
      Status: approve ? 'APPROVED' : 'REJECTED', ReviewedBy: ctx.actor.studentId, ReviewedAt: now, ReviewNote: note,
    });
    HHLog.append({
      unitId: d.UnitID, studentId: d.TargetStudentID, action: approve ? 'CORRECTION' : 'REJECT', actorId: ctx.actor.studentId,
      method: 'ADMIN', flags: [String(d.Type || 'CORRECTION')], reason: String(d.Reason),
      note: 'correction ' + d.CorrectionID + ' proposed by ' + d.ProposedBy + (note ? ' — ' + note : ''),
    });
    HHSummarySheets.markDirty();
    return result;
  });
}

/** Apply an approved correction to WorkSessions. Caller holds the lock. @return counted hours */
function applyCorrection_(d, cfg) {
  var inT = new Date(d.ProposedIn), outT = new Date(d.ProposedOut);
  var sid = String(d.TargetStudentID);
  var existing = d.SessionID ? HHRepo.findBy('WorkSessions', 'SessionID', String(d.SessionID)) : null;
  var mine = HHSheets.readAll('WorkSessions').filter(function (s) { return String(s.StudentID) === sid; });
  var clash = HHCorrections.overlapProblem(mine, d.SessionID || '', inT, outT, new Date(), HHHours.bangkokTime);
  if (clash) throw new HHErrors.AppError('VALIDATION', clash);
  var already = countedOnDate_(sid, String(d.WorkDate), existing ? String(existing.data.SessionID) : null);
  var c = HHHours.countedHours(inT, outT, already, cfg);
  if (existing) {
    HHRepo.update('WorkSessions', existing.row, {
      In: inT, Out: outT, RawMinutes: c.rawMinutes, CountedHours: c.countedHours, Status: 'CORRECTED',
      Note: [existing.data.Note, HHCorrections.originalNote(existing.data, HHHours.bangkokTime)].filter(String).join(' | '),
    });
    var m = HHRepo.findBy('Members', 'StudentID', sid);
    if (m && String(m.data.OpenSessionID) === String(existing.data.SessionID)) {
      HHRepo.update('Members', m.row, { CurrentState: 'OUT', OpenSessionID: '' });
    }
  } else {
    HHSheets.append('WorkSessions', {
      SessionID: 'S' + String(d.WorkDate).replace(/-/g, '') + '-' + HHIds.randomString(6, function () { return HHCrypto.randInt(36) / 36; }),
      UnitID: d.UnitID, StudentID: sid, WorkDate: String(d.WorkDate), In: inT, Out: outT,
      RawMinutes: c.rawMinutes, CountedHours: c.countedHours, ScannedInBy: d.ProposedBy, ScannedOutBy: d.ProposedBy,
      Status: 'CORRECTED', Locked: false, Note: 'สร้างจากคำขอแก้ไข ' + d.CorrectionID,
    });
  }
  // The forgotten-checkout alert for that day is handled now.
  HHRepo.all('Alerts').forEach(function (a) {
    if (String(a.data.StudentID) === sid && a.data.Status === 'OPEN' && String(a.data.Detail).indexOf(String(d.WorkDate)) !== -1) {
      HHRepo.update('Alerts', a.row, { Status: 'RESOLVED' });
    }
  });
  return c.countedHours;
}

function handleCorrectionApprove_(payload, ctx) { return reviewCorrection_(payload, ctx, true); }
function handleCorrectionReject_(payload, ctx) { return reviewCorrection_(payload, ctx, false); }
