const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const A = require('../../backend-staff/core/auth');
const T = require('../../backend-staff/core/totp');

const sha256Hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmacSha1 = (key, msg) => [...crypto.createHmac('sha1', Buffer.from(key)).update(Buffer.from(msg)).digest()];
const rand = (n) => crypto.randomInt(n);

// RFC 6238 appendix B: ASCII secret "12345678901234567890".
const RFC_SECRET = T.base32Encode([...Buffer.from('12345678901234567890', 'ascii')]);

test('TOTP matches the RFC 6238 test vectors', () => {
  assert.equal(T.codeAt(RFC_SECRET, Math.floor(59 / 30), hmacSha1, 8), '94287082');
  assert.equal(T.codeAt(RFC_SECRET, Math.floor(1111111109 / 30), hmacSha1, 8), '07081804');
  assert.equal(T.codeAt(RFC_SECRET, Math.floor(1234567890 / 30), hmacSha1, 8), '89005924');
  assert.equal(T.codeAt(RFC_SECRET, Math.floor(20000000000 / 30), hmacSha1, 8), '65353130');
  assert.equal(T.codeAt(RFC_SECRET, Math.floor(59 / 30), hmacSha1), '287082');
});

test('base32 round trip, including the secret size used for real accounts', () => {
  const bytes = Array.from({ length: 20 }, () => rand(256));
  assert.deepEqual(T.base32Decode(T.base32Encode(bytes)), bytes);
  assert.deepEqual(T.base32Decode('gezd gnbv'), T.base32Decode('GEZDGNBV'));
  assert.equal(T.newSecret(rand).length, 32);
  assert.throws(() => T.base32Decode('not base32!'));
});

test('TOTP verify: clock drift of one step is fine, more is not', () => {
  const now = 1793600000000;
  const c = Math.floor(now / 30000);
  for (const d of [-1, 0, 1]) {
    assert.deepEqual(T.verify(RFC_SECRET, T.codeAt(RFC_SECRET, c + d, hmacSha1), now, 0, hmacSha1), { ok: true, counter: c + d });
  }
  assert.equal(T.verify(RFC_SECRET, T.codeAt(RFC_SECRET, c + 2, hmacSha1), now, 0, hmacSha1).ok, false);
  assert.equal(T.verify(RFC_SECRET, T.codeAt(RFC_SECRET, c - 2, hmacSha1), now, 0, hmacSha1).ok, false);
});

test('TOTP verify: a used code cannot be replayed, and bad input is refused', () => {
  const now = 1793600000000;
  const c = Math.floor(now / 30000);
  const code = T.codeAt(RFC_SECRET, c, hmacSha1);
  assert.equal(T.verify(RFC_SECRET, code, now, c, hmacSha1).ok, false);
  assert.equal(T.verify(RFC_SECRET, code, now, c - 1, hmacSha1).ok, true);
  assert.equal(T.verify(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now, 0, hmacSha1).ok, true);
  for (const bad of ['', null, undefined, '12345', '1234567', 'abcdef']) {
    assert.equal(T.verify(RFC_SECRET, bad, now, 0, hmacSha1).ok, false);
  }
});

test('stored secret is scrambled and only opens with the right key', () => {
  const secret = T.newSecret(rand);
  const sealed = T.seal(secret, 'pepper', sha256Hex);
  assert.notEqual(sealed, secret);
  assert.ok(!sealed.includes(secret));
  assert.equal(T.unseal(sealed, 'pepper', sha256Hex), secret);
  assert.notEqual(T.unseal(sealed, 'other', sha256Hex), secret);
});

test('recovery codes: count, format, and hashing ignores case and dashes', () => {
  const codes = T.newRecoveryCodes(rand);
  assert.equal(codes.length, T.RECOVERY_COUNT);
  codes.forEach((c) => assert.match(c, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/));
  const h = T.hashRecoveryCode('AB2C-DE3F', 'p', sha256Hex);
  assert.equal(T.hashRecoveryCode('ab2c de3f', 'p', sha256Hex), h);
  assert.notEqual(T.hashRecoveryCode('AB2C-DE3G', 'p', sha256Hex), h);
  assert.notEqual(T.hashRecoveryCode('AB2C-DE3F', 'q', sha256Hex), h);
});

test('otpauth link is what authenticator apps expect', () => {
  const uri = T.otpauthUri('ABC234', '67060186', 'Decaying Eyes');
  assert.equal(uri, 'otpauth://totp/Decaying%20Eyes:67060186?secret=ABC234&issuer=Decaying%20Eyes&algorithm=SHA1&digits=6&period=30');
});

const form = { firstName: ' สมชาย ', lastName: 'ใจ  ดี' };
const onRoster = { Status: 'ACTIVE', Role: 'member', PasswordHash: '', FirstName: 'สมชาย', LastName: 'ใจ ดี' };

test('sign-up: not on the roster always waits for an admin, even with the join code', () => {
  for (const join of ['none', 'match']) {
    assert.deepEqual(A.signupAgainst(null, form, join), { ok: true, mode: 'new', status: 'PENDING', messageTh: null });
  }
  const rejected = A.signupAgainst({ Status: 'REJECTED' }, form, 'match');
  assert.equal(rejected.mode, 'overwrite');
  assert.equal(rejected.status, 'PENDING');
});

test('sign-up: on the roster with the join code and matching name gets in at once', () => {
  assert.deepEqual(A.signupAgainst(onRoster, form, 'match'), { ok: true, mode: 'claim', status: 'ACTIVE', messageTh: null });
  assert.equal(A.signupAgainst({ ...onRoster, FirstName: 'somchai', LastName: 'jai' }, { firstName: 'SOMCHAI', lastName: 'Jai' }, 'match').ok, true);
});

test('sign-up: a leaked join code cannot take someone else\'s roster row', () => {
  assert.equal(A.signupAgainst(onRoster, { firstName: 'คนอื่น', lastName: 'ใจ ดี' }, 'match').ok, false);
  assert.equal(A.signupAgainst(onRoster, { firstName: 'สมชาย', lastName: 'คนอื่น' }, 'match').ok, false);
  assert.equal(A.signupAgainst(onRoster, form, 'none').ok, false);
  assert.equal(A.signupAgainst(onRoster, undefined, 'match').ok, false);
  assert.equal(A.signupAgainst({ ...onRoster, FirstName: '', LastName: '' }, { firstName: '', lastName: '' }, 'match').ok, false);
});

test('sign-up: a roster row with a position needs a personal activation code', () => {
  for (const Role of ['deputy', 'head', 'unit_admin', 'super_admin']) {
    assert.equal(A.signupAgainst({ ...onRoster, Role }, form, 'match').ok, false);
  }
});

test('sign-up: existing accounts cannot be overwritten', () => {
  assert.equal(A.signupAgainst({ ...onRoster, PasswordHash: 'x' }, form, 'match').ok, false);
  assert.equal(A.signupAgainst({ Status: 'PENDING' }, form, 'match').ok, false);
  assert.equal(A.signupAgainst({ Status: 'DISABLED' }, form, 'match').ok, false);
});

test('second step: required for admins only, and can be switched off in config', () => {
  for (const r of ['unit_admin', 'super_admin']) assert.equal(A.requiresTwoFactor(r, { REQUIRE_2FA: true }), true);
  for (const r of ['member', 'deputy', 'head']) assert.equal(A.requiresTwoFactor(r, { REQUIRE_2FA: true }), false);
  assert.equal(A.requiresTwoFactor('super_admin', { REQUIRE_2FA: false }), false);
});

test('second step: admin logins from before set-up stop working', () => {
  const on = { REQUIRE_2FA: true };
  const enabled = new Date('2026-11-03T10:00:00.500Z');
  assert.equal(A.sessionPassesTwoFactor('member', on, new Date(0), null), true);
  assert.equal(A.sessionPassesTwoFactor('unit_admin', on, new Date(), null), false);
  assert.equal(A.sessionPassesTwoFactor('unit_admin', on, new Date('2026-11-03T09:59:00Z'), { EnabledAt: enabled }), false);
  assert.equal(A.sessionPassesTwoFactor('unit_admin', on, new Date('2026-11-03T10:00:00.900Z'), { EnabledAt: enabled }), true);
  assert.equal(A.sessionPassesTwoFactor('unit_admin', { REQUIRE_2FA: false }, new Date(0), null), true);
});

test('lockout: a stranger locks only their own browser', () => {
  const lock = (device, account, trusted) => A.attemptLocked(device, account, trusted, 5, 15);
  assert.equal(lock(0, 0, false), false);
  assert.equal(lock(4, 4, false), false);
  assert.equal(lock(5, 5, false), true);
  // The attacker's browser is locked; the owner's other browser is not.
  assert.equal(lock(0, 5, false), false);
  // Guessing from many browsers hits the account limit...
  assert.equal(lock(0, 15, false), true);
  // ...but the owner's known browser still gets in.
  assert.equal(lock(0, 15, true), false);
  assert.equal(lock(5, 15, true), true);
  assert.equal(lock(undefined, undefined, false), false);
});

test('device ids are accepted only in the exact format the browser generates', () => {
  const good = 'a'.repeat(32);
  assert.equal(A.normalizeDeviceId(good), good);
  for (const bad of ['', null, undefined, 'short', 'A'.repeat(32), `${good}x`, 'g'.repeat(32), { a: 1 }]) {
    assert.equal(A.normalizeDeviceId(bad), 'unknown');
  }
});
