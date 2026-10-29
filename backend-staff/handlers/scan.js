/**
 * scan.lookup / scan.confirm (spec 5.7). Two light calls per person:
 * lookup decides (no writes except BLOCKED_SELF audit), confirm writes under lock.
 */

var LAST_SCAN_CACHE_SECONDS = 600;

function lastScanKey_(studentId) {
  return 'lastscan:' + studentId;
}

function lastScanAt_(studentId) {
  var v = CacheService.getScriptCache().get(lastScanKey_(studentId));
  return v ? new Date(Number(v)) : null;
}

function hmacSecret_() {
  var s = HHProps.get(HHProps.KEYS.HMAC_SECRET);
  if (!s) throw new HHErrors.AppError('NOT_CONFIGURED', null, 'HMAC_SECRET missing');
  return s;
}

/** Resolve the scanned member from a barcode payload or a manually typed student id. */
function findScannedMember_(payload) {
  if (payload.code) {
    var parsed = HHBarcode.parse(payload.code);
    if (!parsed) throw new HHErrors.AppError('INVALID_CARD', null, 'unparseable');
    var m = HHRepo.findBy('Members', 'StudentID', parsed.studentId);
    if (!m || !HHBarcode.verify(payload.code, String(m.data.StudentID), Number(m.data.CodeVersion) || 1, hmacSecret_(), HHCrypto.hmacBytes)) {
      throw new HHErrors.AppError('INVALID_CARD', null, 'check mismatch or old CodeVersion');
    }
    return { member: m, method: 'BARCODE' };
  }
  var sid = HHAuth.normalizeStudentId(payload.studentId);
  var found = HHAuth.isValidStudentId(sid) ? HHRepo.findBy('Members', 'StudentID', sid) : null;
  if (!found) throw new HHErrors.AppError('NOT_FOUND', 'ไม่พบรหัสนักศึกษานี้');
  return { member: found, method: 'MANUAL' };
}

/** Hours already counted for this member on a work date (completed sessions). */
function countedOnDate_(studentId, workDate, excludeSessionId) {
  return HHSheets.readAll('WorkSessions').reduce(function (sum, s) {
    if (String(s.StudentID) !== String(studentId) || String(s.WorkDate) !== workDate) return sum;
    if (excludeSessionId && String(s.SessionID) === excludeSessionId) return sum;
    if (s.Status !== 'COMPLETE' && s.Status !== 'CORRECTED') return sum;
    return sum + (Number(s.CountedHours) || 0);
  }, 0);
}

function decideFor_(actor, memberRow, method, now) {
  var m = memberRow.data;
  var cfg = HHConfig.get();
  var open = null;
  if (m.CurrentState === 'IN' && m.OpenSessionID) {
    var s = HHRepo.findBy('WorkSessions', 'SessionID', m.OpenSessionID);
    if (s) open = s;
  }
  var wd = open ? String(open.data.WorkDate) : null;
  var unitRows = function (sheet) {
    return HHSheets.readAll(sheet).filter(function (r) { return String(r.UnitID) === String(m.UnitID); });
  };
  var decision = HHScan.decide({
    actor: actor,
    member: m,
    now: now,
    cfg: cfg,
    assignments: unitRows('ScannerAssignments'),
    periods: unitRows('Periods'),
    schedules: unitRows('Schedules'),
    lastScanAt: lastScanAt_(String(m.StudentID)),
    openSessionIn: open ? new Date(open.data.In) : null,
    countedToday: open ? countedOnDate_(m.StudentID, wd, String(open.data.SessionID)) : 0,
    method: method,
  });
  return { decision: decision, open: open, cfg: cfg };
}

function memberSummary_(m) {
  var org = HHOrg.names(m);
  return {
    studentId: String(m.StudentID),
    nickname: String(m.Nickname),
    fullName: String(m.FirstName) + ' ' + String(m.LastName),
    deptName: org.dept,
    deptColor: org.color,
    teamName: org.team,
    shift: String(m.Shift || ''),
    state: String(m.CurrentState || 'OUT'),
  };
}

function handleScanLookup_(payload, ctx) {
  var now = new Date();
  var found = findScannedMember_(payload);
  var m = found.member.data;
  var d = decideFor_(ctx.actor, found.member, found.method, now);
  var decision = d.decision;

  if (decision.blocked === 'SELF_SCAN') {
    HHLog.append({
      requestId: ctx.requestId, unitId: m.UnitID, studentId: m.StudentID, action: 'BLOCKED_SELF',
      actorId: ctx.actor.studentId, method: found.method,
    });
  }
  if (decision.blocked) throw new HHErrors.AppError(decision.blocked);

  var result = {
    member: memberSummary_(m),
    action: decision.action,
    requiresReason: decision.requiresReason,
    warnings: decision.warnings,
    previewHours: decision.previewHours,
    since: d.open ? HHHours.bangkokTime(new Date(d.open.data.In)) : null,
  };
  result.lookupToken = HHScan.signLookup({
    target: String(m.StudentID),
    scanner: ctx.actor.studentId,
    action: decision.action,
    flags: decision.flags,
    method: found.method,
    requiresReason: decision.requiresReason,
  }, now, hmacSecret_(), HHCrypto.hmacBytes);
  return result;
}

function handleScanConfirm_(payload, ctx) {
  var now = new Date();
  var t = HHScan.verifyLookup(payload.lookupToken, now, hmacSecret_(), HHCrypto.hmacBytes);
  if (!t || t.scanner !== ctx.actor.studentId) throw new HHErrors.AppError('LOOKUP_EXPIRED');
  var reason = String(payload.reason || '').trim().slice(0, 300);
  if (t.requiresReason && !reason) throw new HHErrors.AppError('REASON_REQUIRED');

  return HHLock.withLock(function () {
    var row = HHRepo.findBy('Members', 'StudentID', t.target);
    if (!row) throw new HHErrors.AppError('NOT_FOUND');
    // Re-decide under the lock: state may have changed since lookup.
    var d = decideFor_(ctx.actor, row, t.method, now);
    if (d.decision.blocked) throw new HHErrors.AppError(d.decision.blocked);
    if (d.decision.action !== t.action) throw new HHErrors.AppError('STATE_CHANGED');

    var m = row.data;
    var flags = d.decision.flags;
    var result = { action: t.action, nickname: String(m.Nickname), time: HHHours.bangkokTime(now) };

    if (t.action === 'IN') {
      var wd = d.decision.workDate;
      var sessionId = 'S' + wd.replace(/-/g, '') + '-' + HHIds.randomString(6, function () { return HHCrypto.randInt(36) / 36; });
      HHSheets.append('WorkSessions', {
        SessionID: sessionId, UnitID: m.UnitID, StudentID: m.StudentID, WorkDate: wd, In: now,
        ScannedInBy: ctx.actor.studentId, Status: 'OPEN', Locked: false,
        Note: reason ? 'IN: ' + reason : '',
      });
      HHRepo.update('Members', row.row, { CurrentState: 'IN', OpenSessionID: sessionId });
    } else {
      var open = d.open;
      if (!open) {
        // Member marked IN without a session row: reset state, nothing to count.
        HHRepo.update('Members', row.row, { CurrentState: 'OUT', OpenSessionID: '' });
        throw new HHErrors.AppError('STATE_CHANGED', null, 'open session missing');
      }
      var inTime = new Date(open.data.In);
      var already = countedOnDate_(m.StudentID, String(open.data.WorkDate), String(open.data.SessionID));
      var c = HHHours.countedHours(inTime, now, already, d.cfg);
      HHRepo.update('WorkSessions', open.row, {
        Out: now, RawMinutes: c.rawMinutes, CountedHours: c.countedHours, ScannedOutBy: ctx.actor.studentId,
        Status: 'COMPLETE', Note: [open.data.Note, reason ? 'OUT: ' + reason : ''].filter(String).join(' | '),
      });
      HHRepo.update('Members', row.row, { CurrentState: 'OUT', OpenSessionID: '' });
      result.countedHours = c.countedHours;
      result.rawMinutes = c.rawMinutes;
      result.since = HHHours.bangkokTime(inTime);
    }

    HHLog.append({
      requestId: ctx.requestId, unitId: m.UnitID, studentId: m.StudentID, action: t.action,
      actorId: ctx.actor.studentId, method: t.method, flags: flags, reason: reason,
    });
    CacheService.getScriptCache().put(lastScanKey_(String(m.StudentID)), String(now.getTime()), LAST_SCAN_CACHE_SECONDS);
    HHSummarySheets.markDirty();
    return result;
  });
}
