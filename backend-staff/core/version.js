/**
 * API version. Bump MINOR for new actions, MAJOR for breaking changes.
 * The frontend refuses to talk to a backend with a different MAJOR version.
 */
var HHVersion = {
  API_VERSION: '0.1.0',
};

if (typeof module !== 'undefined') module.exports = HHVersion;
