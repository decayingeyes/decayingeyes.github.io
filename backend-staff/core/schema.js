/**
 * Spreadsheet data model (spec section 6). Sheet name -> ordered header list.
 * Do not change without an entry in docs/CHANGELOG.md.
 */
var HHSchema = (function () {
  var SHEETS = {
    Config: ['Key', 'Value', 'Description'],
    Units: ['UnitID', 'Name', 'Active'],
    Departments: ['DeptID', 'UnitID', 'Name', 'Color'],
    Teams: ['TeamID', 'UnitID', 'DeptID', 'Name'],
    Members: [
      'StudentID', 'UnitID', 'DeptID', 'TeamID', 'FirstName', 'LastName', 'Nickname',
      'Shift', 'Role', 'PasswordHash', 'Salt', 'ActivationCodeHash', 'ActivatedAt',
      'CodeVersion', 'Status', 'CurrentState', 'OpenSessionID',
    ],
    ScannerAssignments: ['StudentID', 'UnitID', 'TeamID', 'Date', 'Shift', 'GrantedBy', 'GrantedAt'],
    AuthSessions: ['Token', 'StudentID', 'CreatedAt', 'ExpiresAt', 'UserAgent'],
    Log: [
      'Timestamp', 'RequestId', 'UnitID', 'StudentID', 'Action', 'ActorID',
      'Method', 'Flags', 'Reason', 'Note',
    ],
    WorkSessions: [
      'SessionID', 'UnitID', 'StudentID', 'WorkDate', 'In', 'Out', 'RawMinutes',
      'CountedHours', 'ScannedInBy', 'ScannedOutBy', 'Status', 'Locked', 'Note',
    ],
    Corrections: [
      'CorrectionID', 'UnitID', 'TargetStudentID', 'SessionID', 'ProposedIn', 'ProposedOut',
      'Reason', 'ProposedBy', 'ProposedAt', 'Status', 'ReviewedBy', 'ReviewedAt', 'ReviewNote',
      // Added after spec v4 (see CHANGELOG): CORRECTION | SELF_REPORT, and the session's work date.
      'Type', 'WorkDate', 'ReportID',
    ],
    Reports: ['ReportID', 'UnitID', 'StudentID', 'WorkDate', 'Message', 'Status', 'ResolvedBy', 'ResolvedNote'],
    // Spec lists "StudentID or TeamID" as one column; split into two (one is filled). See CHANGELOG.
    Schedules: ['ScheduleID', 'UnitID', 'StudentID', 'TeamID', 'WorkDate', 'Shift', 'ExpectedStart', 'ExpectedEnd'],
    Periods: ['PeriodID', 'UnitID', 'StartDate', 'EndDate', 'Status', 'ClosedBy', 'ClosedAt', 'ExportLink', 'ReopenReason'],
    Alerts: ['AlertID', 'UnitID', 'Type', 'StudentID', 'Detail', 'CreatedAt', 'Status'],
    DashboardCache: ['UnitID', 'Metric', 'Key', 'Value', 'UpdatedAt'],
    Errors: ['Timestamp', 'Env', 'RequestId', 'Action', 'StudentID', 'Code', 'Message', 'Stack'],
  };

  /**
   * Columns stored as plain text so Sheets does not auto-convert them
   * (leading zeros in student ids, "2026-10-31" turning into a Date).
   */
  var TEXT_COLUMNS = ['StudentID', 'TargetStudentID', 'ActorID', 'ScannedInBy', 'ScannedOutBy', 'ProposedBy',
    'ReviewedBy', 'ResolvedBy', 'GrantedBy', 'ClosedBy', 'WorkDate', 'Date', 'StartDate', 'EndDate',
    'Shift', 'ExpectedStart', 'ExpectedEnd', 'Key', 'Value'];

  /** Columns holding Date values; shown with date AND time (Sheets defaults to date only). */
  var DATETIME_COLUMNS = ['Timestamp', 'In', 'Out', 'CreatedAt', 'ExpiresAt', 'ActivatedAt', 'GrantedAt',
    'ProposedIn', 'ProposedOut', 'ProposedAt', 'ReviewedAt', 'ClosedAt', 'UpdatedAt'];
  var DATETIME_FORMAT = 'yyyy-mm-dd hh:mm:ss';

  function datetimeColumnIndexes(sheetName) {
    var h = SHEETS[sheetName] || [];
    var out = [];
    h.forEach(function (name, i) { if (DATETIME_COLUMNS.indexOf(name) !== -1) out.push(i + 1); });
    return out;
  }

  function textColumnIndexes(sheetName) {
    var h = SHEETS[sheetName] || [];
    var out = [];
    h.forEach(function (name, i) { if (TEXT_COLUMNS.indexOf(name) !== -1) out.push(i + 1); });
    return out;
  }

  function sheetNames() {
    return Object.keys(SHEETS);
  }

  function headers(sheetName) {
    return SHEETS[sheetName] ? SHEETS[sheetName].slice() : null;
  }

  /**
   * Compare an actual header row with the expected one.
   * Extra trailing columns are allowed (admins may add notes on the right).
   * @return {string[]} problems, empty if OK
   */
  function compareHeaders(sheetName, actual) {
    var expected = SHEETS[sheetName];
    if (!expected) return ['Unknown sheet: ' + sheetName];
    var problems = [];
    for (var i = 0; i < expected.length; i++) {
      var got = actual && actual[i] !== undefined ? String(actual[i]).trim() : '';
      if (got !== expected[i]) {
        problems.push(sheetName + ' column ' + (i + 1) + ': expected "' + expected[i] + '", found "' + got + '"');
      }
    }
    return problems;
  }

  return {
    SHEETS: SHEETS,
    TEXT_COLUMNS: TEXT_COLUMNS,
    textColumnIndexes: textColumnIndexes,
    DATETIME_COLUMNS: DATETIME_COLUMNS,
    DATETIME_FORMAT: DATETIME_FORMAT,
    datetimeColumnIndexes: datetimeColumnIndexes,
    sheetNames: sheetNames,
    headers: headers,
    compareHeaders: compareHeaders,
  };
})();

if (typeof module !== 'undefined') module.exports = HHSchema;
