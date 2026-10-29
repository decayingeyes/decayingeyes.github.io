/**
 * Crypto primitives for core logic, backed by Apps Script Utilities.
 */
var HHCrypto = (function () {
  var pool = [];

  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i] & 0xff;
      out += (b < 16 ? '0' : '') + b.toString(16);
    }
    return out;
  }

  function sha256Hex(s) {
    return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
  }

  function hmacBytes(key, message) {
    return Utilities.computeHmacSha256Signature(message, key, Utilities.Charset.UTF_8);
  }

  /** Random byte from SecureRandom-backed UUIDs, hashed to remove fixed version bits. */
  function randomByte_() {
    if (pool.length === 0) {
      pool = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid())
        .map(function (b) { return b & 0xff; });
    }
    return pool.pop();
  }

  /** Uniform integer in [0, n) for n <= 256 (rejection sampling). */
  function randInt(n) {
    var limit = Math.floor(256 / n) * n;
    var b;
    do { b = randomByte_(); } while (b >= limit);
    return b % n;
  }

  /** 64 hex chars for session tokens. */
  function newToken() {
    return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  }

  return {
    sha256Hex: sha256Hex,
    hmacBytes: hmacBytes,
    randInt: randInt,
    newToken: newToken,
  };
})();
