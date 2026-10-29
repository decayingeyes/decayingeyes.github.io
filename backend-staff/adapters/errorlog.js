/**
 * Writes API errors to the `Errors` sheet (spec 5.15). Falls back to the
 * Apps Script execution log if the sheet is unavailable.
 */
var HHErrorLog = (function () {
  var MAX_STACK_CHARS = 1500;

  function write(entry) {
    var row = {
      Timestamp: new Date(),
      Env: HHProps.env() || '',
      RequestId: entry.requestId || '',
      Action: entry.action || '',
      StudentID: entry.studentId || '',
      Code: entry.code || '',
      Message: String(entry.message || '').slice(0, 500),
      Stack: String(entry.stack || '').slice(0, MAX_STACK_CHARS),
    };
    try {
      HHSheets.append('Errors', row);
    } catch (e) {
      console.error('Errors sheet unavailable', JSON.stringify(row), e);
    }
  }

  return { write: write };
})();
