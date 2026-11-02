/**
 * Second login step for admins (owner decision 2026-11-03): after the password,
 * auth.login hands back a short-lived challenge instead of a login token, and
 * auth.twoFactor exchanges it for a token once the app's code is correct.
 */

var CHALLENGE_SECONDS = 600;
var TWO_FACTOR_ISSUER = 'Decaying Eyes';

function challengeKey_(challenge) {
  return 'mfa:' + HHCrypto.sha256Hex(String(challenge));
}

/** Browser identity for lockouts: a random id, plus proof this person logged in from it before. */
function deviceOpts_(payload, sid) {
  var device = HHAuth.normalizeDeviceId(payload.deviceId);
  var trusted = device !== 'unknown' && HHAuth.safeEqual(String(payload.deviceTrust || ''), deviceTrust_(sid, device));
  return { device: device, trusted: trusted };
}

function deviceTrust_(sid, device) {
  return HHCrypto.hmacHex(HHProps.get(HHProps.KEYS.HMAC_SECRET), 'device:' + sid + ':' + device);
}

function loginResult_(member, payload) {
  var sid = String(member.StudentID);
  var device = HHAuth.normalizeDeviceId(payload.deviceId);
  var out = { token: HHSessions.create(member, payload.userAgent), profile: profileOf_(member) };
  if (device !== 'unknown') out.deviceTrust = deviceTrust_(sid, device);
  return out;
}

/** Finish a correct password: log in, or ask for the second step when the role needs it. */
function completeLogin_(member, payload) {
  if (!HHAuth.requiresTwoFactor(String(member.Role), HHConfig.get())) return loginResult_(member, payload);
  var sid = String(member.StudentID);
  var row = HHRepo.findBy('TwoFactor', 'StudentID', sid);
  var challenge = HHCrypto.newToken();
  var state = { sid: sid, stage: row ? 'verify' : 'enroll' };
  var reply = { stage: state.stage, challenge: challenge };
  if (!row) {
    state.secret = HHTotp.newSecret(HHCrypto.randInt);
    reply.secret = state.secret;
    reply.otpauth = HHTotp.otpauthUri(state.secret, sid, TWO_FACTOR_ISSUER);
  }
  CacheService.getScriptCache().put(challengeKey_(challenge), JSON.stringify(state), CHALLENGE_SECONDS);
  return { twoFactor: reply };
}

function handleAuthTwoFactor_(payload, ctx) {
  var cache = CacheService.getScriptCache();
  var key = challengeKey_(payload.challenge);
  var raw = cache.get(key);
  if (!raw) throw new HHErrors.AppError('TWO_FACTOR_EXPIRED');
  var state = JSON.parse(raw);
  var sid = state.sid;
  var opts = deviceOpts_(payload, sid);
  HHRateLimit.assertNotLocked('2fa', sid, opts);

  var result = HHLock.withLock(function () {
    var m = HHRepo.findBy('Members', 'StudentID', sid);
    if (!m || m.data.Status !== 'ACTIVE') throw new HHErrors.AppError('TWO_FACTOR_EXPIRED');
    var outcome = state.stage === 'enroll' ? enrollTwoFactor_(state, payload, ctx, m) : verifyTwoFactor_(payload, ctx, m);
    if (!outcome) return null;
    // Created only now, after EnabledAt is written, so this login counts as passing the second step.
    return Object.assign(loginResult_(m.data, payload), outcome);
  });

  if (!result) {
    HHRateLimit.recordFailure('2fa', sid, opts);
    HHLog.append({ requestId: ctx.requestId, studentId: sid, action: 'LOGIN_FAIL', method: 'SYSTEM', note: '2fa' });
    throw new HHErrors.AppError('TWO_FACTOR_FAILED');
  }
  cache.remove(key);
  HHRateLimit.reset('2fa', sid, opts);
  return result;
}

function enrollTwoFactor_(state, payload, ctx, m) {
  var check = HHTotp.verify(state.secret, payload.code, Date.now(), 0, HHCrypto.hmacSha1);
  if (!check.ok) return null;
  var sid = String(m.data.StudentID);
  var pepper = HHAccounts.pepper();
  var codes = HHTotp.newRecoveryCodes(HHCrypto.randInt);
  var fields = {
    StudentID: sid,
    SecretSealed: HHTotp.seal(state.secret, pepper, HHCrypto.sha256Hex),
    EnabledAt: new Date(),
    LastCounter: check.counter,
    RecoveryHashes: codes.map(function (c) { return HHTotp.hashRecoveryCode(c, pepper, HHCrypto.sha256Hex); }).join(','),
  };
  // Two tabs can both hold an enrolment challenge: the first one to finish wins.
  if (HHRepo.findBy('TwoFactor', 'StudentID', sid)) return null;
  HHRepo.appendMany('TwoFactor', [fields]);
  HHSessions.invalidateMember(sid);
  HHLog.append({ requestId: ctx.requestId, unitId: m.data.UnitID, studentId: sid, action: '2FA_ENROLL', actorId: sid, method: 'SELF' });
  return { recoveryCodes: codes };
}

function verifyTwoFactor_(payload, ctx, m) {
  var sid = String(m.data.StudentID);
  var row = HHRepo.findBy('TwoFactor', 'StudentID', sid);
  if (!row) return null;
  var pepper = HHAccounts.pepper();
  if (payload.recoveryCode) {
    var hash = HHTotp.hashRecoveryCode(payload.recoveryCode, pepper, HHCrypto.sha256Hex);
    var hashes = String(row.data.RecoveryHashes || '').split(',').filter(String);
    var matched = hashes.filter(function (h) { return HHAuth.safeEqual(h, hash); });
    if (matched.length === 0) return null;
    var left = hashes.filter(function (h) { return h !== hash; });
    HHRepo.update('TwoFactor', row.row, { RecoveryHashes: left.join(',') });
    HHLog.append({ requestId: ctx.requestId, unitId: m.data.UnitID, studentId: sid, action: '2FA_RECOVERY', actorId: sid, method: 'SELF', note: 'left=' + left.length });
    return { recoveryCodesLeft: left.length };
  }
  var secret = HHTotp.unseal(row.data.SecretSealed, pepper, HHCrypto.sha256Hex);
  var check = HHTotp.verify(secret, payload.code, Date.now(), row.data.LastCounter, HHCrypto.hmacSha1);
  if (!check.ok) return null;
  HHRepo.update('TwoFactor', row.row, { LastCounter: check.counter });
  return {};
}

/**
 * Lost phone and no recovery codes: the owner clears the second step from the
 * spreadsheet menu. The person sets it up again at their next login.
 * @return {{studentId, nickname, ended}}
 */
function resetTwoFactor_(studentId, requestId) {
  var sid = HHAuth.normalizeStudentId(studentId);
  return HHLock.withLock(function () {
    var m = HHRepo.findBy('Members', 'StudentID', sid);
    if (!m) throw new HHErrors.AppError('NOT_FOUND', 'ไม่พบรหัสนักศึกษานี้');
    var row = HHRepo.findBy('TwoFactor', 'StudentID', sid);
    if (row) HHSheets.sheet('TwoFactor').deleteRow(row.row);
    var ended = HHSessions.revokeAllFor(sid);
    HHLog.append({ requestId: requestId, unitId: m.data.UnitID, studentId: sid, action: '2FA_RESET', actorId: 'OWNER', method: 'ADMIN' });
    return { studentId: sid, nickname: String(m.data.Nickname), ended: ended };
  });
}
