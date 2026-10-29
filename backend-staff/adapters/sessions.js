/**
 * Login sessions in `AuthSessions`. Only a SHA-256 of the token is stored,
 * so a leaked sheet cannot be used to log in. Lookups are cached briefly;
 * role/status always come from the current Members row.
 */
var HHSessions = (function () {
  var CACHE_SECONDS = 600;

  function cacheKey_(tokenHash) {
    return 'sess:' + tokenHash;
  }

  /** Create a session for a member row; returns the raw token (shown to the client once). */
  function create(member, userAgent) {
    var cfg = HHConfig.get();
    var token = HHCrypto.newToken();
    var now = new Date();
    HHSheets.append('AuthSessions', {
      Token: HHCrypto.sha256Hex(token),
      StudentID: member.StudentID,
      CreatedAt: now,
      ExpiresAt: HHAuth.sessionExpiry(member.Role, now, cfg),
      UserAgent: String(userAgent || '').slice(0, 200),
    });
    return token;
  }

  /**
   * Resolve a raw token to the acting member, or null.
   * @return {{studentId, role, unitId, teamId, deptId, nickname}|null}
   */
  function resolve(token) {
    if (!token || typeof token !== 'string' || token.length > 128) return null;
    var hash = HHCrypto.sha256Hex(token);
    var cache = CacheService.getScriptCache();
    var hit = cache.get(cacheKey_(hash));
    if (hit === 'none') return null;
    if (hit) {
      var c = JSON.parse(hit);
      // A role/status change bumps the member's epoch, invalidating cached actors at once.
      var epoch = Number(cache.get(epochKey_(c.actor.studentId)) || 0);
      if (new Date(c.expiresAt) > new Date() && (c.cachedAt || 0) >= epoch) return c.actor;
      cache.remove(cacheKey_(hash));
      if (new Date(c.expiresAt) <= new Date()) return null;
    }
    var s = HHRepo.findBy('AuthSessions', 'Token', hash);
    var actor = null;
    var expiresAt = null;
    if (s && new Date(s.data.ExpiresAt) > new Date()) {
      var m = HHRepo.findBy('Members', 'StudentID', s.data.StudentID);
      if (m && m.data.Status === 'ACTIVE') {
        actor = toActor_(m.data);
        expiresAt = new Date(s.data.ExpiresAt);
      }
    }
    if (actor) {
      cache.put(cacheKey_(hash), JSON.stringify({ actor: actor, expiresAt: expiresAt.toISOString(), cachedAt: Date.now() }), CACHE_SECONDS);
    } else {
      cache.put(cacheKey_(hash), 'none', 60);
    }
    return actor;
  }

  function epochKey_(studentId) {
    return 'epoch:' + studentId;
  }

  /** Make every cached login of this member re-read role/status on the next request. */
  function invalidateMember(studentId) {
    CacheService.getScriptCache().put(epochKey_(String(studentId)), String(Date.now()), 21600);
  }

  function revoke(token) {
    var hash = HHCrypto.sha256Hex(token);
    var s = HHRepo.findBy('AuthSessions', 'Token', hash);
    if (s) HHRepo.update('AuthSessions', s.row, { ExpiresAt: new Date() });
    CacheService.getScriptCache().remove(cacheKey_(hash));
  }

  function toActor_(m) {
    return {
      studentId: String(m.StudentID),
      role: String(m.Role),
      unitId: String(m.UnitID),
      deptId: String(m.DeptID),
      teamId: String(m.TeamID),
      nickname: String(m.Nickname),
    };
  }

  return {
    create: create,
    resolve: resolve,
    revoke: revoke,
    invalidateMember: invalidateMember,
    toActor: toActor_,
  };
})();
