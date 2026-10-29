/**
 * auth.* handlers (spec 5.3). Identity for protected actions comes only from ctx.actor.
 */

function handleAuthActivate_(payload, ctx) {
  var sid = HHAuth.normalizeStudentId(payload.studentId);
  if (!HHAuth.isValidStudentId(sid)) throw new HHErrors.AppError('ACTIVATION_FAILED');
  HHRateLimit.assertNotLocked('activate', sid);
  var cfg = HHConfig.get();
  var pwProblem = HHAuth.passwordProblem(payload.password, cfg.PASSWORD_MIN_LENGTH);
  if (pwProblem) throw new HHErrors.AppError('VALIDATION', pwProblem);

  var member = HHLock.withLock(function () {
    var m = HHRepo.findBy('Members', 'StudentID', sid);
    var expected = m ? String(m.data.ActivationCodeHash) : '';
    var given = HHAuth.hashActivationCode(payload.code, HHAccounts.pepper(), HHCrypto.sha256Hex);
    if (!m || !expected || m.data.Status !== 'ACTIVE' || !HHAuth.safeEqual(expected, given)) {
      HHRateLimit.recordFailure('activate', sid);
      HHLog.append({ requestId: ctx.requestId, studentId: sid, action: 'LOGIN_FAIL', method: 'SYSTEM', note: 'activate' });
      throw new HHErrors.AppError('ACTIVATION_FAILED');
    }
    var salt = HHAuth.newSalt(HHCrypto.randInt);
    var hash = HHAuth.hashPassword(payload.password, salt, HHAccounts.pepper(), cfg.PASSWORD_HASH_ROUNDS, HHCrypto.sha256Hex);
    HHRepo.update('Members', m.row, {
      PasswordHash: hash, Salt: salt, ActivationCodeHash: '', ActivatedAt: new Date(),
    });
    HHLog.append({ requestId: ctx.requestId, unitId: m.data.UnitID, studentId: sid, action: 'ACTIVATE', actorId: sid, method: 'SYSTEM' });
    return m.data;
  });
  HHRateLimit.reset('activate', sid);
  return { token: HHSessions.create(member, payload.userAgent), profile: profileOf_(member) };
}

function handleAuthLogin_(payload, ctx) {
  var sid = HHAuth.normalizeStudentId(payload.studentId);
  if (!HHAuth.isValidStudentId(sid)) throw new HHErrors.AppError('LOGIN_FAILED');
  HHRateLimit.assertNotLocked('login', sid);
  var cfg = HHConfig.get();
  var m = HHRepo.findBy('Members', 'StudentID', sid);
  var ok = false;
  if (m && m.data.Status === 'ACTIVE' && m.data.PasswordHash) {
    var hash = HHAuth.hashPassword(String(payload.password || ''), String(m.data.Salt), HHAccounts.pepper(),
      cfg.PASSWORD_HASH_ROUNDS, HHCrypto.sha256Hex);
    ok = HHAuth.safeEqual(hash, String(m.data.PasswordHash));
  }
  if (!ok) {
    var n = HHRateLimit.recordFailure('login', sid);
    HHLog.append({ requestId: ctx.requestId, unitId: m ? m.data.UnitID : '', studentId: sid, action: 'LOGIN_FAIL', method: 'SYSTEM', note: 'failures=' + n });
    throw new HHErrors.AppError('LOGIN_FAILED');
  }
  HHRateLimit.reset('login', sid);
  return { token: HHSessions.create(m.data, payload.userAgent), profile: profileOf_(m.data) };
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
