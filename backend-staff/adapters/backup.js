/**
 * Daily copy of the whole spreadsheet into a private Drive folder, so a bad
 * edit or a wiped sheet can be recovered. Secrets stay in Script Properties,
 * which a copied file does not carry. Older copies move to Drive's trash.
 */
var HHBackup = (function () {
  var FOLDER_KEY = 'BACKUP_FOLDER_ID';

  function folder_() {
    var id = HHProps.get(FOLDER_KEY);
    if (id) {
      try {
        var existing = DriveApp.getFolderById(id);
        if (!existing.isTrashed()) return existing;
      } catch (e) {
        // Folder was removed: make a new one below.
      }
    }
    var made = DriveApp.createFolder('สำรองระบบสตาฟ ' + (HHProps.env() || ''));
    HHProps.set(FOLDER_KEY, made.getId());
    return made;
  }

  /** Newest first by creation time; everything past `keep` is removed. */
  function prune_(folder, keep) {
    var files = [];
    var it = folder.getFiles();
    while (it.hasNext()) files.push(it.next());
    files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
    var removed = 0;
    files.slice(keep).forEach(function (f) {
      f.setTrashed(true);
      removed++;
    });
    return removed;
  }

  /** @return {{name: string, removed: number, folderUrl: string}} */
  function run() {
    var folder = folder_();
    var stamp = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HHmm');
    var name = 'สำรอง ' + (HHProps.env() || '') + ' ' + stamp;
    DriveApp.getFileById(HHProps.get(HHProps.KEYS.SPREADSHEET_ID)).makeCopy(name, folder);
    var removed = prune_(folder, Math.max(1, HHConfig.get().BACKUP_KEEP_COPIES));
    HHLog.append({ requestId: HHIds.newRequestId(), action: 'BACKUP', actorId: 'SYSTEM', method: 'SYSTEM', note: name + '; removed ' + removed });
    return { name: name, removed: removed, folderUrl: folder.getUrl() };
  }

  return { run: run, ensureFolder: folder_ };
})();

/** Daily trigger. A failure throws, and Apps Script emails the owner. */
function backupTick() {
  HHBackup.run();
}
