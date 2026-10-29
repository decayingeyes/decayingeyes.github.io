/**
 * Scan rules (spec 5.7) and the signed lookup token that links scan.lookup
 * to scan.confirm. Pure: all data is passed in.
 */
var HHScan = (function () {
  function H() { return typeof HHHours !== 'undefined' ? HHHours : require('./hours'); }

  var TOKEN_TTL_MS = 2 * 60 * 1000;

  /**
   * Can `actor` scan members of `teamId` today, without a reason?
   * unit_admin/super_admin: any team in scope. head: own team.
   * Anyone (incl. deputy/head): teams granted in ScannerAssignments for today
   * (Date blank = every day; Shift blank = every shift).
   */
  function coversTeam(actor, teamId, assignments, workDate, shift) {
    if (actor.role === 'unit_admin' || actor.role === 'super_admin') return true;
    if (actor.role === 'head' && String(actor.teamId) === String(teamId)) return true;
    return (assignments || []).some(function (a) {
      if (String(a.StudentID) !== String(actor.studentId)) return false;
      if (String(a.UnitID) !== String(actor.unitId)) return false;
      if (String(a.TeamID) !== String(teamId)) return false;
      if (a.Date && String(a.Date) !== workDate) return false;
      if (a.Shift && shift && String(a.Shift) !== String(shift)) return false;
      return true;
    });
  }

  function inClosedPeriod(periods, unitId, workDate) {
    return (periods || []).some(function (p) {
      return String(p.UnitID) === String(unitId) && p.Status === 'CLOSED' &&
        String(p.StartDate) <= workDate && workDate <= String(p.EndDate);
    });
  }

  /**
   * Decide what a scan would do. Never writes anything.
   * @param {{
   *   actor: {studentId, role, unitId, teamId},
   *   member: Object,            Members row (StudentID, UnitID, TeamID, Shift, Status, CurrentState)
   *   now: Date,
   *   cfg: Object,
   *   assignments: Object[],     ScannerAssignments rows
   *   periods: Object[],         Periods rows
   *   schedules: Object[]|null,  Schedules rows for the unit (null/empty = schedules not used)
   *   lastScanAt: (Date|null),   last confirmed scan of this member by anyone
   *   openSessionIn: (Date|null) In time of the open session (for checkout preview)
   *   countedToday: number       hours already counted today (for checkout preview)
   *   method: 'BARCODE'|'MANUAL'
   * }} x
   * @return {{blocked: (string|null), action: (string|null), requiresReason: boolean,
   *           warnings: string[], flags: string[], workDate: string, previewHours: (number|null)}}
   */
  function decide(x) {
    var cfg = x.cfg;
    var m = x.member;
    var wd = H().workDate(x.now, cfg.WORKDAY_START_HOUR);
    var out = { blocked: null, action: null, requiresReason: false, warnings: [], flags: [], workDate: wd, previewHours: null };

    if (String(m.StudentID) === String(x.actor.studentId)) { out.blocked = 'SELF_SCAN'; return out; }
    if (m.Status !== 'ACTIVE') { out.blocked = 'MEMBER_DISABLED'; return out; }
    if (x.actor.role !== 'super_admin' && String(m.UnitID) !== String(x.actor.unitId)) { out.blocked = 'OTHER_UNIT'; return out; }
    if (inClosedPeriod(x.periods, m.UnitID, wd)) { out.blocked = 'PERIOD_CLOSED'; return out; }
    if (x.lastScanAt && x.now.getTime() - x.lastScanAt.getTime() < cfg.DUPLICATE_SCAN_SECONDS * 1000) {
      out.blocked = 'DUPLICATE_SCAN';
      return out;
    }

    out.action = m.CurrentState === 'IN' ? 'OUT' : 'IN';

    if (!coversTeam(x.actor, m.TeamID, x.assignments, wd, m.Shift)) {
      out.requiresReason = true;
      out.flags.push('OUT_OF_TEAM');
      out.warnings.push('สมาชิกคนนี้ไม่ได้อยู่ทีมที่คุณดูแล ต้องระบุเหตุผล');
    }
    if (x.method === 'MANUAL') out.flags.push('MANUAL');

    var schedules = x.schedules || [];
    if (out.action === 'IN' && schedules.length > 0) {
      var scheduled = schedules.some(function (s) {
        if (String(s.WorkDate) !== wd) return false;
        return String(s.StudentID) === String(m.StudentID) || (!s.StudentID && String(s.TeamID) === String(m.TeamID));
      });
      if (!scheduled) {
        out.flags.push('NOT_SCHEDULED');
        out.warnings.push('ไม่มีเวรวันนี้');
      }
    }

    if (out.action === 'OUT' && x.openSessionIn) {
      out.previewHours = H().countedHours(x.openSessionIn, x.now, x.countedToday || 0, cfg).countedHours;
    }
    return out;
  }

  // ---- lookup token: base64url(JSON payload) + "." + hex HMAC ----

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function utf8Bytes(s) {
    var out = [];
    var enc = unescape(encodeURIComponent(s));
    for (var i = 0; i < enc.length; i++) out.push(enc.charCodeAt(i));
    return out;
  }

  function utf8String(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(s));
  }

  function b64url(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63);
      if (i + 1 < bytes.length) out += B64.charAt((n >> 6) & 63);
      if (i + 2 < bytes.length) out += B64.charAt(n & 63);
    }
    return out;
  }

  function unb64url(s) {
    var bytes = [];
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < s.length; i++) {
      var v = B64.indexOf(s.charAt(i));
      if (v === -1) return null;
      buffer = (buffer << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    return bytes;
  }

  function hex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i] & 0xff;
      out += (b < 16 ? '0' : '') + b.toString(16);
    }
    return out;
  }

  /**
   * @param {{target, scanner, action, flags, method, requiresReason}} data
   * @param {function(string, string): number[]} hmacBytes
   */
  function signLookup(data, now, secret, hmacBytes) {
    var payload = b64url(utf8Bytes(JSON.stringify(Object.assign({}, data, { exp: now.getTime() + TOKEN_TTL_MS }))));
    return payload + '.' + hex(hmacBytes('lookup:' + secret, payload));
  }

  /** @return {Object|null} payload when signature is valid and not expired */
  function verifyLookup(token, now, secret, hmacBytes) {
    if (typeof token !== 'string') return null;
    var parts = token.split('.');
    if (parts.length !== 2) return null;
    var expected = hex(hmacBytes('lookup:' + secret, parts[0]));
    if (expected.length !== parts[1].length) return null;
    var diff = 0;
    for (var i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts[1].charCodeAt(i);
    if (diff !== 0) return null;
    var bytes = unb64url(parts[0]);
    if (!bytes) return null;
    var data;
    try { data = JSON.parse(utf8String(bytes)); } catch (e) { return null; }
    if (!data || typeof data.exp !== 'number' || now.getTime() > data.exp) return null;
    return data;
  }

  return {
    TOKEN_TTL_MS: TOKEN_TTL_MS,
    coversTeam: coversTeam,
    inClosedPeriod: inClosedPeriod,
    decide: decide,
    signLookup: signLookup,
    verifyLookup: verifyLookup,
  };
})();

if (typeof module !== 'undefined') module.exports = HHScan;
