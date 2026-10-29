/**
 * Application errors with stable codes and Thai user-facing messages.
 * Pure JS: no Apps Script globals.
 */
var HHErrors = (function () {
  var MESSAGES_TH = {
    BAD_REQUEST: 'คำขอไม่ถูกต้อง',
    UNKNOWN_ACTION: 'ไม่รู้จักคำสั่งนี้',
    NOT_IMPLEMENTED: 'ฟังก์ชันนี้ยังไม่เปิดใช้งาน',
    UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบใหม่',
    FORBIDDEN: 'คุณไม่มีสิทธิ์ทำรายการนี้',
    BUSY: 'ระบบกำลังทำงานหนัก กรุณาลองใหม่อีกครั้ง',
    NOT_CONFIGURED: 'ระบบยังไม่ได้ตั้งค่า กรุณาแจ้งผู้ดูแลระบบ',
    SCHEMA_INVALID: 'โครงสร้างฐานข้อมูลไม่ถูกต้อง กรุณาแจ้งผู้ดูแลระบบ',
    VALIDATION: 'ข้อมูลไม่ถูกต้อง',
    NOT_FOUND: 'ไม่พบข้อมูล',
    LOGIN_FAILED: 'รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง',
    ACTIVATION_FAILED: 'รหัสนักศึกษาหรือรหัสเปิดใช้งานไม่ถูกต้อง',
    LOCKED: 'ใส่ผิดหลายครั้งเกินไป กรุณารอ 10 นาทีแล้วลองใหม่',
    INTERNAL: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่หรือแจ้งผู้ดูแลระบบ',
  };

  /**
   * @param {string} code      key of MESSAGES_TH (or a new code with messageTh)
   * @param {string=} messageTh override the default Thai message
   * @param {string=} detail    developer detail, logged but never sent to clients
   */
  function AppError(code, messageTh, detail) {
    this.name = 'AppError';
    this.code = code;
    this.messageTh = messageTh || MESSAGES_TH[code] || MESSAGES_TH.INTERNAL;
    this.message = code + (detail ? ': ' + detail : '');
    this.stack = new Error(this.message).stack;
  }
  AppError.prototype = Object.create(Error.prototype);
  AppError.prototype.constructor = AppError;

  function isAppError(err) {
    return !!err && err.name === 'AppError' && typeof err.code === 'string';
  }

  /** Error shape safe to send to clients. Unknown errors never leak details. */
  function toPublic(err) {
    if (isAppError(err)) return { code: err.code, messageTh: err.messageTh };
    return { code: 'INTERNAL', messageTh: MESSAGES_TH.INTERNAL };
  }

  return {
    MESSAGES_TH: MESSAGES_TH,
    AppError: AppError,
    isAppError: isAppError,
    toPublic: toPublic,
  };
})();

if (typeof module !== 'undefined') module.exports = HHErrors;
