/**
 * Spreadsheet menu for one-time setup and maintenance. The script is bound to
 * the env's spreadsheet (one bound project for TEST, one for PROD).
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎃 ระบบสตาฟ')
    .addItem('ตั้งค่าเป็นโหมดทดสอบ (TEST)', 'menuSetupTest')
    .addItem('ตั้งค่าเป็นโหมดใช้งานจริง (PROD)', 'menuSetupProd')
    .addSeparator()
    .addItem('นำเข้ารายชื่อจากชีต RosterImport', 'menuImportRoster')
    .addItem('ออกรหัสเปิดใช้งาน (รายคน)', 'menuIssueCode')
    .addItem('สร้างข้อมูลตัวอย่าง (เฉพาะ TEST)', 'menuSeedTest')
    .addSeparator()
    .addItem('ตรวจสอบโครงสร้างชีต', 'menuValidateSchema')
    .addItem('ดูสถานะระบบ', 'menuShowStatus')
    .addToUi();
}

var ROSTER_SHEET = 'RosterImport';
var CODES_SHEET = 'รหัสเปิดใช้งาน (ลบหลังแจกเสร็จ)';

/**
 * Import from a scratch sheet. First run creates the sheet with a header row
 * for the admin to paste into.
 */
function menuImportRoster() {
  var ui = SpreadsheetApp.getUi();
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sh = book.getSheetByName(ROSTER_SHEET);
  if (!sh) {
    sh = book.insertSheet(ROSTER_SHEET);
    sh.getRange(1, 1, 1, 9).setValues([['StudentID', 'FirstName', 'LastName', 'Nickname', 'Unit', 'Department', 'Team', 'Shift', 'Role']])
      .setFontWeight('bold');
    sh.getRange('A:A').setNumberFormat('@'); // keep leading zeros in student ids
    ui.alert('สร้างชีต "' + ROSTER_SHEET + '" แล้ว\nวางรายชื่อใต้หัวตาราง แล้วกดเมนูนี้อีกครั้ง\n(Role เว้นว่าง = member; ใช้ได้: member, deputy, head, unit_admin)');
    return;
  }
  var table = sh.getDataRange().getDisplayValues();
  var result = HHAccounts.importRoster(table, { unitId: null, actorId: 'OWNER', requestId: HHIds.newRequestId() });
  HHOrg.clearCache();
  writeCodes_(result.codes);
  var msg = 'นำเข้าแล้ว: ใหม่ ' + result.inserted + ' คน, อัปเดต ' + result.updated + ' คน';
  if (result.codes.length > 0) msg += '\nรหัสเปิดใช้งานอยู่ในชีต "' + CODES_SHEET + '"';
  if (result.errors.length > 0) {
    msg += '\n\n⚠️ ข้ามไป ' + result.errors.length + ' แถว:\n' + result.errors.slice(0, 15).map(function (e) {
      return (e.line ? 'บรรทัด ' + e.line : e.studentId) + ': ' + e.messageTh;
    }).join('\n');
  }
  ui.alert(msg);
}

function menuIssueCode() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('ออกรหัสเปิดใช้งานใหม่', 'รหัสนักศึกษา:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  try {
    var c = HHAccounts.issueCode(r.getResponseText(), null, HHIds.newRequestId());
    ui.alert(c.studentId + ' (' + c.nickname + ')\nรหัสเปิดใช้งาน: ' + c.code + '\n\nรหัสเดิมที่ยังไม่ได้ใช้จะใช้ไม่ได้แล้ว');
  } catch (e) {
    ui.alert(HHErrors.toPublic(e).messageTh);
  }
}

function writeCodes_(codes) {
  if (codes.length === 0) return;
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sh = book.getSheetByName(CODES_SHEET) || book.insertSheet(CODES_SHEET);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 5).setValues([['ออกเมื่อ', 'StudentID', 'ชื่อเล่น', 'ทีม', 'รหัสเปิดใช้งาน']]).setFontWeight('bold');
  }
  var now = new Date();
  var rows = codes.map(function (c) { return [now, c.studentId, c.nickname, c.team, c.code]; });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
}

function menuSetupTest() { setupAs_('TEST'); }
function menuSetupProd() { setupAs_('PROD'); }

/**
 * Bind this script to its spreadsheet as TEST or PROD, create secrets,
 * create sheets/headers and default Config rows. Safe to run again.
 */
function setupAs_(env) {
  var ui = SpreadsheetApp.getUi();
  var current = HHProps.env();
  if (current && current !== env) {
    ui.alert('ไฟล์นี้ถูกตั้งเป็น ' + current + ' ไปแล้ว\nเปลี่ยนโหมดไม่ได้ (ป้องกันข้อมูลทดสอบปนกับข้อมูลจริง)');
    return;
  }
  if (!current && env === 'PROD') {
    var answer = ui.alert('ยืนยันตั้งไฟล์นี้เป็น "ใช้งานจริง (PROD)"?', ui.ButtonSet.YES_NO);
    if (answer !== ui.Button.YES) return;
  }
  var book = SpreadsheetApp.getActiveSpreadsheet();
  book.setSpreadsheetTimeZone('Asia/Bangkok'); // new files default to the creator's locale; timestamps must display in Thai time
  HHProps.set(HHProps.KEYS.ENV, env);
  HHProps.set(HHProps.KEYS.SPREADSHEET_ID, book.getId());
  HHProps.ensureSecret(HHProps.KEYS.HMAC_SECRET);
  HHProps.ensureSecret(HHProps.KEYS.PASSWORD_PEPPER);

  var result = HHSheets.ensureSchema();
  var added = HHConfig.ensureDefaults();

  var msg = 'ตั้งค่าเสร็จแล้ว: โหมด ' + env +
    '\nสร้างชีตใหม่ ' + result.created.length + ' แผ่น, เพิ่มค่า Config ' + added + ' รายการ';
  if (result.problems.length > 0) {
    msg += '\n\n⚠️ พบปัญหาหัวตาราง:\n' + result.problems.join('\n');
  }
  ui.alert(msg);
}

function menuValidateSchema() {
  HHSheets.clearSchemaCache();
  var problems = HHSheets.validateSchema();
  SpreadsheetApp.getUi().alert(problems.length === 0
    ? '✅ โครงสร้างชีตถูกต้องครบทุกแผ่น'
    : '⚠️ พบปัญหา:\n' + problems.join('\n'));
}

function menuShowStatus() {
  var h = handleHealth_();
  SpreadsheetApp.getUi().alert(
    'โหมด: ' + h.env +
    '\nเวอร์ชัน API: ' + h.apiVersion +
    '\nเวลาเซิร์ฟเวอร์: ' + h.serverTimeTh +
    '\nตั้งค่าแล้ว: ' + (h.configured ? 'ใช่' : 'ยัง') +
    '\nโครงสร้างชีต: ' + (h.schemaOk ? 'ถูกต้อง' : 'มีปัญหา/ยังไม่สร้าง'));
}
