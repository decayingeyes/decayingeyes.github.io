const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../backend-staff/core/router');
const { AppError } = require('../../backend-staff/core/errors');
const { API_VERSION } = require('../../backend-staff/core/version');

function makeDeps(overrides = {}) {
  const logged = [];
  const deps = {
    env: 'TEST',
    newRequestId: () => 'r-test0001',
    resolveSession: () => null,
    handlers: { health: () => ({ up: true }) },
    logError: (e) => logged.push(e),
    ...overrides,
  };
  return { deps, logged };
}

const body = (obj) => JSON.stringify(obj);

test('parseRequest accepts a minimal body', () => {
  assert.deepEqual(R.parseRequest(body({ action: 'health' })), { action: 'health', payload: {}, token: null });
});

test('parseRequest rejects bad input', () => {
  const bad = ['', 'not json', '[]', 'null', body({}), body({ action: 'Bad Action' }),
    body({ action: 'health', payload: [] }), 'x'.repeat(R.MAX_BODY_CHARS + 1)];
  for (const raw of bad) {
    assert.throws(() => R.parseRequest(raw), (e) => e.code === 'BAD_REQUEST', raw.slice(0, 30));
  }
});

test('successful call returns the envelope', () => {
  const { deps } = makeDeps();
  assert.deepEqual(R.handle(body({ action: 'health' }), deps), {
    ok: true, requestId: 'r-test0001', apiVersion: API_VERSION, env: 'TEST', data: { up: true },
  });
});

test('unknown action -> UNKNOWN_ACTION and logged', () => {
  const { deps, logged } = makeDeps();
  const res = R.handle(body({ action: 'me.everything' }), deps);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'UNKNOWN_ACTION');
  assert.equal(typeof res.error.messageTh, 'string');
  assert.equal(logged.length, 1);
  assert.equal(logged[0].requestId, 'r-test0001');
});

test('known but unimplemented action -> NOT_IMPLEMENTED', () => {
  const { deps } = makeDeps();
  assert.equal(R.handle(body({ action: 'me.card' }), deps).error.code, 'NOT_IMPLEMENTED');
});

test('protected action without token -> UNAUTHENTICATED; handler not called', () => {
  let called = false;
  const { deps } = makeDeps({ handlers: { 'me.card': () => { called = true; } } });
  assert.equal(R.handle(body({ action: 'me.card' }), deps).error.code, 'UNAUTHENTICATED');
  assert.equal(called, false);
});

test('identity comes from the token, never from the payload', () => {
  let seen = null;
  const { deps } = makeDeps({
    resolveSession: (t) => (t === 'tok' ? { studentId: '650001', role: 'member', unitId: 'U1' } : null),
    handlers: { 'me.card': (payload, ctx) => { seen = ctx.actor; return {}; } },
  });
  const res = R.handle(body({ action: 'me.card', token: 'tok', payload: { studentId: '999999', role: 'super_admin' } }), deps);
  assert.equal(res.ok, true);
  assert.deepEqual(seen, { studentId: '650001', role: 'member', unitId: 'U1' });
});

test('role too low -> FORBIDDEN', () => {
  const { deps } = makeDeps({
    resolveSession: () => ({ studentId: '650001', role: 'member', unitId: 'U1' }),
    handlers: { 'scan.lookup': () => ({}) },
  });
  assert.equal(R.handle(body({ action: 'scan.lookup', token: 'tok' }), deps).error.code, 'FORBIDDEN');
});

test('unexpected handler error is hidden as INTERNAL but logged in full', () => {
  const { deps, logged } = makeDeps({ handlers: { health: () => { throw new Error('secret detail'); } } });
  const res = R.handle(body({ action: 'health' }), deps);
  assert.equal(res.error.code, 'INTERNAL');
  assert.ok(!JSON.stringify(res).includes('secret detail'));
  assert.match(logged[0].message, /secret detail/);
});

test('AppError from handler keeps its code', () => {
  const { deps } = makeDeps({ handlers: { health: () => { throw new AppError('BUSY'); } } });
  assert.equal(R.handle(body({ action: 'health' }), deps).error.code, 'BUSY');
});

test('a failing logger never breaks the response', () => {
  const { deps } = makeDeps({ logError: () => { throw new Error('sheet down'); } });
  assert.equal(R.handle('garbage', deps).error.code, 'BAD_REQUEST');
});
