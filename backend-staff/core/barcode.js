/**
 * Official personal barcode (spec 5.4).
 * Payload: "<studentId>-<check>", check = first 4 base32 chars of
 * HMAC-SHA256(secret, studentId + ":" + codeVersion).
 * `hmacBytes(key, message)` is injected and returns an array of byte values
 * (0..255 or signed -128..127; both are accepted).
 */
var HHBarcode = (function () {
  var BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  var CHECK_LENGTH = 4;
  var PAYLOAD_PATTERN = /^([0-9A-Za-z]{4,20})-([A-Z2-7]{4})$/;

  function base32(bytes) {
    var out = '';
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < bytes.length; i++) {
      buffer = (buffer << 8) | (bytes[i] & 0xff);
      bits += 8;
      while (bits >= 5) {
        out += BASE32.charAt((buffer >>> (bits - 5)) & 31);
        bits -= 5;
      }
      buffer &= (1 << bits) - 1;
    }
    if (bits > 0) out += BASE32.charAt((buffer << (5 - bits)) & 31);
    return out;
  }

  function check(studentId, codeVersion, secret, hmacBytes) {
    return base32(hmacBytes(secret, studentId + ':' + codeVersion)).slice(0, CHECK_LENGTH);
  }

  function payload(studentId, codeVersion, secret, hmacBytes) {
    return studentId + '-' + check(studentId, codeVersion, secret, hmacBytes);
  }

  /**
   * Split a scanned string. Does not verify the check (needs CodeVersion from the roster).
   * @return {{studentId: string, check: string}|null}
   */
  function parse(scanned) {
    var m = PAYLOAD_PATTERN.exec(String(scanned || '').trim().toUpperCase());
    return m ? { studentId: m[1], check: m[2] } : null;
  }

  /** True if `scanned` is the current valid code for this member. */
  function verify(scanned, studentId, codeVersion, secret, hmacBytes) {
    var p = parse(scanned);
    if (!p || p.studentId !== String(studentId).toUpperCase()) return false;
    return p.check === check(studentId, codeVersion, secret, hmacBytes);
  }

  return {
    base32: base32,
    check: check,
    payload: payload,
    parse: parse,
    verify: verify,
  };
})();

if (typeof module !== 'undefined') module.exports = HHBarcode;
