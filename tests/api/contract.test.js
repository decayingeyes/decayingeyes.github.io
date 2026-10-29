/**
 * API contract tests against the deployed TEST backend.
 * Run: HH_TEST_API_URL=<web app /exec URL> npm run test:api
 * Refuses to run against anything that does not report env TEST.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const URL_ = process.env.HH_TEST_API_URL;

async function call(action, payload, token) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload, token }),
    redirect: 'follow',
  });
  return res.json();
}

test('API contract (TEST env)', { skip: !URL_ && 'HH_TEST_API_URL not set' }, async (t) => {
  const health = await call('health');
  assert.equal(health.ok, true);
  assert.equal(health.env, 'TEST', 'refusing to run contract tests outside TEST');

  await t.test('health shape', () => {
    assert.match(health.requestId, /^r-[0-9a-z]{8}$/);
    assert.equal(typeof health.apiVersion, 'string');
    assert.equal(health.data.configured, true);
    assert.equal(health.data.schemaOk, true);
    assert.ok(!Number.isNaN(Date.parse(health.data.serverTime)));
  });

  await t.test('unknown action', async () => {
    const r = await call('nope.nope');
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'UNKNOWN_ACTION');
  });

  await t.test('protected action without token', async () => {
    const r = await call('me.card');
    assert.equal(r.ok, false);
    assert.ok(['UNAUTHENTICATED', 'NOT_IMPLEMENTED'].includes(r.error.code));
  });
});
