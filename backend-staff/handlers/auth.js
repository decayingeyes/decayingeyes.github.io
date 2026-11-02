/**
 * auth.* handlers (spec 5.3). Identity for protected actions comes only from ctx.actor.
 */

function handleAuthActivate_(payload, ctx) {
  var sid = HHAuth.normalizeStudentId(payload.studentId);
  if (!HHAuth.isValidStudentId(sid)) throw new HHErrors.AppError('ACTIVATION_FAILED');
  var opts = deviceOpts_(payload, sid);
  HHRateLimit.assertNotLocked('activate', sid, opts);
  var cfg = HHConfig.get();
  var pwProblem = HHAuth.passwordProblem(payload.password, cfg.PASSWORD_MIN_LENGTH);
  if (pwProblem) throw new HHErrors.AppError('VALIDATION', pwProblem);

  var member = HHLock.withLock(function () {
    var m = HHRepo.findBy('Members', 'StudentID', sid);
    // The shared join code typed on the activation page (easy mix-up: both are
    // 6 characters): send them to sign-up instead of failing.
    if (!m && HHAuth.joinCodeResult(payload.code, cfg.SIGNUP_JOIN_CODE) === 'match') {
      throw new HHErrors.AppError('USE_SIGNUP');
    }
    var expected = m ? String(m.data.ActivationCodeHash) : '';
    var given = HHAuth.hashActivationCode(payload.code, HHAccounts.pepper(), HHCrypto.sha256Hex);
    if (!m || !expected || m.data.Status !== 'ACTIVE' || !HHAuth.safeEqual(expected, given)) {
      HHRateLimit.recordFailure('activate', sid, opts);
      HHLog.append({ requestId: ctx.requestId, studentId: sid, action: 'LOGIN_FAIL', method: 'SYSTEM', note: 'activate' });
      throw new HHErrors.AppError('ACTIVATION_FAILED');
    }
    var salt = HHAuth.newSalt(HHCrypto.randInt);
    var hash = HHAuth.hashPassword(payload.password, salt, HHAccounts.pepper(), cfg.PASSWORD_HASH_ROUNDS, HHCrypto.sha256Hex);
    HHRepo.update('Members', m.row, {
      PasswordHash: hash, Salt: salt, ActivationCodeHash: '', ActivatedAt: new Date(),
    });
    // A new password ends every older login, so a stolen one stops working.
    HHSessions.revokeAllFor(sid);
    HHLog.append({ requestId: ctx.requestId, unitId: m.data.UnitID, studentId: sid, action: 'ACTIVATE', actorId: sid, method: 'SYSTEM' });
    return m.data;
  });
  HHRateLimit.reset('activate', sid, opts);
  return completeLogin_(member, payload);
}

function handleAuthLogin_(payload, ctx) {
  var sid = HHAuth.normalizeStudentId(payload.studentId);
  if (!HHAuth.isValidStudentId(sid)) throw new HHErrors.AppError('LOGIN_FAILED');
  var opts = deviceOpts_(payload, sid);
  HHRateLimit.assertNotLocked('login', sid, opts);
  var cfg = HHConfig.get();
  var m = HHRepo.findBy('Members', 'StudentID', sid);
  var ok = false;
  var usable = m && (m.data.Status === 'ACTIVE' || m.data.Status === 'PENDING') && m.data.PasswordHash;
  if (usable) {
    var hash = HHAuth.hashPassword(String(payload.password || ''), String(m.data.Salt), HHAccounts.pepper(),
      cfg.PASSWORD_HASH_ROUNDS, HHCrypto.sha256Hex);
    ok = HHAuth.safeEqual(hash, String(m.data.PasswordHash));
  }
  // Correct password but the self sign-up is not approved yet: say so (only after the password matched).
  if (ok && m.data.Status === 'PENDING') throw new HHErrors.AppError('PENDING_APPROVAL');
  if (!ok) {
    var n = HHRateLimit.recordFailure('login', sid, opts);
    HHLog.append({ requestId: ctx.requestId, unitId: m ? m.data.UnitID : '', studentId: sid, action: 'LOGIN_FAIL', method: 'SYSTEM', note: 'failures=' + n });
    throw new HHErrors.AppError('LOGIN_FAILED');
  }
  HHRateLimit.reset('login', sid, opts);
  return completeLogin_(m.data, payload);
}

function handleAuthLogout_(payload, ctx) {
  HHSessions.revoke(ctx.token);
  return { loggedOut: true };
}

function handleAuthMe_(payload, ctx) {
  var m = HHRepo.findBy('Members', 'StudentID', ctx.actor.studentId);
  return { profile: profileOf_(m.data) };
}

/** Public profile of the caller. Never includes hashes, salts or codes. */
function profileOf_(m) {
  var org = HHOrg.names(m);
  return {
    studentId: String(m.StudentID),
    firstName: String(m.FirstName),
    lastName: String(m.LastName),
    nickname: String(m.Nickname),
    role: String(m.Role),
    unitName: org.unit,
    deptName: org.dept,
    deptColor: org.color,
    teamName: org.team,
    shift: String(m.Shift || ''),
  };
}

var MAX_PENDING_SIGNUPS = 500; // keeps a flood of fake sign-ups from filling the sheet

/**
 * Self sign-up. Someone on the roster with the shared join code and a matching
 * name claims their row and is in at once. Everyone else becomes a PENDING
 * member (member role, "no team yet"), usable only after a unit admin approves
 * (signup.review). See HHAuth.signupAgainst.
 */
function handleAuthSignup_(payload, ctx) {
  var cfg = HHConfig.get();
  var f = {
    studentId: HHAuth.normalizeStudentId(payload.studentId),
    firstName: String(payload.firstName || '').trim(),
    lastName: String(payload.lastName || '').trim(),
    nickname: String(payload.nickname || '').trim(),
    password: payload.password,
  };
  var problem = HHAuth.signupProblem(f, cfg.PASSWORD_MIN_LENGTH);
  if (problem) throw new HHErrors.AppError('VALIDATION', problem);
  HHRateLimit.assertNotLocked('signup', f.studentId);
  // Shared join code: wrong -> refused (rate-limited per student id, so a few
  // typos never lock out the whole crew); correct or empty -> see signupAgainst below.
  var join = HHAuth.joinCodeResult(payload.joinCode, cfg.SIGNUP_JOIN_CODE);
  if (join === 'wrong') {
    HHRateLimit.assertNotLocked('joincode', f.studentId);
    HHRateLimit.recordFailure('joincode', f.studentId);
    throw new HHErrors.AppError('VALIDATION', 'รหัสเข้าร่วมงานไม่ถูกต้อง (ไม่มีรหัสก็เว้นว่างไว้ แล้วรอแอดมินอนุมัติ)');
  }

  return HHLock.withLock(function () {
    var units = HHSheets.readAll('Units');
    if (units.length === 0) throw new HHErrors.AppError('NOT_CONFIGURED', 'ระบบยังไม่เปิดรับสมัคร');
    var unit = units[0];
    var members = HHSheets.readAll('Members');
    if (members.filter(function (m) { return m.Status === 'PENDING'; }).length >= MAX_PENDING_SIGNUPS) {
      throw new HHErrors.AppError('BUSY', 'มีผู้สมัครรออนุมัติจำนวนมาก กรุณาติดต่อหัวหน้าทีม');
    }
    var existingRow = HHRepo.findBy('Members', 'StudentID', f.studentId);
    var verdict = HHAuth.signupAgainst(existingRow ? existingRow.data : null, f, join);
    if (!verdict.ok) {
      HHRateLimit.recordFailure('signup', f.studentId);
      throw new HHErrors.AppError('VALIDATION', verdict.messageTh);
    }

    if (verdict.mode === 'claim') {
      var claimSalt = HHAuth.newSalt(HHCrypto.randInt);
      HHRepo.update('Members', existingRow.row, {
        PasswordHash: HHAuth.hashPassword(f.password, claimSalt, HHAccounts.pepper(), cfg.PASSWORD_HASH_ROUNDS, HHCrypto.sha256Hex),
        Salt: claimSalt, ActivationCodeHash: '', ActivatedAt: new Date(),
      });
      HHLog.append({ requestId: ctx.requestId, unitId: existingRow.data.UnitID, studentId: f.studentId, action: 'SIGNUP',
        actorId: f.studentId, method: 'SELF', flags: ['JOIN_CODE', 'ROSTER_MATCH'], note: String(existingRow.data.Nickname) });
      var claimed = HHRepo.findBy('Members', 'StudentID', f.studentId).data;
      return Object.assign({ studentId: f.studentId, status: 'ACTIVE' }, loginResult_(claimed, payload));
    }

    // Reuse the roster planner for the "no department / no team yet" placeholders.
    var plan = HHRoster.plan([{
      StudentID: f.studentId, FirstName: f.firstName, LastName: f.lastName, Nickname: f.nickname,
      Unit: String(unit.Name), Department: '', Team: '', Shift: '', Role: 'member',
    }], {
      units: units, departments: HHSheets.readAll('Departments'), teams: HHSheets.readAll('Teams'),
      members: verdict.mode === 'overwrite' ? [] : members,
    }, { unitId: String(unit.UnitID), rolesFromCsv: false });
    HHRepo.appendMany('Departments', plan.newDepartments);
    HHRepo.appendMany('Teams', plan.newTeams);
    var fields = plan.inserts[0];
    var salt = HHAuth.newSalt(HHCrypto.randInt);
    var account = {
      PasswordHash: HHAuth.hashPassword(f.password, salt, HHAccounts.pepper(), cfg.PASSWORD_HASH_ROUNDS, HHCrypto.sha256Hex),
      Salt: salt, ActivationCodeHash: '', ActivatedAt: new Date(), CodeVersion: 1,
      Status: 'PENDING', CurrentState: 'OUT', OpenSessionID: '',
    };
    if (verdict.mode === 'overwrite') {
      var upd = Object.assign({}, fields, account);
      delete upd.StudentID;
      HHRepo.update('Members', existingRow.row, upd);
    } else {
      HHRepo.appendMany('Members', [Object.assign({}, fields, account)]);
    }
    HHOrg.clearCache();
    HHLog.append({ requestId: ctx.requestId, unitId: unit.UnitID, studentId: f.studentId, action: 'SIGNUP',
      actorId: f.studentId, method: 'SELF', flags: join === 'match' ? ['JOIN_CODE'] : [], note: f.nickname });
    return { studentId: f.studentId, status: 'PENDING' };
  });
}
