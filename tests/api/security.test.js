/**
 * Security flows against the deployed TEST backend (seed data, password demo1234).
 * Run: HH_TEST_API_URL=<web app /exec URL> npm run test:api
 * Refuses to run against anything that does not report env TEST.
 *
 * Enrols the demo admin 9900003 once and keeps the app secret in a temp file so
 * re-runs can log in. To start over, delete that file and use the sheet menu
 * "ล้างการยืนยัน 2 ชั้น" for 9900003.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const T = require('../../backend-staff/core/totp');

const URL_ = process.env.HH_TEST_API_URL;
const ADMIN = '9900003';
const PASSWORD = 'demo1234';
const STATE_FILE = path.join(os.tmpdir(), 'hh-test-2fa-9900003.json');

const hmacSha1 = (key, msg) => [...crypto.createHmac('sha1', Buffer.from(key)).update(Buffer.from(msg)).digest()];
const device = () => crypto.randomBytes(16).toString('hex');
const counterNow = () => Math.floor(Date.now() / 30000);
const unique = () => String(Date.now()).slice(-8);

async function call(action, payload, token) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload, token }),
    redirect: 'follow',
  });
  return res.json();
}

/** Wait for a fresh 30-second step, because a code cannot be used twice. */
async function freshCode(secret, after) {
  while (counterNow() <= after) await new Promise((r) => setTimeout(r, 1000));
  const c = counterNow();
  return { code: T.codeAt(secret, c, hmacSha1), counter: c };
}

test('security flows (TEST env)', { skip: !URL_ && 'HH_TEST_API_URL not set' }, async (t) => {
  const health = await call('health');
  assert.equal(health.env, 'TEST', 'refusing to run outside TEST');
  assert.equal(health.data.schemaOk, true, 'run the sheet menu "ตั้งค่าเป็นโหมดทดสอบ (TEST)" first');

  let state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : null;
  let adminToken;
  const dev = device();

  await t.test('admin password alone gives no login token', async () => {
    const r = await call('auth.login', { studentId: ADMIN, password: PASSWORD, deviceId: dev });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data.token, undefined);
    assert.ok(r.data.twoFactor.challenge);
    assert.equal(r.data.twoFactor.stage, state ? 'verify' : 'enroll');
    assert.equal(JSON.stringify(r.data).includes('PasswordHash'), false);

    const wrong = await call('auth.twoFactor', { challenge: r.data.twoFactor.challenge, code: '000000', deviceId: dev });
    assert.equal(wrong.ok, false);
    assert.equal(wrong.error.code, 'TWO_FACTOR_FAILED');

    const secret = state ? state.secret : r.data.twoFactor.secret;
    const fresh = await freshCode(secret, state ? state.counter : 0);
    const ok = await call('auth.twoFactor', { challenge: r.data.twoFactor.challenge, code: fresh.code, studentId: ADMIN, deviceId: dev });
    assert.equal(ok.ok, true, JSON.stringify(ok.error));
    assert.ok(ok.data.token);
    assert.equal(ok.data.profile.role, 'unit_admin');
    assert.ok(ok.data.deviceTrust);
    adminToken = ok.data.token;
    if (!state) {
      assert.equal(ok.data.recoveryCodes.length, T.RECOVERY_COUNT);
      state = { secret, counter: fresh.counter, recovery: ok.data.recoveryCodes };
    } else {
      state.counter = fresh.counter;
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));

    const me = await call('auth.me', {}, adminToken);
    assert.equal(me.ok, true);
    const challengeAgain = await call('auth.twoFactor', { challenge: r.data.twoFactor.challenge, code: fresh.code, deviceId: dev });
    assert.equal(challengeAgain.error.code, 'TWO_FACTOR_EXPIRED');
  });

  await t.test('a used code cannot be replayed', async () => {
    const r = await call('auth.login', { studentId: ADMIN, password: PASSWORD, deviceId: dev });
    const replay = await call('auth.twoFactor', {
      challenge: r.data.twoFactor.challenge, code: T.codeAt(state.secret, state.counter, hmacSha1), deviceId: dev,
    });
    assert.equal(replay.ok, false);
    assert.equal(replay.error.code, 'TWO_FACTOR_FAILED');
  });

  await t.test('a recovery code works once', async () => {
    const code = state.recovery.pop();
    const r1 = await call('auth.login', { studentId: ADMIN, password: PASSWORD, deviceId: dev });
    const ok = await call('auth.twoFactor', { challenge: r1.data.twoFactor.challenge, recoveryCode: code, deviceId: dev });
    assert.equal(ok.ok, true, JSON.stringify(ok.error));
    assert.equal(ok.data.recoveryCodesLeft, state.recovery.length);
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    const r2 = await call('auth.login', { studentId: ADMIN, password: PASSWORD, deviceId: dev });
    const again = await call('auth.twoFactor', { challenge: r2.data.twoFactor.challenge, recoveryCode: code, deviceId: dev });
    assert.equal(again.ok, false);
  });

  await t.test('a stranger cannot lock someone out', async () => {
    const victim = '9900010';
    const attacker = device();
    const owner = device();
    for (let i = 0; i < 5; i++) {
      const r = await call('auth.login', { studentId: victim, password: 'wrong-password', deviceId: attacker });
      assert.equal(r.error.code, 'LOGIN_FAILED');
    }
    const blocked = await call('auth.login', { studentId: victim, password: PASSWORD, deviceId: attacker });
    assert.equal(blocked.error.code, 'LOCKED');
    const fine = await call('auth.login', { studentId: victim, password: PASSWORD, deviceId: owner });
    assert.equal(fine.ok, true, JSON.stringify(fine.error));
    assert.ok(fine.data.token);
  });

  await t.test('a known browser still gets in after guessing from many browsers', async () => {
    const victim = "9900013";
    const owner = device();
    const first = await call('auth.login', { studentId: victim, password: PASSWORD, deviceId: owner });
    assert.ok(first.data.deviceTrust);
    for (let i = 0; i < 15; i++) {
      const r = await call('auth.login', { studentId: victim, password: 'wrong-password', deviceId: device() });
      assert.equal(r.error.code, 'LOGIN_FAILED', `attempt ${i}`);
    }
    const stranger = await call('auth.login', { studentId: victim, password: PASSWORD, deviceId: device() });
    assert.equal(stranger.error.code, 'LOCKED');
    const known = await call('auth.login', { studentId: victim, password: PASSWORD, deviceId: owner, deviceTrust: first.data.deviceTrust });
    assert.equal(known.ok, true, JSON.stringify(known.error));
    const forged = await call('auth.login', { studentId: victim, password: PASSWORD, deviceId: device(), deviceTrust: first.data.deviceTrust });
    assert.equal(forged.error.code, 'LOCKED');
  });

  await t.test('a new password ends older logins', async () => {
    const who = '9900012';
    const before = await call('auth.login', { studentId: who, password: PASSWORD, deviceId: device() });
    assert.ok(before.data.token);
    assert.equal((await call('auth.me', {}, before.data.token)).ok, true);
    const issued = await call('team.activationCode.issue', { studentId: who }, adminToken);
    assert.equal(issued.ok, true, JSON.stringify(issued.error));
    const activated = await call('auth.activate', { studentId: who, code: issued.data.code, password: PASSWORD, deviceId: device() });
    assert.equal(activated.ok, true, JSON.stringify(activated.error));
    assert.equal((await call('auth.me', {}, before.data.token)).error.code, 'UNAUTHENTICATED');
    assert.equal((await call('auth.me', {}, activated.data.token)).ok, true);
  });

  await t.test('sign-up: the join code alone does not activate a stranger', async () => {
    const join = await call('signup.joinCode', {}, adminToken);
    const sid = `88${unique()}`;
    const r = await call('auth.signup', {
      studentId: sid, firstName: 'ทดสอบ', lastName: 'คนนอก', nickname: 'นอก', password: PASSWORD, joinCode: join.data.joinCode, deviceId: device(),
    });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data.status, 'PENDING');
    assert.equal(r.data.token, undefined);
    const login = await call('auth.login', { studentId: sid, password: PASSWORD, deviceId: device() });
    assert.equal(login.error.code, 'PENDING_APPROVAL');
  });

  await t.test('sign-up: roster rows open only with the join code and the right name', async () => {
    const join = (await call('signup.joinCode', {}, adminToken)).data.joinCode;
    const list = await call('roster.list', {}, adminToken);
    const sid = `77${unique()}`;
    const csv = ['รหัสนักศึกษา,ชื่อ,นามสกุล,ชื่อเล่น,แผนก', `${sid},ใหม่รายชื่อ,ทดสอบ,ใหม่,${list.data.unitName}`].join('\n');
    const imported = await call('roster.import', { csv }, adminToken);
    assert.equal(imported.ok, true, JSON.stringify(imported.error));
    assert.equal(imported.data.inserted, 1, JSON.stringify(imported.data));

    const form = { studentId: sid, nickname: 'ใหม่', password: PASSWORD, deviceId: device() };
    const wrongName = await call('auth.signup', { ...form, firstName: 'คนอื่น', lastName: 'ทดสอบ', joinCode: join });
    assert.equal(wrongName.ok, false);
    const noCode = await call('auth.signup', { ...form, firstName: 'ใหม่รายชื่อ', lastName: 'ทดสอบ', joinCode: '' });
    assert.equal(noCode.ok, false);
    const right = await call('auth.signup', { ...form, firstName: ' ใหม่รายชื่อ ', lastName: 'ทดสอบ', joinCode: join });
    assert.equal(right.ok, true, JSON.stringify(right.error));
    assert.equal(right.data.status, 'ACTIVE');
    assert.ok(right.data.token);
    assert.equal(right.data.profile.studentId, sid);
    const twice = await call('auth.signup', { ...form, firstName: 'ใหม่รายชื่อ', lastName: 'ทดสอบ', joinCode: join });
    assert.equal(twice.ok, false);
  });
});
