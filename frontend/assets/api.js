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
  // Role is cached only to draw the menu; every action is still checked by the server.
  var roleKey = 'hh.role.' + env;

  function rememberRole(action, res) {
    if (!res || !res.ok || !res.data) return;
    var role = null;
    if (action === 'auth.login' || action === 'auth.activate' || action === 'auth.me') role = res.data.profile && res.data.profile.role;
    if (action === 'me.card') role = res.data.role;
    if (role) {
      var changed = storage.get(roleKey) !== role;
      storage.set(roleKey, role);
      if (changed) renderNav();
    }
  }

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
        if (res && !res.ok && res.error && res.error.code === 'UNAUTHENTICATED') {
          storage.remove(tokenKey);
          storage.remove(roleKey);
        }
        rememberRole(action, res);
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

  /**
   * Add a show/hide toggle to password inputs and warn when Thai characters
   * are typed (a Thai keyboard layout silently turns "demo1234" into Thai letters).
   */
  function enhancePasswords() {
    var inputs = document.querySelectorAll('input[type="password"]');
    Array.prototype.forEach.call(inputs, function (input) {
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'pw-toggle';
      toggle.textContent = 'แสดง';
      toggle.addEventListener('click', function () {
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        toggle.textContent = show ? 'ซ่อน' : 'แสดง';
      });
      var warn = document.createElement('p');
      warn.className = 'warn pw-warn';
      warn.hidden = true;
      warn.textContent = '⚠️ แป้นพิมพ์เป็นภาษาไทยอยู่ กรุณาสลับเป็นภาษาอังกฤษ';
      input.addEventListener('input', function () {
        warn.hidden = !/[฀-๿]/.test(input.value);
      });
      var wrap = document.createElement('div');
      wrap.className = 'pw-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      wrap.appendChild(toggle);
      wrap.parentNode.insertBefore(warn, wrap.nextSibling);
    });
  }

  document.addEventListener('DOMContentLoaded', enhancePasswords);

  // ---- bottom navigation: one app, menu items by role ----
  var RANK = { member: 1, deputy: 2, head: 3, unit_admin: 4, super_admin: 5 };
  var NAV = [
    { href: 'portal.html', icon: '🪪', label: 'บัตรของฉัน', minRank: 1 },
    { href: 'scan.html', icon: '📷', label: 'สแกน', minRank: 2 },
    { href: 'team.html', icon: '👥', label: 'ทีม', minRank: 2 },
    { href: 'admin.html', icon: '🛠️', label: 'แอดมิน', minRank: 4 },
  ];

  function renderNav() {
    if (!document.body) return;
    var path = window.location.pathname;
    var inApp = path.indexOf('/staff/') !== -1 && !/\/(login|activate)\.html$/.test(path);
    var old = document.getElementById('hh-nav');
    if (old) old.remove();
    if (!inApp || !storage.get(tokenKey)) return;
    var rank = RANK[storage.get(roleKey)] || 1;
    var items = NAV.filter(function (n) { return rank >= n.minRank; });
    if (items.length < 2) return; // members only have their card: no menu needed
    var nav = document.createElement('nav');
    nav.id = 'hh-nav';
    nav.className = 'bottom-nav no-print';
    items.forEach(function (n) {
      var a = document.createElement('a');
      a.href = n.href;
      if (path.slice(-n.href.length) === n.href) a.className = 'on';
      var i = document.createElement('span');
      i.className = 'ico';
      i.textContent = n.icon;
      var t = document.createElement('span');
      t.textContent = n.label;
      a.appendChild(i);
      a.appendChild(t);
      nav.appendChild(a);
    });
    document.body.appendChild(nav);
    document.body.classList.add('has-nav');
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderNav();
    // First visit after an update: learn the role so the menu can appear.
    if (storage.get(tokenKey) && !storage.get(roleKey) && window.location.pathname.indexOf('/staff/') !== -1) {
      call('auth.me');
    }
  });

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
      clear: function () { storage.remove(tokenKey); storage.remove(roleKey); },
    },
  };
})();
