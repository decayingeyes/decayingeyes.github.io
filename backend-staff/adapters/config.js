/**
 * Typed config from the `Config` sheet, cached in CacheService for 5 minutes.
 */
var HHConfig = (function () {
  var CACHE_KEY = 'config:v1';
  var CACHE_SECONDS = 300;
  var memo = null;

  function get() {
    if (memo) return memo;
    var cache = CacheService.getScriptCache();
    var hit = cache.get(CACHE_KEY);
    if (hit) {
      memo = JSON.parse(hit);
      return memo;
    }
    var sh = HHSheets.sheet('Config');
    var lastRow = sh.getLastRow();
    var rows = lastRow < 2 ? [] : sh.getRange(2, 1, lastRow - 1, 2).getValues();
    memo = HHConfigDefaults.build(rows);
    cache.put(CACHE_KEY, JSON.stringify(memo), CACHE_SECONDS);
    return memo;
  }

  function clearCache() {
    memo = null;
    CacheService.getScriptCache().remove(CACHE_KEY);
  }

  /** Add default rows for keys missing from the Config sheet. Never overwrites. */
  function ensureDefaults() {
    var sh = HHSheets.sheet('Config');
    var lastRow = sh.getLastRow();
    var existing = {};
    if (lastRow >= 2) {
      sh.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function (r) {
        existing[String(r[0]).trim()] = true;
      });
    }
    var toAdd = HHConfigDefaults.DEFAULTS
      .filter(function (d) { return !existing[d.key]; })
      .map(function (d) { return [d.key, d.value, d.description]; });
    if (toAdd.length > 0) {
      sh.getRange(sh.getLastRow() + 1, 1, toAdd.length, 3).setValues(toAdd);
    }
    clearCache();
    return toAdd.length;
  }

  return {
    get: get,
    clearCache: clearCache,
    ensureDefaults: ensureDefaults,
  };
})();
