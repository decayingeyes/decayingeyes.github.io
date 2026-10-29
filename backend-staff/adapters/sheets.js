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

  /** All data rows as objects keyed by header. */
  function readAll(name) {
    var sh = sheet(name);
    var lastRow = sh.getLastRow();
    var headers = HHSchema.headers(name);
    if (lastRow < 2) return [];
    var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
    return values.map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
  }

  /** Append one object as a row, in header order. Unknown keys are ignored. */
  function append(name, obj) {
    var headers = HHSchema.headers(name);
    var row = headers.map(function (h) {
      return obj[h] === undefined || obj[h] === null ? '' : obj[h];
    });
    sheet(name).appendRow(row);
  }

  return {
    ss: ss,
    sheet: sheet,
    validateSchema: validateSchema,
    schemaOk: schemaOk,
    clearSchemaCache: clearSchemaCache,
    ensureSchema: ensureSchema,
    readAll: readAll,
    append: append,
  };
})();
