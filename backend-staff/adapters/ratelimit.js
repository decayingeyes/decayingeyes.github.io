/**
 * Failure counter per (kind, studentId) in CacheService (spec 5.3).
 * The window resets LOGIN_LOCK_MINUTES after the last failure.
 */
var HHRateLimit = (function () {
  function key_(kind, studentId) {
    return 'fail:' + kind + ':' + studentId;
  }

  function assertNotLocked(kind, studentId) {
    var cfg = HHConfig.get();
    var n = Number(CacheService.getScriptCache().get(key_(kind, studentId)) || 0);
    if (HHAuth.rateLimitState(n, cfg.LOGIN_MAX_FAILURES).locked) {
      throw new HHErrors.AppError('LOCKED', 'ใส่ผิดหลายครั้งเกินไป กรุณารอ ' + cfg.LOGIN_LOCK_MINUTES + ' นาทีแล้วลองใหม่');
    }
  }

  function recordFailure(kind, studentId) {
    var cfg = HHConfig.get();
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get(key_(kind, studentId)) || 0) + 1;
    cache.put(key_(kind, studentId), String(n), cfg.LOGIN_LOCK_MINUTES * 60);
    return n;
  }

  function reset(kind, studentId) {
    CacheService.getScriptCache().remove(key_(kind, studentId));
  }

  return {
    assertNotLocked: assertNotLocked,
    recordFailure: recordFailure,
    reset: reset,
  };
})();
