const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../backend-staff/core/google');

const NOW = 1_790_000_000;
const expect = { clientId: 'abc.apps.googleusercontent.com', nonce: 'n-123', nowSeconds: NOW };
const good = {
  aud: 'abc.apps.googleusercontent.com', iss: 'https://accounts.google.com', exp: String(NOW + 600),
  nonce: 'n-123', sub: '1234567890', email: 'Someone@Gmail.com', email_verified: 'true',
};

test('a genuine token for this site and this login passes', () => {
  assert.deepEqual(G.checkClaims(good, expect), { ok: true, sub: '1234567890', email: 'someone@gmail.com', reason: null });
  assert.equal(G.checkClaims({ ...good, iss: 'accounts.google.com', email_verified: true }, expect).ok, true);
});

test('tokens for another site, issuer, login or person are refused', () => {
  const cases = {
    aud: { aud: 'other.apps.googleusercontent.com' },
    iss: { iss: 'https://evil.example' },
    expired: { exp: String(NOW - 120) },
    nonce: { nonce: 'n-999' },
    sub: { sub: '' },
    email: { email_verified: 'false' },
  };
  for (const [reason, change] of Object.entries(cases)) {
    assert.equal(G.checkClaims({ ...good, ...change }, expect).reason, reason, reason);
  }
  assert.equal(G.checkClaims({ ...good, nonce: undefined }, { ...expect, nonce: '' }).ok, false);
  assert.equal(G.checkClaims(null, expect).ok, false);
  assert.equal(G.checkClaims(good, { ...expect, clientId: '' }).reason, 'no-client-id');
});

test('emails are masked for display', () => {
  assert.equal(G.maskEmail('someone@gmail.com'), 'so•••@gmail.com');
  assert.equal(G.maskEmail('a@x.com'), 'a•••@x.com');
  assert.equal(G.maskEmail('bad'), '');
});
