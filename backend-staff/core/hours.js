/**
 * Work date and hour-counting rules (spec 5.8). All times are absolute Date
 * objects; the event runs in Asia/Bangkok (UTC+7, no daylight saving).
 */
var HHHours = (function () {
  var BANGKOK_OFFSET_MS = 7 * 3600 * 1000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** yyyy-MM-dd in Bangkok local time. */
  function bangkokDate(date) {
    var d = new Date(date.getTime() + BANGKOK_OFFSET_MS);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  /** HH:mm in Bangkok local time. */
  function bangkokTime(date) {
    var d = new Date(date.getTime() + BANGKOK_OFFSET_MS);
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }

  /**
   * The work date a moment belongs to. A work date starts at
   * WORKDAY_START_HOUR local time, so 02:00 on the 31st with start hour 5
   * still belongs to the 30th (events running past midnight).
   */
  function workDate(date, workdayStartHour) {
    return bangkokDate(new Date(date.getTime() - workdayStartHour * 3600 * 1000));
  }

  function rawMinutes(inTime, outTime) {
    return Math.max(0, Math.floor((outTime.getTime() - inTime.getTime()) / 60000));
  }

  /**
   * Counted hours for one session before the daily cap:
   * under MIN_SESSION_MINUTES -> 0, otherwise rounded DOWN to ROUNDING_MINUTES.
   */
  function sessionHours(minutes, cfg) {
    if (minutes < cfg.MIN_SESSION_MINUTES) return 0;
    var step = cfg.ROUNDING_MINUTES > 0 ? cfg.ROUNDING_MINUTES : 1;
    return (Math.floor(minutes / step) * step) / 60;
  }

  /**
   * Apply MAX_HOURS_PER_DAY given hours already counted for the same member
   * and work date.
   */
  function capForDay(hours, alreadyCountedToday, cfg) {
    var room = Math.max(0, cfg.MAX_HOURS_PER_DAY - (alreadyCountedToday || 0));
    return Math.min(hours, room);
  }

  function countedHours(inTime, outTime, alreadyCountedToday, cfg) {
    var minutes = rawMinutes(inTime, outTime);
    return {
      rawMinutes: minutes,
      countedHours: capForDay(sessionHours(minutes, cfg), alreadyCountedToday, cfg),
    };
  }

  return {
    bangkokDate: bangkokDate,
    bangkokTime: bangkokTime,
    workDate: workDate,
    rawMinutes: rawMinutes,
    sessionHours: sessionHours,
    capForDay: capForDay,
    countedHours: countedHours,
  };
})();

if (typeof module !== 'undefined') module.exports = HHHours;
