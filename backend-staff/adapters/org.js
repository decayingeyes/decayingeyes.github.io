/**
 * Unit/Department/Team name lookup, cached for 5 minutes.
 */
var HHOrg = (function () {
  var CACHE_KEY = 'org:v1';
  var memo = null;

  function load_() {
    if (memo) return memo;
    var cache = CacheService.getScriptCache();
    var hit = cache.get(CACHE_KEY);
    if (hit) {
      memo = JSON.parse(hit);
      return memo;
    }
    memo = { units: {}, depts: {}, teams: {} };
    HHSheets.readAll('Units').forEach(function (u) { memo.units[u.UnitID] = { name: String(u.Name) }; });
    HHSheets.readAll('Departments').forEach(function (d) {
      memo.depts[d.DeptID] = { name: String(d.Name), color: String(d.Color || '#888888') };
    });
    HHSheets.readAll('Teams').forEach(function (t) { memo.teams[t.TeamID] = { name: String(t.Name), deptId: String(t.DeptID) }; });
    cache.put(CACHE_KEY, JSON.stringify(memo), 300);
    return memo;
  }

  function clearCache() {
    memo = null;
    CacheService.getScriptCache().remove(CACHE_KEY);
  }

  /** Names for a Members row. */
  function names(m) {
    var o = load_();
    var u = o.units[m.UnitID] || { name: '' };
    var d = o.depts[m.DeptID] || { name: '', color: '#888888' };
    var t = o.teams[m.TeamID] || { name: '' };
    return { unit: u.name, dept: d.name, color: d.color, team: t.name };
  }

  return { names: names, clearCache: clearCache };
})();
