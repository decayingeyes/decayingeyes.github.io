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
  var cfg = HHConfig.get();
  if (!HHAuth.requiresTwoFactor(String(member.Role), cfg)) return loginResult_(member, payload);
  var sid = String(member.StudentID);
  var row = HHRepo.findBy('TwoFactor', 'StudentID', sid);
  var challenge = HHCrypto.newToken();
  var clientId = String(cfg.GOOGLE_CLIENT_ID || '').trim();
  if (clientId) {
    // Google is the main way in; someone who already set up the app may still use it.
    var linkedEmail = row ? String(row.data.GoogleEmail || '') : '';
    CacheService.getScriptCache().put(challengeKey_(challenge), JSON.stringify({ sid: sid, stage: 'google' }), CHALLENGE_SECONDS);
    return { twoFactor: {
      stage: 'google', challenge: challenge, clientId: clientId, nonce: googleNonce_(challenge),
      linked: !!linkedEmail, linkedEmail: HHGoogle.maskEmail(linkedEmail), hasApp: !!(row && row.data.SecretSealed),
    } };
  }
  var state = { sid: sid, stage: row && row.data.SecretSealed ? 'verify' : 'enroll' };
  var reply = { stage: state.stage, challenge: challenge };
  if (state.stage === 'enroll') {
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
    // 'google' stage: someone who set up the app earlier may type its code instead.
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

/** Not the challenge itself: the nonce ends up inside a token the browser can read. */
function googleNonce_(challenge) {
  return HHCrypto.sha256Hex('google-nonce:' + String(challenge));
}

/** Second step with Google: the first successful sign-in links that account; later ones must match it. */
function handleAuthGoogle_(payload, ctx) {
  var cache = CacheService.getScriptCache();
  var key = challengeKey_(payload.challenge);
  var raw = cache.get(key);
  if (!raw) throw new HHErrors.AppError('TWO_FACTOR_EXPIRED');
  var state = JSON.parse(raw);
  if (state.stage !== 'google') throw new HHErrors.AppError('TWO_FACTOR_EXPIRED');
  var sid = state.sid;
  var opts = deviceOpts_(payload, sid);
  HHRateLimit.assertNotLocked('2fa', sid, opts);

  function fail(code, note) {
    HHRateLimit.recordFailure('2fa', sid, opts);
    HHLog.append({ requestId: ctx.requestId, studentId: sid, action: 'LOGIN_FAIL', method: 'SYSTEM', note: 'google:' + note });
    throw new HHErrors.AppError(code);
  }

  var check = HHGoogle.checkClaims(HHGoogleAuth.tokenInfo(payload.credential), {
    clientId: String(HHConfig.get().GOOGLE_CLIENT_ID || '').trim(),
    nonce: googleNonce_(payload.challenge),
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!check.ok) fail('GOOGLE_FAILED', check.reason);

  var result = HHLock.withLock(function () {
    var m = HHRepo.findBy('Members', 'StudentID', sid);
    if (!m || m.data.Status !== 'ACTIVE') throw new HHErrors.AppError('TWO_FACTOR_EXPIRED');
    var row = HHRepo.findBy('TwoFactor', 'StudentID', sid);
    if (row && row.data.GoogleSub) {
      return String(row.data.GoogleSub) === check.sub ? { linked: false } : { problem: 'GOOGLE_MISMATCH' };
    }
    // The app already protects this account: linking Google with only the password would bypass it.
    if (row && row.data.SecretSealed) return { problem: 'GOOGLE_USE_APP' };
    var other = HHRepo.findBy('TwoFactor', 'GoogleSub', check.sub);
    if (other && String(other.data.StudentID) !== sid) return { problem: 'GOOGLE_TAKEN' };
    if (row) {
      HHRepo.update('TwoFactor', row.row, { GoogleSub: check.sub, GoogleEmail: check.email });
    } else {
      HHRepo.appendMany('TwoFactor', [{ StudentID: sid, EnabledAt: new Date(), LastCounter: 0, GoogleSub: check.sub, GoogleEmail: check.email }]);
      // Logins made before this moment did not pass the second step.
      HHSessions.invalidateMember(sid);
    }
    HHLog.append({ requestId: ctx.requestId, unitId: m.data.UnitID, studentId: sid, action: '2FA_GOOGLE_LINK', actorId: sid, method: 'SELF', note: HHGoogle.maskEmail(check.email) });
    return { linked: true, member: m.data };
  });
  if (result.problem) fail(result.problem, result.problem);

  cache.remove(key);
  HHRateLimit.reset('2fa', sid, opts);
  var m2 = result.member || HHRepo.findBy('Members', 'StudentID', sid).data;
  var out = loginResult_(m2, payload);
  if (result.linked) out.linkedEmail = HHGoogle.maskEmail(check.email);
  return out;
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
  var existing = HHRepo.findBy('TwoFactor', 'StudentID', sid);
  if (existing && existing.data.SecretSealed) return null;
  if (existing) HHRepo.update('TwoFactor', existing.row, fields);
  else HHRepo.appendMany('TwoFactor', [fields]);
  HHSessions.invalidateMember(sid);
  HHLog.append({ requestId: ctx.requestId, unitId: m.data.UnitID, studentId: sid, action: '2FA_ENROLL', actorId: sid, method: 'SELF' });
  return { recoveryCodes: codes };
}

function verifyTwoFactor_(payload, ctx, m) {
  var sid = String(m.data.StudentID);
  var row = HHRepo.findBy('TwoFactor', 'StudentID', sid);
  if (!row || !row.data.SecretSealed) return null;
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
