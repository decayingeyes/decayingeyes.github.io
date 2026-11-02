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

  /**
   * Role changes (decision 2026-10-30): everyone joins as member; only unit
   * admins and super admins assign positions. Unit admins assign up to head
   * within their unit; making or changing admins is for super admins only.
   * @return {string|null} Thai reason when not allowed
   */
  function roleChangeProblem(actor, target, newRole) {
    var rank = P().ROLE_RANK;
    if (!P().isRole(newRole)) return 'ตำแหน่งไม่ถูกต้อง';
    if (String(target.StudentID) === String(actor.studentId)) return 'เปลี่ยนตำแหน่งของตัวเองไม่ได้';
    if (actor.role === 'super_admin') return null;
    if (actor.role !== 'unit_admin') return 'ต้องเป็นแอดมินแผนกขึ้นไป';
    if (String(target.UnitID) !== String(actor.unitId)) return 'สมาชิกคนนี้อยู่แผนกอื่น';
    if (rank[target.Role] >= rank.unit_admin) return 'เปลี่ยนตำแหน่งแอดมินได้เฉพาะผู้ดูแลระบบสูงสุด';
    if (rank[newRole] >= rank.unit_admin) return 'แต่งตั้งแอดมินได้เฉพาะผู้ดูแลระบบสูงสุด';
    return null;
  }

  var MAX_PHOTO_CHARS = 45000; // a Sheets cell holds 50,000 characters

  /**
   * Card photos are taken in person by a head (own team) or unit admin, never
   * by the member themself (a member could otherwise put a stand-in's face on
   * their card). Empty dataUrl = remove the photo.
   * @return {string|null}
   */
  function photoProblem(actor, target, dataUrl, coversTeam) {
    if (String(target.StudentID) === String(actor.studentId)) return 'ตั้งรูปบัตรของตัวเองไม่ได้ ให้หัวหน้าหรือแอดมินถ่ายให้';
    if (actor.role !== 'super_admin' && String(target.UnitID) !== String(actor.unitId)) return 'สมาชิกคนนี้อยู่แผนกอื่น';
    if (actor.role === 'head' && !coversTeam) return 'สมาชิกคนนี้ไม่ได้อยู่ทีมของคุณ';
    if (!P().atLeast(actor.role, 'head')) return 'ต้องเป็นหัวหน้าขึ้นไป';
    if (dataUrl === '') return null;
    if (typeof dataUrl !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(dataUrl)) return 'ไฟล์รูปไม่ถูกต้อง';
    if (dataUrl.length > MAX_PHOTO_CHARS) return 'รูปใหญ่เกินไป';
    return null;
  }

  /**
   * Self sign-up form (decision 2026-10-30: friends sign up themselves, a unit
   * admin approves before the account works).
   * @return {string|null} Thai reason when the form is not acceptable
   */
  function signupProblem(f, minPasswordLength) {
    if (!isValidStudentId(f.studentId)) return 'รหัสนักศึกษาไม่ถูกต้อง';
    var labels = { firstName: 'ชื่อ', lastName: 'นามสกุล', nickname: 'ชื่อเล่น' };
    for (var k in labels) {
      var v = String(f[k] || '').trim();
      if (!v) return 'กรุณากรอก' + labels[k];
      if (v.length > 60) return labels[k] + 'ยาวเกินไป';
    }
    return passwordProblem(f.password, minPasswordLength);
  }

  function normalizeName_(s) {
    return String(s === undefined || s === null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  /** The form's first and last name equal the roster row, ignoring case and extra spaces. */
  function namesMatch(form, row) {
    var first = normalizeName_(form.firstName);
    var last = normalizeName_(form.lastName);
    return !!first && !!last && first === normalizeName_(row.FirstName) && last === normalizeName_(row.LastName);
  }

  /**
   * What a sign-up may do, given the Members row for the same id (decision
   * 2026-11-03): the shared join code activates at once only when the person is
   * already on the roster with a matching name. Anyone else waits for an admin,
   * so a leaked code cannot be used to take a student id that is not on the list.
   * Roster rows with a position must use a personal activation code instead,
   * because a join code plus a known name is too weak to claim a head's account.
   * @param {Object|null} existing Members row
   * @param {{firstName, lastName}} form
   * @param {'none'|'match'|'wrong'} join result of joinCodeResult
   * @return {{ok: boolean, mode: (string|null), status: (string|null), messageTh: (string|null)}}
   *         mode: 'new' | 'overwrite' | 'claim'
   */
  function signupAgainst(existing, form, join) {
    function refuse(messageTh) { return { ok: false, mode: null, status: null, messageTh: messageTh }; }
    if (!existing) return { ok: true, mode: 'new', status: 'PENDING', messageTh: null };
    if (existing.Status === 'REJECTED') return { ok: true, mode: 'overwrite', status: 'PENDING', messageTh: null };
    if (existing.Status === 'PENDING') return refuse('รหัสนี้สมัครไว้แล้ว รอแอดมินอนุมัติ');
    if (existing.Status === 'ACTIVE' && !existing.PasswordHash) {
      if (join === 'match' && existing.Role === 'member' && namesMatch(form || {}, existing)) {
        return { ok: true, mode: 'claim', status: 'ACTIVE', messageTh: null };
      }
      return refuse('ข้อมูลไม่ตรงกับรายชื่อ กรุณาตรวจชื่อ นามสกุล และรหัสเข้าร่วมงาน หรือขอรหัสเปิดใช้งานจากหัวหน้า');
    }
    return refuse('รหัสนี้มีบัญชีอยู่แล้ว ให้เข้าสู่ระบบ หรือขอรหัสเปิดใช้งานใหม่จากหัวหน้า');
  }

  var TWO_FACTOR_ROLES = { unit_admin: true, super_admin: true };

  /** Roles that can change other people's data must pass a second login step. */
  function requiresTwoFactor(role, config) {
    return !!TWO_FACTOR_ROLES[role] && !(config && config.REQUIRE_2FA === false);
  }

  /**
   * Does a stored login still count for this role? A login made before the
   * second step was set up does not (for example an admin session from before
   * this feature, or a member session of someone just promoted to admin).
   * @param {Date|string} sessionCreatedAt
   * @param {{EnabledAt}|null} twoFactorRow
   */
  function sessionPassesTwoFactor(role, config, sessionCreatedAt, twoFactorRow) {
    if (!requiresTwoFactor(role, config)) return true;
    if (!twoFactorRow || !twoFactorRow.EnabledAt) return false;
    // Whole seconds: both values are written within the same request at enrolment.
    var created = Math.floor(new Date(sessionCreatedAt).getTime() / 1000);
    var enabled = Math.floor(new Date(twoFactorRow.EnabledAt).getTime() / 1000);
    return created >= enabled;
  }

  /** A browser's random id; anything else counts as one shared "unknown device". */
  function normalizeDeviceId(raw) {
    var s = String(raw === undefined || raw === null ? '' : raw);
    return /^[0-9a-f]{32}$/.test(s) ? s : 'unknown';
  }

  /**
   * Lockout that a stranger cannot use against someone else. Wrong guesses lock
   * the browser that made them. Across all browsers there is a second, higher
   * limit that stops guessing from many devices, and a browser this person has
   * logged in from before skips that limit, so they can still get in.
   * @return {boolean} true when this attempt must be refused
   */
  function attemptLocked(deviceFailures, accountFailures, trustedDevice, maxPerDevice, maxPerAccount) {
    if ((deviceFailures || 0) >= maxPerDevice) return true;
    return !trustedDevice && (accountFailures || 0) >= maxPerAccount;
  }

  /**
   * Shared join code (decision 2026-10-30): typed at sign-up, a correct code
   * activates the account at once as a plain member. Case/space-insensitive.
   * @return {'none'|'match'|'wrong'}
   */
  function joinCodeResult(given, configured) {
    var g = normalizeActivationCode(given);
    if (!g) return 'none';
    var c = normalizeActivationCode(configured);
    return c && safeEqual(g, c) ? 'match' : 'wrong';
  }

  return {
    joinCodeResult: joinCodeResult,
    signupProblem: signupProblem,
    signupAgainst: signupAgainst,
    namesMatch: namesMatch,
    requiresTwoFactor: requiresTwoFactor,
    sessionPassesTwoFactor: sessionPassesTwoFactor,
    normalizeDeviceId: normalizeDeviceId,
    attemptLocked: attemptLocked,
    MAX_PHOTO_CHARS: MAX_PHOTO_CHARS,
    photoProblem: photoProblem,
    roleChangeProblem: roleChangeProblem,
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
