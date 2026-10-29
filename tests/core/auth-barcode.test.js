const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const A = require('../../backend-staff/core/auth');
const B = require('../../backend-staff/core/barcode');

const sha256Hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmacBytes = (key, msg) => [...crypto.createHmac('sha256', key).update(msg, 'utf8').digest()];
const seqRand = () => { let i = 0; return (n) => (i++ * 7) % n; };

test('student id normalization and validation', () => {
  assert.equal(A.normalizeStudentId('  65a123 '), '65A123');
  assert.equal(A.isValidStudentId('6512345678'), true);
  assert.equal(A.isValidStudentId('65-1234'), false); // '-' is the barcode separator
  assert.equal(A.isValidStudentId('abc'), false);
});

test('activation codes use the unambiguous alphabet', () => {
  const code = A.newActivationCode(seqRand());
  assert.equal(code.length, 6);
  for (const ch of code) assert.ok(A.CODE_ALPHABET.includes(ch));
  assert.ok(!/[01OIL]/.test(A.CODE_ALPHABET));
});

test('activation code hash ignores case, spaces and dashes', () => {
  const h = A.hashActivationCode('ABC-234', 'pep', sha256Hex);
  assert.equal(A.hashActivationCode(' abc 234', 'pep', sha256Hex), h);
  assert.notEqual(A.hashActivationCode('ABC234', 'other', sha256Hex), h);
});

test('password hashing: deterministic, salted, peppered, min 1000 rounds', () => {
  const h = A.hashPassword('secret123', 'salt', 'pep', 1000, sha256Hex);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(A.hashPassword('secret123', 'salt', 'pep', 1000, sha256Hex), h);
  assert.notEqual(A.hashPassword('secret123', 'salt2', 'pep', 1000, sha256Hex), h);
  assert.notEqual(A.hashPassword('secret123', 'salt', 'pep2', 1000, sha256Hex), h);
  assert.equal(A.hashPassword('secret123', 'salt', 'pep', 10, sha256Hex), h); // floor at 1000
});

test('safeEqual', () => {
  assert.equal(A.safeEqual('abc', 'abc'), true);
  assert.equal(A.safeEqual('abc', 'abd'), false);
  assert.equal(A.safeEqual('abc', 'abcd'), false);
  assert.equal(A.safeEqual('', null), true);
});

test('password rules', () => {
  assert.equal(A.passwordProblem('1234567', 8) !== null, true);
  assert.equal(A.passwordProblem('12345678', 8), null);
  assert.equal(A.passwordProblem(undefined, 8) !== null, true);
});

test('session lifetime: members 7 days, scanner roles 12 h', () => {
  const now = new Date('2026-11-01T10:00:00Z');
  const cfg = { SESSION_DAYS_MEMBER: 7, SESSION_HOURS_SCANNER: 12 };
  assert.equal(A.sessionExpiry('member', now, cfg).toISOString(), '2026-11-08T10:00:00.000Z');
  assert.equal(A.sessionExpiry('head', now, cfg).toISOString(), '2026-11-01T22:00:00.000Z');
});

test('rate limit: 5 failures lock', () => {
  assert.deepEqual(A.rateLimitState(4, 5), { locked: false, remaining: 1 });
  assert.deepEqual(A.rateLimitState(5, 5), { locked: true, remaining: 0 });
  assert.deepEqual(A.rateLimitState(undefined, 5), { locked: false, remaining: 5 });
});

test('base32 matches RFC 4648 vectors', () => {
  const enc = (s) => B.base32([...Buffer.from(s)]);
  assert.equal(enc('f'), 'MY');
  assert.equal(enc('foobar'), 'MZXW6YTBOI');
  assert.equal(B.base32([-1]), '74'); // signed bytes from Apps Script
});

test('barcode payload roundtrip and verification', () => {
  const p = B.payload('6512345678', 1, 'k', hmacBytes);
  assert.match(p, /^6512345678-[A-Z2-7]{4}$/);
  assert.deepEqual(B.parse(p), { studentId: '6512345678', check: p.slice(-4) });
  assert.equal(B.verify(p, '6512345678', 1, 'k', hmacBytes), true);
  assert.equal(B.verify(p.toLowerCase(), '6512345678', 1, 'k', hmacBytes), true);
});

test('barcode rejects old version, wrong secret, other member, garbage', () => {
  const p = B.payload('6512345678', 1, 'k', hmacBytes);
  assert.equal(B.verify(p, '6512345678', 2, 'k', hmacBytes), false);
  assert.equal(B.verify(p, '6512345678', 1, 'other', hmacBytes), false);
  assert.equal(B.verify(p, '6500000000', 1, 'k', hmacBytes), false);
  assert.equal(B.verify('hello', '6512345678', 1, 'k', hmacBytes), false);
  assert.equal(B.parse('6512345678'), null);
});

test('activation code issuing: self, unit, team and rank rules', () => {
  const head = { studentId: 'H1', role: 'head', unitId: 'U01', teamId: 'T01' };
  const admin = { studentId: 'A1', role: 'unit_admin', unitId: 'U01', teamId: 'T09' };
  const sup = { studentId: 'S1', role: 'super_admin', unitId: 'U01', teamId: 'T09' };
  const m = (id, role, unit, team) => ({ StudentID: id, Role: role, UnitID: unit, TeamID: team });

  assert.equal(A.activationCodeProblem(head, m('M1', 'member', 'U01', 'T01')), null);
  assert.equal(A.activationCodeProblem(head, m('M2', 'deputy', 'U01', 'T01')), null);
  assert.ok(A.activationCodeProblem(head, m('H1', 'head', 'U01', 'T01'))); // self
  assert.ok(A.activationCodeProblem(head, m('M3', 'member', 'U01', 'T02'))); // other team
  assert.ok(A.activationCodeProblem(head, m('H2', 'head', 'U01', 'T01'))); // same rank
  assert.ok(A.activationCodeProblem(head, m('A2', 'unit_admin', 'U01', 'T01'))); // higher rank
  assert.equal(A.activationCodeProblem(admin, m('M3', 'member', 'U01', 'T02')), null);
  assert.ok(A.activationCodeProblem(admin, m('M4', 'member', 'U02', 'T05'))); // other unit
  assert.ok(A.activationCodeProblem(admin, m('A2', 'unit_admin', 'U01', 'T01')));
  assert.equal(A.activationCodeProblem(sup, m('A2', 'unit_admin', 'U02', 'T01')), null);
  assert.ok(A.activationCodeProblem(sup, m('S1', 'super_admin', 'U01', 'T09')));
});
