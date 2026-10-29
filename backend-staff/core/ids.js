/**
 * Short random identifiers. `rand` is injectable for tests (defaults to Math.random).
 */
var HHIds = (function () {
  var ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

  function randomString(length, rand) {
    rand = rand || Math.random;
    var out = '';
    for (var i = 0; i < length; i++) {
      out += ALPHABET.charAt(Math.floor(rand() * ALPHABET.length));
    }
    return out;
  }

  /** Request id shown to users as "รหัสอ้างอิง", e.g. "r-k3x9a2mq". */
  function newRequestId(rand) {
    return 'r-' + randomString(8, rand);
  }

  return {
    randomString: randomString,
    newRequestId: newRequestId,
  };
})();

if (typeof module !== 'undefined') module.exports = HHIds;
