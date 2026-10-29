/**
 * Config keys, defaults and type coercion. Values live in the `Config` sheet;
 * missing or blank values fall back to these defaults.
 * Hour-counting defaults are placeholders until organizers confirm (docs/OPEN-QUESTIONS.md).
 */
var HHConfigDefaults = (function () {
  // type: 'int' | 'number' | 'string' | 'bool' | 'optionalNumber' (blank -> null)
  var DEFAULTS = [
    { key: 'EVENT_NAME', value: 'บ้านผีสิง', type: 'string', description: 'ชื่องาน/แผนกที่แสดงบนบัตรและหน้าเว็บ' },
    { key: 'WORKDAY_START_HOUR', value: 5, type: 'int', description: 'วันทำงานเริ่มนับตอนกี่โมง (รองรับงานเลยเที่ยงคืน)' },
    { key: 'ROUNDING_MINUTES', value: 30, type: 'int', description: 'ปัดชั่วโมงที่นับลงทีละกี่นาที' },
    { key: 'MIN_SESSION_MINUTES', value: 30, type: 'int', description: 'อยู่น้อยกว่านี้ (นาที) นับเป็น 0 ชม.' },
    { key: 'MAX_HOURS_PER_DAY', value: 12, type: 'number', description: 'นับได้สูงสุดกี่ ชม. ต่อคนต่อวัน' },
    { key: 'POINTS_PER_HOUR', value: '', type: 'optionalNumber', description: 'แต้มต่อชั่วโมง (เว้นว่าง = ไม่แสดงแต้ม)' },
    { key: 'AUTO_CLOSE_HOUR', value: '', type: 'optionalNumber', description: 'เวลาปิดรายการที่ลืมสแกนออก (เว้นว่าง = ใช้ WORKDAY_START_HOUR)' },
    { key: 'LATE_MINUTES', value: 15, type: 'int', description: 'มาหลังเวลาเริ่มเวรกี่นาทีถือว่าสาย' },
    { key: 'MAX_OPEN_HOURS', value: 12, type: 'number', description: 'สแกนเข้าค้างเกินกี่ ชม. ให้แจ้งเตือนหัวหน้า' },
    { key: 'DUPLICATE_SCAN_SECONDS', value: 60, type: 'int', description: 'สแกนคนเดิมซ้ำภายในกี่วินาทีให้ข้าม' },
    { key: 'SESSION_DAYS_MEMBER', value: 7, type: 'number', description: 'สมาชิกล็อกอินค้างได้กี่วัน' },
    { key: 'SESSION_HOURS_SCANNER', value: 12, type: 'number', description: 'ผู้สแกน/แอดมินล็อกอินค้างได้กี่ชั่วโมง' },
    { key: 'LOGIN_MAX_FAILURES', value: 5, type: 'int', description: 'ใส่รหัสผิดได้กี่ครั้งก่อนล็อก' },
    { key: 'LOGIN_LOCK_MINUTES', value: 10, type: 'int', description: 'ล็อกการเข้าสู่ระบบกี่นาที' },
    { key: 'PASSWORD_MIN_LENGTH', value: 8, type: 'int', description: 'รหัสผ่านอย่างน้อยกี่ตัวอักษร' },
    { key: 'PASSWORD_HASH_ROUNDS', value: 1000, type: 'int', description: 'จำนวนรอบการแฮชรหัสผ่าน (อย่าลดลง)' },
    { key: 'SIGNUP_JOIN_CODE', value: '', type: 'string', description: 'รหัสกลางเข้าร่วมงาน: ใส่ตอนสมัครแล้วเข้าใช้ได้ทันที (เว้นว่าง = ต้องรอแอดมินอนุมัติทุกคน) — เปลี่ยนได้ที่หน้าแอดมิน' },
  ];

  function coerce(raw, type, fallback) {
    var blank = raw === undefined || raw === null || String(raw).trim() === '';
    if (type === 'optionalNumber') {
      if (blank) return null;
      var n0 = Number(raw);
      return isFinite(n0) ? n0 : null;
    }
    if (blank) return fallback;
    if (type === 'int' || type === 'number') {
      var n = Number(raw);
      if (!isFinite(n)) return fallback;
      return type === 'int' ? Math.floor(n) : n;
    }
    if (type === 'bool') {
      if (raw === true || raw === false) return raw;
      return /^(true|yes|1|ใช่)$/i.test(String(raw).trim());
    }
    return String(raw);
  }

  /**
   * Build a typed config object from Config sheet rows ([key, value, ...]).
   * Unknown keys are kept as strings so new settings can be added without code changes.
   */
  function build(rows) {
    var given = {};
    (rows || []).forEach(function (row) {
      if (row && row[0] !== undefined && String(row[0]).trim() !== '') {
        given[String(row[0]).trim()] = row[1];
      }
    });
    var out = {};
    DEFAULTS.forEach(function (d) {
      var fallback = d.type === 'optionalNumber' ? null : d.value;
      out[d.key] = coerce(given[d.key], d.type, fallback);
    });
    Object.keys(given).forEach(function (k) {
      if (!(k in out)) out[k] = given[k] === undefined || given[k] === null ? '' : String(given[k]);
    });
    if (out.AUTO_CLOSE_HOUR === null) out.AUTO_CLOSE_HOUR = out.WORKDAY_START_HOUR;
    return out;
  }

  return {
    DEFAULTS: DEFAULTS,
    coerce: coerce,
    build: build,
  };
})();

if (typeof module !== 'undefined') module.exports = HHConfigDefaults;
