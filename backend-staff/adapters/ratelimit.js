/**
 * Failure counters in CacheService (spec 5.3). A window resets
 * LOGIN_LOCK_MINUTES after the last failure.
 *
 * Without `opts` a counter is per (kind, studentId). With `opts` the attempt
 * also carries a browser id, see HHAuth.attemptLocked: this is what keeps a
 * stranger from locking someone out by typing wrong passwords for their id.
 *   opts: { device: string, trusted: boolean }
 */
var HHRateLimit = (function () {
  function key_(kind, studentId) {
    return 'fail:' + kind + ':' + studentId;
  }

  function deviceKey_(kind, studentId, device) {
    return 'fail:' + kind + ':' + studentId + ':' + device;
  }

  function lockedError_(cfg) {
    return new HHErrors.AppError('LOCKED', 'ใส่ผิดหลายครั้งเกินไป กรุณารอ ' + cfg.LOGIN_LOCK_MINUTES + ' นาทีแล้วลองใหม่');
  }

  function assertNotLocked(kind, studentId, opts) {
    var cfg = HHConfig.get();
    var cache = CacheService.getScriptCache();
    var accountFailures = Number(cache.get(key_(kind, studentId)) || 0);
    if (!opts) {
      if (HHAuth.rateLimitState(accountFailures, cfg.LOGIN_MAX_FAILURES).locked) throw lockedError_(cfg);
      return;
    }
    var deviceFailures = Number(cache.get(deviceKey_(kind, studentId, opts.device)) || 0);
    if (HHAuth.attemptLocked(deviceFailures, accountFailures, opts.trusted, cfg.LOGIN_MAX_FAILURES, cfg.LOGIN_ACCOUNT_MAX_FAILURES)) {
      throw lockedError_(cfg);
    }
  }

  function bump_(key, seconds) {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get(key) || 0) + 1;
    cache.put(key, String(n), seconds);
    return n;
  }

  function recordFailure(kind, studentId, opts) {
    var seconds = HHConfig.get().LOGIN_LOCK_MINUTES * 60;
    if (!opts) return bump_(key_(kind, studentId), seconds);
    // A known browser's typos must not add to the limit that strangers run into.
    if (!opts.trusted) bump_(key_(kind, studentId), seconds);
    return bump_(deviceKey_(kind, studentId, opts.device), seconds);
  }

  function reset(kind, studentId, opts) {
    var cache = CacheService.getScriptCache();
    // With a browser id, only that browser's counter clears. The owner logging in
    // must not wipe the account-wide count of a stranger who is still guessing;
    // it expires by itself, and the owner's known browser skips it meanwhile.
    if (opts) cache.remove(deviceKey_(kind, studentId, opts.device));
    else cache.remove(key_(kind, studentId));
  }

  return {
    assertNotLocked: assertNotLocked,
    recordFailure: recordFailure,
    reset: reset,
  };
})();
