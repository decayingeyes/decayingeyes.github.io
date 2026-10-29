/**
 * Google Sheets wrapper: open the env spreadsheet, validate/create the schema,
 * and read/append rows as objects keyed by header.
 */
var HHSheets = (function () {
  var cachedSs = null;
  var SCHEMA_CACHE_KEY = 'schema-ok:v1';

  function ss() {
    if (cachedSs) return cachedSs;
    var id = HHProps.get(HHProps.KEYS.SPREADSHEET_ID);
    if (!id) throw new HHErrors.AppError('NOT_CONFIGURED', null, 'SPREADSHEET_ID missing');
    cachedSs = SpreadsheetApp.openById(id);
    return cachedSs;
  }

  function sheet(name) {
    var sh = ss().getSheetByName(name);
    if (!sh) throw new HHErrors.AppError('SCHEMA_INVALID', null, 'missing sheet ' + name);
    return sh;
  }

  function headerRow(sh) {
    var lastCol = sh.getLastColumn();
    if (lastCol === 0) return [];
    return sh.getRange(1, 1, 1, lastCol).getValues()[0];
  }

  /** @return {string[]} problems across all sheets, empty if OK */
  function validateSchema() {
    var problems = [];
    var book = ss();
    HHSchema.sheetNames().forEach(function (name) {
      var sh = book.getSheetByName(name);
      if (!sh) {
        problems.push('Missing sheet: ' + name);
        return;
      }
      problems = problems.concat(HHSchema.compareHeaders(name, headerRow(sh)));
    });
    return problems;
  }

  /** Cached schema check used on each request (cheap after the first call). */
  function schemaOk() {
    var cache = CacheService.getScriptCache();
    if (cache.get(SCHEMA_CACHE_KEY) === '1') return true;
    var ok = validateSchema().length === 0;
    if (ok) cache.put(SCHEMA_CACHE_KEY, '1', 600);
    return ok;
  }

  function clearSchemaCache() {
    CacheService.getScriptCache().remove(SCHEMA_CACHE_KEY);
  }

  /**
   * Create missing sheets and write headers on empty ones. Never overwrites a
   * sheet that already has a header row; mismatches are returned as problems.
   * @return {{created: string[], problems: string[]}}
   */
  function ensureSchema() {
    var book = ss();
    var created = [];
    var problems = [];
    HHSchema.sheetNames().forEach(function (name) {
      var headers = HHSchema.headers(name);
      var sh = book.getSheetByName(name);
      if (!sh) {
        sh = book.insertSheet(name);
        created.push(name);
      }
      if (sh.getLastRow() === 0) {
        sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
        sh.setFrozenRows(1);
        protectHeader_(sh, headers.length);
      } else {
        addMissingTrailingHeaders_(sh, headers);
        problems = problems.concat(HHSchema.compareHeaders(name, headerRow(sh)));
      }
      HHSchema.textColumnIndexes(name).forEach(function (col) {
        sh.getRange(2, col, sh.getMaxRows() - 1, 1).setNumberFormat('@');
      });
      HHSchema.datetimeColumnIndexes(name).forEach(function (col) {
        sh.getRange(2, col, sh.getMaxRows() - 1, 1).setNumberFormat(HHSchema.DATETIME_FORMAT);
      });
    });
    removeDefaultSheet_(book, created);
    clearSchemaCache();
    return { created: created, problems: problems };
  }

  /**
   * Migration for columns added at the end of a sheet's schema: when the
   * existing header row matches the start of the expected headers, append the
   * missing ones. Never reorders or renames existing columns.
   */
  function addMissingTrailingHeaders_(sh, headers) {
    var actual = headerRow(sh).map(function (h) { return String(h).trim(); });
    while (actual.length > 0 && actual[actual.length - 1] === '') actual.pop();
    if (actual.length >= headers.length) return;
    for (var i = 0; i < actual.length; i++) if (actual[i] !== headers[i]) return;
    var missing = headers.slice(actual.length);
    sh.getRange(1, actual.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
      if (p.getDescription() === 'Header (do not edit)') p.remove();
    });
    protectHeader_(sh, headers.length);
  }

  function protectHeader_(sh, width) {
    var p = sh.getRange(1, 1, 1, width).protect().setDescription('Header (do not edit)');
    p.removeEditors(p.getEditors());
    if (p.canDomainEdit()) p.setDomainEdit(false);
  }

  /** Delete the blank "Sheet1"/"ชีต1" that a new spreadsheet starts with. */
  function removeDefaultSheet_(book, created) {
    if (created.length === 0) return;
    book.getSheets().forEach(function (sh) {
      var isSchemaSheet = HHSchema.headers(sh.getName()) !== null;
      if (!isSchemaSheet && sh.getLastRow() === 0 && sh.getLastColumn() === 0 && book.getSheets().length > 1) {
        book.deleteSheet(sh);
      }
    });
  }

  var DATE_TEXT_COLUMNS = ['WorkDate', 'Date', 'StartDate', 'EndDate'];

  /**
   * Neutralise formula injection: user text starting with = + - @ would be
   * evaluated by Sheets (e.g. =IMPORTXML(...) leaking data when the owner opens
   * the file). A leading apostrophe stores it as literal text; reads return the
   * text without the apostrophe.
   */
  function safe(v) {
    return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
  }

  /**
   * Text columns may still hold a Date or number if Sheets auto-converted them
   * (e.g. rows written before the column was formatted). Read them back as text.
   */
  function asText_(header, v) {
    if (v instanceof Date) {
      return DATE_TEXT_COLUMNS.indexOf(header) !== -1
        ? Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd')
        : Utilities.formatDate(v, 'Asia/Bangkok', 'HH:mm');
    }
    return v === '' || v === null || v === undefined ? '' : String(v);
  }

  /** All data rows as objects keyed by header. */
  function readAll(name) {
    var sh = sheet(name);
    var lastRow = sh.getLastRow();
    var headers = HHSchema.headers(name);
    if (lastRow < 2) return [];
    var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
    var isText = headers.map(function (h) { return HHSchema.TEXT_COLUMNS.indexOf(h) !== -1; });
    return values.map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = isText[i] ? asText_(h, row[i]) : row[i]; });
      return obj;
    });
  }

  /**
   * Write rows starting at `startRow`, setting each column's number format first.
   * appendRow() ignores column formats and lets Sheets guess types, which turned
   * "2026-10-29" into a Date and student ids into numbers.
   */
  function writeRows(name, startRow, rows) {
    if (rows.length === 0) return;
    var headers = HHSchema.headers(name);
    var formats = headers.map(function (h) {
      if (HHSchema.TEXT_COLUMNS.indexOf(h) !== -1) return '@';
      if (HHSchema.DATETIME_COLUMNS.indexOf(h) !== -1) return HHSchema.DATETIME_FORMAT;
      return 'General';
    });
    var values = rows.map(function (o) {
      return headers.map(function (h, i) {
        var v = o[h] === undefined || o[h] === null ? '' : o[h];
        return safe(formats[i] === '@' && !(v instanceof Date) ? String(v) : v);
      });
    });
    var range = sheet(name).getRange(startRow, 1, values.length, headers.length);
    range.setNumberFormats(values.map(function () { return formats; }));
    range.setValues(values);
  }

  /** Append one object as a row, in header order. Unknown keys are ignored. */
  function append(name, obj) {
    var lock = LockService.getScriptLock();
    var mine = !lock.hasLock();
    if (mine && !lock.tryLock(10000)) throw new HHErrors.AppError('BUSY', null, 'append lock');
    try {
      writeRows(name, sheet(name).getLastRow() + 1, [obj]);
    } finally {
      if (mine) lock.releaseLock();
    }
  }

  return {
    ss: ss,
    sheet: sheet,
    validateSchema: validateSchema,
    schemaOk: schemaOk,
    clearSchemaCache: clearSchemaCache,
    ensureSchema: ensureSchema,
    readAll: readAll,
    safe: safe,
    writeRows: writeRows,
    append: append,
  };
})();
