/**
 * Row-level helpers on top of HHSheets: find rows by a key column and update
 * individual fields in place. Rows are returned with their 1-based sheet row.
 */
var HHRepo = (function () {
  function colIndex(sheetName, header) {
    var i = HHSchema.headers(sheetName).indexOf(header);
    if (i === -1) throw new Error('Unknown column ' + sheetName + '.' + header);
    return i + 1;
  }

  /** @return {Array<{row: number, data: Object}>} */
  function all(sheetName) {
    return HHSheets.readAll(sheetName).map(function (data, i) { return { row: i + 2, data: data }; });
  }

  function findBy(sheetName, header, value) {
    var target = String(value);
    var rows = all(sheetName);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].data[header]) === target) return rows[i];
    }
    return null;
  }

  /** Write several fields of one row. Keys must be headers of the sheet. */
  function update(sheetName, row, fields) {
    var sh = HHSheets.sheet(sheetName);
    Object.keys(fields).forEach(function (h) {
      var cell = sh.getRange(row, colIndex(sheetName, h));
      var v = fields[h] === null || fields[h] === undefined ? '' : fields[h];
      cell.setValue(v);
      // Cells written later (e.g. Out) do not inherit the row's date-time format.
      if (v instanceof Date) cell.setNumberFormat(HHSchema.DATETIME_FORMAT);
    });
  }

  /** Append many objects at once (one write call, column formats applied). Caller holds the lock. */
  function appendMany(sheetName, objs) {
    if (objs.length === 0) return;
    HHSheets.writeRows(sheetName, HHSheets.sheet(sheetName).getLastRow() + 1, objs);
  }

  return {
    all: all,
    findBy: findBy,
    update: update,
    appendMany: appendMany,
  };
})();
