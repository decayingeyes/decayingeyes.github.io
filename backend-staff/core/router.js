/**
 * Request parsing, auth gate and response envelope. Pure: every side effect
 * (session lookup, handlers, error logging) is injected through `deps`.
 */
var HHRouter = (function () {
  // Apps Script shares one global scope across files; Node needs require().
  function E() { return typeof HHErrors !== 'undefined' ? HHErrors : require('./errors'); }
  function P() { return typeof HHPermissions !== 'undefined' ? HHPermissions : require('./permissions'); }
  function V() { return typeof HHVersion !== 'undefined' ? HHVersion : require('./version'); }

  var MAX_BODY_CHARS = 100000;
  var ACTION_PATTERN = /^[a-z]+(\.[a-zA-Z]+)*$/;

  /**
   * Parse the raw POST body: JSON string `{ action, payload?, token? }`.
   * Client-sent timestamps or identity fields are never read from here;
   * identity comes only from the token.
   */
  function parseRequest(rawBody) {
    var AppError = E().AppError;
    if (typeof rawBody !== 'string' || rawBody.length === 0) {
      throw new AppError('BAD_REQUEST', null, 'empty body');
    }
    if (rawBody.length > MAX_BODY_CHARS) {
      throw new AppError('BAD_REQUEST', null, 'body too large');
    }
    var body;
    try {
      body = JSON.parse(rawBody);
    } catch (e) {
      throw new AppError('BAD_REQUEST', null, 'invalid JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new AppError('BAD_REQUEST', null, 'body must be an object');
    }
    if (typeof body.action !== 'string' || !ACTION_PATTERN.test(body.action)) {
      throw new AppError('BAD_REQUEST', null, 'invalid action');
    }
    var payload = body.payload === undefined || body.payload === null ? {} : body.payload;
    if (typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AppError('BAD_REQUEST', null, 'payload must be an object');
    }
    var token = typeof body.token === 'string' && body.token.length > 0 ? body.token : null;
    return { action: body.action, payload: payload, token: token };
  }

  function envelope(ok, dataOrError, requestId, env) {
    var res = { ok: ok, requestId: requestId, apiVersion: V().API_VERSION, env: env };
    if (ok) res.data = dataOrError === undefined ? null : dataOrError;
    else res.error = dataOrError;
    return res;
  }

  /**
   * Handle one API call end to end.
   * @param {string} rawBody
   * @param {{
   *   env: string,
   *   newRequestId: function(): string,
   *   resolveSession: function(string): ({studentId:string, role:string, unitId:string}|null),
   *   handlers: Object<string, function(Object, Object): *>,
   *   logError: function(Object): void,
   * }} deps
   * @return {Object} response envelope
   */
  function handle(rawBody, deps) {
    var requestId = deps.newRequestId();
    var action = null;
    var actor = null;
    var AppError = E().AppError;
    try {
      var req = parseRequest(rawBody);
      action = req.action;
      if (!P().isKnownAction(action)) throw new AppError('UNKNOWN_ACTION', null, action);
      var handler = deps.handlers[action];
      if (typeof handler !== 'function') throw new AppError('NOT_IMPLEMENTED', null, action);

      if (!P().isPublic(action)) {
        actor = req.token ? deps.resolveSession(req.token) : null;
        if (!actor) throw new AppError('UNAUTHENTICATED');
        var verdict = P().check(action, actor.role);
        if (!verdict.allowed) throw new AppError(verdict.reason, null, action + ' as ' + actor.role);
      }

      var data = handler(req.payload, { actor: actor, requestId: requestId, token: req.token });
      return envelope(true, data, requestId, deps.env);
    } catch (err) {
      var pub = E().toPublic(err);
      try {
        deps.logError({
          requestId: requestId,
          action: action,
          studentId: actor ? actor.studentId : '',
          code: pub.code,
          message: err && err.message ? String(err.message) : String(err),
          stack: err && err.stack ? String(err.stack) : '',
        });
      } catch (logErr) {
        // Logging must never break the response.
      }
      return envelope(false, pub, requestId, deps.env);
    }
  }

  return {
    MAX_BODY_CHARS: MAX_BODY_CHARS,
    parseRequest: parseRequest,
    envelope: envelope,
    handle: handle,
  };
})();

if (typeof module !== 'undefined') module.exports = HHRouter;
