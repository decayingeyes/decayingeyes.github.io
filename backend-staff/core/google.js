/**
 * Google sign-in as the admins' second login step (owner decision 2026-11-03,
 * replacing the authenticator app as the main way in). The browser gets an ID
 * token from Google; the backend asks Google whether it is genuine (tokeninfo)
 * and then checks the claims here. Pure JS so the rules can be tested offline.
 */
var HHGoogle = (function () {
  var ISSUERS = { 'accounts.google.com': true, 'https://accounts.google.com': true };
  // A few seconds of tolerance for clocks that are slightly apart.
  var CLOCK_SKEW_SECONDS = 60;

  /**
   * @param {Object} claims what tokeninfo returned for the ID token
   * @param {{clientId: string, nonce: string, nowSeconds: number}} expect
   * @return {{ok: boolean, sub: (string|null), email: (string|null), reason: (string|null)}}
   */
  function checkClaims(claims, expect) {
    function no(reason) { return { ok: false, sub: null, email: null, reason: reason }; }
    if (!claims || typeof claims !== 'object') return no('no-claims');
    if (!expect || !expect.clientId) return no('no-client-id');
    if (String(claims.aud || '') !== String(expect.clientId)) return no('aud');
    if (!ISSUERS[String(claims.iss || '')]) return no('iss');
    var exp = Number(claims.exp);
    if (!isFinite(exp) || exp + CLOCK_SKEW_SECONDS < expect.nowSeconds) return no('expired');
    // Ties the token to this login attempt, so a token from elsewhere cannot be replayed.
    if (!expect.nonce || String(claims.nonce || '') !== String(expect.nonce)) return no('nonce');
    var sub = String(claims.sub || '');
    if (!/^[0-9]{1,64}$/.test(sub)) return no('sub');
    var verified = claims.email_verified === true || String(claims.email_verified) === 'true';
    var email = String(claims.email || '').toLowerCase();
    if (!email || !verified) return no('email');
    return { ok: true, sub: sub, email: email, reason: null };
  }

  /** "someone@gmail.com" -> "so•••@gmail.com", enough for the owner to recognise it. */
  function maskEmail(email) {
    var s = String(email || '');
    var at = s.indexOf('@');
    if (at < 1) return '';
    return s.slice(0, Math.min(2, at)) + '•••' + s.slice(at);
  }

  return { checkClaims: checkClaims, maskEmail: maskEmail };
})();

if (typeof module !== 'undefined') module.exports = HHGoogle;
