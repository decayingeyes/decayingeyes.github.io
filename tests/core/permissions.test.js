const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../backend-staff/core/permissions');

// Every action listed in spec section 7 must have exactly one rule.
const SPEC_ACTIONS = [
  'health',
  'auth.activate', 'auth.login', 'auth.signup', 'auth.logout', 'auth.me',
  'me.card', 'me.today', 'me.history', 'me.schedule', 'me.reports', 'me.report.create', 'me.selfReport',
  'scan.lookup', 'scan.confirm',
  'team.status', 'team.reports', 'team.report.resolve', 'team.activationCode.issue', 'photo.set', 'correction.propose',
  'correction.list', 'correction.approve', 'correction.reject', 'roster.import', 'roster.update', 'roster.list', 'signup.list', 'signup.review', 'signup.joinCode',
  'role.set', 'scanner.assign', 'code.reissue', 'schedule.import', 'schedule.update',
  'period.close', 'period.reopen', 'export.summary', 'dashboard.get', 'rebuild.fromLog',
];

test('permissions table covers exactly the spec actions', () => {
  assert.deepEqual(Object.keys(P.ACTIONS).sort(), [...SPEC_ACTIONS].sort());
});

test('every rule uses a known role and scope', () => {
  const scopes = ['none', 'self', 'team', 'unit', 'all'];
  for (const [action, rule] of Object.entries(P.ACTIONS)) {
    assert.ok(rule.minRole === 'public' || P.isRole(rule.minRole), action + ' minRole');
    assert.ok(scopes.includes(rule.scope), action + ' scope');
  }
});

test('only health, activate, login and signup are public', () => {
  const pub = Object.keys(P.ACTIONS).filter(P.isPublic).sort();
  assert.deepEqual(pub, ['auth.activate', 'auth.login', 'auth.signup', 'health']);
});

test('member endpoints are self-scoped', () => {
  for (const action of Object.keys(P.ACTIONS).filter((a) => a.startsWith('me.'))) {
    assert.equal(P.rule(action).scope, 'self', action);
  }
});

test('not logged in -> UNAUTHENTICATED for protected actions', () => {
  assert.deepEqual(P.check('me.card', null), { allowed: false, reason: 'UNAUTHENTICATED' });
  assert.deepEqual(P.check('health', null), { allowed: true, reason: null });
});

test('unknown action is rejected', () => {
  assert.equal(P.check('me.everyone', 'super_admin').reason, 'UNKNOWN_ACTION');
});

test('role ranking', () => {
  assert.equal(P.check('scan.lookup', 'member').allowed, false);
  assert.equal(P.check('scan.lookup', 'deputy').allowed, true);
  assert.equal(P.check('correction.propose', 'deputy').allowed, false);
  assert.equal(P.check('correction.propose', 'head').allowed, true);
  assert.equal(P.check('correction.approve', 'head').allowed, false);
  assert.equal(P.check('correction.approve', 'unit_admin').allowed, true);
  assert.equal(P.check('period.reopen', 'unit_admin').allowed, false);
  assert.equal(P.check('period.reopen', 'super_admin').allowed, true);
  assert.equal(P.check('me.card', 'super_admin').allowed, true);
});

test('bogus role is never allowed', () => {
  assert.equal(P.check('me.card', 'admin').reason, 'FORBIDDEN');
  assert.equal(P.check('me.card', '__proto__').reason, 'FORBIDDEN');
});
