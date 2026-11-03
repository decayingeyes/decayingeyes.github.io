/**
 * Asks Google whether an ID token from the sign-in button is genuine. Google's
 * tokeninfo endpoint checks the signature and expiry and returns the claims;
 * HHGoogle.checkClaims then checks they were issued for this site and this login.
 */
var HHGoogleAuth = (function () {
  var TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo?id_token=';

  /** @return {Object|null} the claims, or null when Google rejects the token */
  function tokenInfo(idToken) {
    var t = String(idToken || '');
    if (!/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(t) || t.length > 4096) return null;
    var res = UrlFetchApp.fetch(TOKENINFO + encodeURIComponent(t), { muteHttpExceptions: true, followRedirects: false });
    if (res.getResponseCode() !== 200) return null;
    try {
      return JSON.parse(res.getContentText());
    } catch (e) {
      return null;
    }
  }

  return { tokenInfo: tokenInfo };
})();
