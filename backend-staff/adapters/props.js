/**
 * Script Properties wrapper. Holds ENV, SPREADSHEET_ID and secrets.
 * Secrets are never returned by any API action or written to sheets/logs.
 */
var HHProps = (function () {
  var KEYS = {
    ENV: 'ENV', // 'TEST' | 'PROD'
    SPREADSHEET_ID: 'SPREADSHEET_ID',
    HMAC_SECRET: 'HMAC_SECRET',
    PASSWORD_PEPPER: 'PASSWORD_PEPPER',
  };

  function store() {
    return PropertiesService.getScriptProperties();
  }

  function get(key) {
    return store().getProperty(key);
  }

  function set(key, value) {
    store().setProperty(key, String(value));
  }

  /** 'TEST' | 'PROD' | null when setup has not run yet. */
  function env() {
    var v = get(KEYS.ENV);
    return v === 'TEST' || v === 'PROD' ? v : null;
  }

  function isTest() {
    return env() === 'TEST';
  }

  /** Create a random secret once; never overwrite an existing one. */
  function ensureSecret(key) {
    if (!get(key)) {
      set(key, Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
    }
  }

  return {
    KEYS: KEYS,
    get: get,
    set: set,
    env: env,
    isTest: isTest,
    ensureSecret: ensureSecret,
  };
})();
