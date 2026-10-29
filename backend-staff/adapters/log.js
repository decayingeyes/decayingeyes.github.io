/**
 * Append-only audit `Log` (source of truth). Timestamps are always server time.
 */
var HHLog = (function () {
  /**
   * @param {{requestId?, unitId?, studentId?, action, actorId?, method?, flags?, reason?, note?}} e
   */
  function append(e) {
    HHSheets.append('Log', {
      Timestamp: new Date(),
      RequestId: e.requestId || '',
      UnitID: e.unitId || '',
      StudentID: e.studentId || '',
      Action: e.action,
      ActorID: e.actorId || '',
      Method: e.method || '',
      Flags: (e.flags || []).join(','),
      Reason: e.reason || '',
      Note: e.note || '',
    });
  }

  return { append: append };
})();
