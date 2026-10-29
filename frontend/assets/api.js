/**
 * Shared frontend helpers: env selection, API calls, test banner, safe storage.
 * Loaded after config.js. Exposes window.HH.
 */
(function () {
  var cfg = window.HH_CONFIG;

  var storage = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    remove: function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* private mode */ } },
  };

  function currentEnv() {
    var fromUrl = new URLSearchParams(window.location.search).get('env');
    if (fromUrl === 'test' || fromUrl === 'prod') {
      storage.set('hh.env', fromUrl);
      return fromUrl;
    }
    var saved = storage.get('hh.env');
    return saved === 'test' || saved === 'prod' ? saved : cfg.defaultEnv;
  }

  var env = currentEnv();
  var tokenKey = 'hh.token.' + env; // separate login per env

  function apiUrl() {
    return (cfg.envs[env] && cfg.envs[env].apiUrl) || '';
  }

  /**
   * Call one backend action. Always resolves to the response envelope;
   * network failures become { ok:false, error:{ code:'NETWORK', messageTh } }.
   */
  function call(action, payload) {
    var url = apiUrl();
    if (!url) {
      return Promise.resolve({ ok: false, error: { code: 'NOT_CONFIGURED', messageTh: 'ยังไม่ได้ใส่ที่อยู่ระบบหลังบ้านใน config.js' } });
    }
    var body = { action: action, payload: payload || {} };
    var token = storage.get(tokenKey);
    if (token) body.token = token;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
      body: JSON.stringify(body),
      redirect: 'follow',
    })
      .then(function (res) { return res.json(); })
      .then(function (res) {
        if (res && res.apiVersion && Number(String(res.apiVersion).split('.')[0]) !== cfg.apiMajor) {
          return { ok: false, requestId: res.requestId, error: { code: 'VERSION_MISMATCH', messageTh: 'เวอร์ชันหน้าเว็บไม่ตรงกับระบบ กรุณารีเฟรชหน้า' } };
        }
        if (res && !res.ok && res.error && res.error.code === 'UNAUTHENTICATED') storage.remove(tokenKey);
        return res;
      })
      .catch(function () {
        return { ok: false, error: { code: 'NETWORK', messageTh: 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่' } };
      });
  }

  /** Thai error text including the reference id users can report. */
  function errorText(res) {
    var msg = (res && res.error && res.error.messageTh) || 'เกิดข้อผิดพลาด';
    return res && res.requestId ? msg + ' (รหัสอ้างอิง: ' + res.requestId + ')' : msg;
  }

  function showTestBanner() {
    if (env !== 'test') return;
    var b = document.createElement('div');
    b.className = 'test-banner';
    b.textContent = 'โหมดทดสอบ';
    document.body.insertBefore(b, document.body.firstChild);
  }

  document.addEventListener('DOMContentLoaded', showTestBanner);

  /** Path prefix back to the site root, so pages in staff/ can link to ../ */
  function rootPath() {
    return window.location.pathname.indexOf('/staff/') !== -1 ? '../' : './';
  }

  /** Redirect to login when there is no token. Returns false if redirected. */
  function requireLogin() {
    if (storage.get(tokenKey)) return true;
    window.location.replace(rootPath() + 'staff/login.html');
    return false;
  }

  /** Show a Thai message in an element; kind = 'bad' | 'ok' | 'muted'. */
  function say(el, text, kind) {
    el.className = kind || 'muted';
    el.textContent = text;
  }

  /** Disable a button while a call is in flight. */
  function busy(button, isBusy, label) {
    if (isBusy) {
      button.dataset.label = button.textContent;
      button.textContent = label || 'กำลังดำเนินการ…';
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
    }
  }

  window.HH = {
    env: env,
    call: call,
    errorText: errorText,
    storage: storage,
    requireLogin: requireLogin,
    rootPath: rootPath,
    say: say,
    busy: busy,
    token: {
      get: function () { return storage.get(tokenKey); },
      set: function (t) { storage.set(tokenKey, t); },
      clear: function () { storage.remove(tokenKey); },
    },
  };
})();
