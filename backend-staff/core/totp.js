/**
 * Time-based one-time codes (RFC 6238) for the second login step, compatible
 * with Google/Microsoft Authenticator: SHA-1, 6 digits, 30-second steps.
 * Pure JS. HMAC and randomness are injected:
 *   hmacSha1(keyBytes, messageBytes) -> byte array
 *   randInt(n)                       -> integer in [0, n), cryptographically random in production
 */
var HHTotp = (function () {
  var BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  var STEP_SECONDS = 30;
  var DIGITS = 6;
  var SECRET_BYTES = 20;
  // One step either side tolerates a phone clock that is slightly off.
  var WINDOW = 1;
  // No 0/O/1/I/L so recovery codes can be copied by hand without confusion.
  var RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var RECOVERY_COUNT = 8;

  function base32Encode(bytes) {
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

  function base32Decode(text) {
    var clean = String(text || '').toUpperCase().replace(/[\s=-]/g, '');
    var out = [];
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < clean.length; i++) {
      var v = BASE32.indexOf(clean.charAt(i));
      if (v === -1) throw new Error('invalid base32');
      buffer = (buffer << 5) | v;
      bits += 5;
      if (bits >= 8) {
        out.push((buffer >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
      buffer &= (1 << bits) - 1;
    }
    return out;
  }

  function newSecret(randInt) {
    var bytes = [];
    for (var i = 0; i < SECRET_BYTES; i++) bytes.push(randInt(256));
    return base32Encode(bytes);
  }

  function counterBytes_(counter) {
    var out = [0, 0, 0, 0, 0, 0, 0, 0];
    var c = counter;
    for (var i = 7; i >= 0; i--) {
      out[i] = c % 256;
      c = Math.floor(c / 256);
    }
    return out;
  }

  /** The code for one time step, as a zero-padded string. */
  function codeAt(secretB32, counter, hmacSha1, digits) {
    var mac = hmacSha1(base32Decode(secretB32), counterBytes_(counter)).map(function (b) { return b & 0xff; });
    var offset = mac[mac.length - 1] & 0x0f;
    var value = ((mac[offset] & 0x7f) * 16777216) + (mac[offset + 1] << 16) + (mac[offset + 2] << 8) + mac[offset + 3];
    var size = digits || DIGITS;
    var text = String(value % Math.pow(10, size));
    while (text.length < size) text = '0' + text;
    return text;
  }

  /**
   * Check a typed code. Counters at or below lastCounter are refused, so a code
   * seen over someone's shoulder cannot be used a second time.
   * @return {{ok: boolean, counter: (number|null)}}
   */
  function verify(secretB32, given, nowMs, lastCounter, hmacSha1) {
    var code = String(given === undefined || given === null ? '' : given).replace(/\s/g, '');
    if (!/^[0-9]{6}$/.test(code)) return { ok: false, counter: null };
    var current = Math.floor(nowMs / 1000 / STEP_SECONDS);
    var last = Number(lastCounter) || 0;
    for (var d = -WINDOW; d <= WINDOW; d++) {
      var c = current + d;
      if (c > last && codeAt(secretB32, c, hmacSha1) === code) return { ok: true, counter: c };
    }
    return { ok: false, counter: null };
  }

  /** Link that opens or fills an authenticator app, and the content of the setup QR. */
  function otpauthUri(secretB32, account, issuer) {
    var label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
    return 'otpauth://totp/' + label + '?secret=' + secretB32 + '&issuer=' + encodeURIComponent(issuer) +
      '&algorithm=SHA1&digits=' + DIGITS + '&period=' + STEP_SECONDS;
  }

  /**
   * Scramble the secret before it goes in the sheet, so an editor who can read
   * the sheet cannot copy it into their own app. The key lives in Script Properties.
   */
  function keystream_(key, length, sha256Hex) {
    var hex = '';
    for (var block = 0; hex.length < length * 2; block++) hex += sha256Hex('totp:' + key + ':' + block);
    return hex;
  }

  function seal(secretB32, key, sha256Hex) {
    var stream = keystream_(key, secretB32.length, sha256Hex);
    var out = '';
    for (var i = 0; i < secretB32.length; i++) {
      var b = secretB32.charCodeAt(i) ^ parseInt(stream.substr(i * 2, 2), 16);
      out += (b < 16 ? '0' : '') + b.toString(16);
    }
    return out;
  }

  function unseal(sealedHex, key, sha256Hex) {
    var text = String(sealedHex || '');
    var length = text.length / 2;
    var stream = keystream_(key, length, sha256Hex);
    var out = '';
    for (var i = 0; i < length; i++) {
      out += String.fromCharCode(parseInt(text.substr(i * 2, 2), 16) ^ parseInt(stream.substr(i * 2, 2), 16));
    }
    return out;
  }

  /** One-time codes for a lost phone, shown once as XXXX-XXXX. */
  function newRecoveryCodes(randInt) {
    var codes = [];
    for (var n = 0; n < RECOVERY_COUNT; n++) {
      var c = '';
      for (var i = 0; i < 8; i++) c += RECOVERY_ALPHABET.charAt(randInt(RECOVERY_ALPHABET.length));
      codes.push(c.slice(0, 4) + '-' + c.slice(4));
    }
    return codes;
  }

  function hashRecoveryCode(code, pepper, sha256Hex) {
    return sha256Hex('rec:' + pepper + ':' + String(code || '').toUpperCase().replace(/[\s-]/g, ''));
  }

  return {
    RECOVERY_COUNT: RECOVERY_COUNT,
    base32Encode: base32Encode,
    base32Decode: base32Decode,
    newSecret: newSecret,
    codeAt: codeAt,
    verify: verify,
    otpauthUri: otpauthUri,
    seal: seal,
    unseal: unseal,
    newRecoveryCodes: newRecoveryCodes,
    hashRecoveryCode: hashRecoveryCode,
  };
})();

if (typeof module !== 'undefined') module.exports = HHTotp;
