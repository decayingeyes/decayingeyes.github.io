/**
 * Account rules: activation codes, password hashing, session lifetime, login rate limit.
 * Pure JS. Crypto primitives and randomness are injected:
 *   sha256Hex(string) -> lowercase hex string
 *   randInt(n)        -> integer in [0, n), cryptographically random in production
 */
var HHAuth = (function () {
  // No 0/O/1/I/L so codes can be read aloud and typed without confusion.
  var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var CODE_LENGTH = 6;
  var STUDENT_ID_PATTERN = /^[0-9A-Za-z]{4,20}$/;
  var SCANNER_ROLES = { deputy: true, head: true, unit_admin: true, super_admin: true };

  /** Canonical student id: trimmed, uppercase (barcode payloads are uppercase). */
  function normalizeStudentId(raw) {
    return String(raw === undefined || raw === null ? '' : raw).trim().toUpperCase();
  }

  function isValidStudentId(id) {
    return STUDENT_ID_PATTERN.test(normalizeStudentId(id));
  }

  function newActivationCode(randInt) {
    var out = '';
    for (var i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET.charAt(randInt(CODE_ALPHABET.length));
    return out;
  }

  /** Users may type lowercase or add spaces/dashes; compare on the canonical form. */
  function normalizeActivationCode(raw) {
    return String(raw || '').toUpperCase().replace(/[\s-]/g, '');
  }

  function hashActivationCode(code, pepper, sha256Hex) {
    return sha256Hex('act:' + pepper + ':' + normalizeActivationCode(code));
  }

  function newSalt(randInt) {
    var hex = '0123456789abcdef';
    var out = '';
    for (var i = 0; i < 32; i++) out += hex.charAt(randInt(16));
    return out;
  }

  /** Iterated SHA-256 with per-user salt and server pepper (spec 5.3). */
  function hashPassword(password, salt, pepper, rounds, sha256Hex) {
    if (!(rounds >= 1000)) rounds = 1000;
    var h = sha256Hex(salt + ':' + pepper + ':' + password);
    for (var i = 1; i < rounds; i++) h = sha256Hex(h + ':' + salt);
    return h;
  }

  /** Constant-time-ish string compare to avoid leaking match length. */
  function safeEqual(a, b) {
    a = String(a || '');
    b = String(b || '');
    var diff = a.length ^ b.length;
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
  }

  /** @return {string|null} Thai error message, or null if acceptable */
  function passwordProblem(password, minLength) {
    if (typeof password !== 'string' || password.length < minLength) {
      return 'รหัสผ่านต้องมีอย่างน้อย ' + minLength + ' ตัวอักษร';
    }
    if (password.length > 128) return 'รหัสผ่านยาวเกินไป';
    return null;
  }

  /** Session expiry: members stay logged in longer than scanner/admin roles. */
  function sessionExpiry(role, now, config) {
    var ms = SCANNER_ROLES[role]
      ? config.SESSION_HOURS_SCANNER * 3600 * 1000
      : config.SESSION_DAYS_MEMBER * 24 * 3600 * 1000;
    return new Date(now.getTime() + ms);
  }

  /**
   * Login/activation rate limit (spec 5.3: 5 failures -> 10-min lock).
   * @param {number} failures failures so far in the current window
   * @return {{locked: boolean, remaining: number}}
   */
  function rateLimitState(failures, maxFailures) {
    var f = failures || 0;
    return { locked: f >= maxFailures, remaining: Math.max(0, maxFailures - f) };
  }

  function P() { return typeof HHPermissions !== 'undefined' ? HHPermissions : require('./permissions'); }

  /**
   * Who may issue a (new) activation code for whom. A new code lets the holder
   * set a new password, so issuing one is equivalent to resetting the account.
   * @param {{studentId, role, unitId, teamId}} actor
   * @param {{StudentID, Role, UnitID, TeamID}} target Members row
   * @return {string|null} Thai reason when not allowed
   */
  function activationCodeProblem(actor, target) {
    if (String(target.StudentID) === String(actor.studentId)) return 'ออกรหัสให้ตัวเองไม่ได้';
    if (actor.role === 'super_admin') return null;
    if (String(target.UnitID) !== String(actor.unitId)) return 'สมาชิกคนนี้อยู่แผนกอื่น';
    if (actor.role === 'head' && String(target.TeamID) !== String(actor.teamId)) return 'สมาชิกคนนี้ไม่ได้อยู่ทีมของคุณ';
    var rank = P().ROLE_RANK;
    if (!(rank[target.Role] < rank[actor.role])) return 'ออกรหัสให้ผู้ที่มีบทบาทเท่ากันหรือสูงกว่าไม่ได้';
    return null;
  }

  return {
    activationCodeProblem: activationCodeProblem,
    CODE_ALPHABET: CODE_ALPHABET,
    CODE_LENGTH: CODE_LENGTH,
    normalizeStudentId: normalizeStudentId,
    isValidStudentId: isValidStudentId,
    newActivationCode: newActivationCode,
    normalizeActivationCode: normalizeActivationCode,
    hashActivationCode: hashActivationCode,
    newSalt: newSalt,
    hashPassword: hashPassword,
    safeEqual: safeEqual,
    passwordProblem: passwordProblem,
    sessionExpiry: sessionExpiry,
    rateLimitState: rateLimitState,
  };
})();

if (typeof module !== 'undefined') module.exports = HHAuth;
