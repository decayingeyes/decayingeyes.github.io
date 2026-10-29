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
    ],
    Reports: ['ReportID', 'UnitID', 'StudentID', 'WorkDate', 'Message', 'Status', 'ResolvedBy', 'ResolvedNote'],
    // Spec lists "StudentID or TeamID" as one column; split into two (one is filled). See CHANGELOG.
    Schedules: ['ScheduleID', 'UnitID', 'StudentID', 'TeamID', 'WorkDate', 'Shift', 'ExpectedStart', 'ExpectedEnd'],
    Periods: ['PeriodID', 'UnitID', 'StartDate', 'EndDate', 'Status', 'ClosedBy', 'ClosedAt', 'ExportLink', 'ReopenReason'],
    Alerts: ['AlertID', 'UnitID', 'Type', 'StudentID', 'Detail', 'CreatedAt', 'Status'],
    DashboardCache: ['UnitID', 'Metric', 'Key', 'Value', 'UpdatedAt'],
    Errors: ['Timestamp', 'Env', 'RequestId', 'Action', 'StudentID', 'Code', 'Message', 'Stack'],
  };

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
    sheetNames: sheetNames,
    headers: headers,
    compareHeaders: compareHeaders,
  };
})();

if (typeof module !== 'undefined') module.exports = HHSchema;
