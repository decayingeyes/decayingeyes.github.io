/**
 * Card photos in the `Photos` sheet (one small JPEG data URL per member),
 * cached per member. Reads never fail the caller: no sheet / no photo -> null.
 */
var HHPhotos = (function () {
  var CACHE_SECONDS = 21600;

  function key_(sid) { return 'photo:' + sid; }

  function get(studentId) {
    var sid = String(studentId);
    var cache = CacheService.getScriptCache();
    var hit = cache.get(key_(sid));
    if (hit !== null) return hit === 'none' ? null : hit;
    var photo = null;
    try {
      var row = HHRepo.findBy('Photos', 'StudentID', sid);
      photo = row && row.data.Photo ? String(row.data.Photo) : null;
    } catch (e) {
      return null; // sheet not created yet (setup not re-run)
    }
    try { cache.put(key_(sid), photo || 'none', CACHE_SECONDS); } catch (e) { /* value too large for cache */ }
    return photo;
  }

  /** Student ids that have a photo (for list badges). */
  function idsWithPhoto(unitId) {
    var out = {};
    try {
      HHSheets.readAll('Photos').forEach(function (p) {
        if (p.Photo && String(p.UnitID) === String(unitId)) out[String(p.StudentID)] = true;
      });
    } catch (e) { /* no sheet yet */ }
    return out;
  }

  /** Set or remove (dataUrl '') a photo. Caller holds the lock. */
  function set(member, dataUrl, actorId) {
    var sid = String(member.StudentID);
    var row = HHRepo.findBy('Photos', 'StudentID', sid);
    var fields = { StudentID: sid, UnitID: member.UnitID, Photo: dataUrl, UpdatedAt: new Date(), UpdatedBy: actorId };
    if (row) HHRepo.update('Photos', row.row, { Photo: dataUrl, UpdatedAt: fields.UpdatedAt, UpdatedBy: actorId });
    else if (dataUrl) HHSheets.append('Photos', fields);
    CacheService.getScriptCache().remove(key_(sid));
  }

  return { get: get, set: set, idsWithPhoto: idsWithPhoto };
})();
