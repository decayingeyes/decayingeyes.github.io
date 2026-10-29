/**
 * LockService wrapper. Use around every check-then-write.
 */
var HHLock = (function () {
  /**
   * Run fn while holding the script lock.
   * @param {function(): *} fn
   * @param {number=} timeoutMs default 10 s; on timeout throws BUSY
   */
  function withLock(fn, timeoutMs) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(timeoutMs || 10000)) {
      throw new HHErrors.AppError('BUSY', null, 'lock timeout');
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  }

  return { withLock: withLock };
})();
