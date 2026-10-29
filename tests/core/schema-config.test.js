const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../backend-staff/core/schema');
const C = require('../../backend-staff/core/config-defaults');
const { newRequestId } = require('../../backend-staff/core/ids');

test('no sheet has duplicate headers', () => {
  for (const name of S.sheetNames()) {
    const h = S.headers(name);
    assert.equal(new Set(h).size, h.length, name);
  }
});

test('every data sheet except Config/Units/Errors carries UnitID', () => {
  const exempt = ['Config', 'Units', 'Errors', 'AuthSessions'];
  for (const name of S.sheetNames().filter((n) => !exempt.includes(n))) {
    assert.ok(S.headers(name).includes('UnitID'), name);
  }
});

test('compareHeaders: ok, extra trailing column ok, mismatch reported', () => {
  const h = S.headers('Units');
  assert.deepEqual(S.compareHeaders('Units', h), []);
  assert.deepEqual(S.compareHeaders('Units', [...h, 'MyNotes']), []);
  assert.equal(S.compareHeaders('Units', ['UnitID', 'Title', 'Active']).length, 1);
  assert.equal(S.compareHeaders('Units', []).length, 3);
});

test('headers() returns a copy', () => {
  S.headers('Units').push('X');
  assert.equal(S.headers('Units').length, 3);
});

test('config build: defaults, overrides, coercion', () => {
  const cfg = C.build([
    ['ROUNDING_MINUTES', '15'],
    ['MAX_HOURS_PER_DAY', 'abc'],
    ['POINTS_PER_HOUR', ''],
    ['CUSTOM_KEY', 42],
  ]);
  assert.equal(cfg.ROUNDING_MINUTES, 15);
  assert.equal(cfg.MAX_HOURS_PER_DAY, 12); // invalid -> default
  assert.equal(cfg.POINTS_PER_HOUR, null);
  assert.equal(cfg.WORKDAY_START_HOUR, 5);
  assert.equal(cfg.AUTO_CLOSE_HOUR, 5); // blank -> WORKDAY_START_HOUR
  assert.equal(cfg.CUSTOM_KEY, '42');
});

test('config build: AUTO_CLOSE_HOUR follows a custom WORKDAY_START_HOUR', () => {
  assert.equal(C.build([['WORKDAY_START_HOUR', 6]]).AUTO_CLOSE_HOUR, 6);
  assert.equal(C.build([['WORKDAY_START_HOUR', 6], ['AUTO_CLOSE_HOUR', 4]]).AUTO_CLOSE_HOUR, 4);
});

test('config defaults have unique keys and descriptions', () => {
  const keys = C.DEFAULTS.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const d of C.DEFAULTS) assert.ok(d.description, d.key);
});

test('request id format', () => {
  assert.match(newRequestId(), /^r-[0-9a-z]{8}$/);
  assert.equal(newRequestId(() => 0), 'r-00000000');
});
