/**
 * Finish a login. Most people go straight in. Admins get one more screen:
 * sign in with their Google account (the first time links that account), or,
 * when Google sign-in is not configured, an authenticator app's 6-digit code.
 * Needs api.js and vendor/qrcode.js. Exposes HH2FA.finish.
 */
(function () {
  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function field(labelText, id, attrs) {
    var wrap = el('div');
    var label = el('label', '', labelText);
    label.htmlFor = id;
    var input = el('input');
    input.id = id;
    Object.keys(attrs).forEach(function (k) { input.setAttribute(k, attrs[k]); });
    wrap.appendChild(label);
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  function copyButton(label, getText, msg) {
    var b = el('button', 'btn secondary', label);
    b.type = 'button';
    b.addEventListener('click', function () {
      var done = function () { HH.say(msg, 'คัดลอกแล้ว', 'ok'); };
      var failed = function () { HH.say(msg, 'คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง', 'bad'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(getText()).then(done, failed);
      } else {
        failed();
      }
    });
    return b;
  }

  function screen(title) {
    var main = document.querySelector('main');
    main.textContent = '';
    main.appendChild(el('h1', '', title));
    return main;
  }

  /** The code form used by both first-time setup and everyday login. */
  function codeForm(main, ctx, stage) {
    var form = el('form');
    form.autocomplete = 'off';
    var code = field('รหัส 6 หลักจากแอป', 'tf-code', {
      inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7', required: 'required', pattern: '[0-9 ]*',
    });
    var btn = el('button', 'btn', 'ยืนยัน');
    btn.type = 'submit';
    var msg = el('p', 'msg');
    form.appendChild(code.wrap);
    form.appendChild(btn);
    form.appendChild(msg);
    main.appendChild(form);

    var usingRecovery = false;
    if (stage === 'verify') {
      var swap = el('button', 'link-btn', 'ทำโทรศัพท์หาย? ใช้รหัสสำรองแทน');
      swap.type = 'button';
      swap.addEventListener('click', function () {
        usingRecovery = !usingRecovery;
        code.wrap.querySelector('label').textContent = usingRecovery ? 'รหัสสำรอง (เช่น AB2C-DE3F)' : 'รหัส 6 หลักจากแอป';
        code.input.value = '';
        code.input.removeAttribute('pattern');
        code.input.setAttribute('maxlength', usingRecovery ? '12' : '7');
        code.input.setAttribute('inputmode', usingRecovery ? 'text' : 'numeric');
        if (!usingRecovery) code.input.setAttribute('pattern', '[0-9 ]*');
        swap.textContent = usingRecovery ? 'กลับไปใช้รหัสจากแอป' : 'ทำโทรศัพท์หาย? ใช้รหัสสำรองแทน';
        code.input.focus();
      });
      main.appendChild(swap);
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      HH.busy(btn, true, 'กำลังตรวจสอบ…');
      HH.say(msg, '');
      var payload = { challenge: ctx.challenge, studentId: ctx.studentId, userAgent: navigator.userAgent };
      if (usingRecovery) payload.recoveryCode = code.input.value;
      else payload.code = code.input.value;
      HH.call('auth.twoFactor', payload).then(function (res) {
        HH.busy(btn, false);
        if (!res.ok) {
          if (res.error.code === 'TWO_FACTOR_EXPIRED') { window.location.replace('login.html'); return; }
          HH.say(msg, HH.errorText(res), 'bad');
          code.input.value = '';
          code.input.focus();
          return;
        }
        afterLogin(res.data, ctx.next);
      });
    });
    // Setup keeps the page at the top: focusing here would scroll past the steps
    // and open the phone keyboard before they have read them.
    if (stage === 'verify') code.input.focus();
  }

  var GSI_SRC = 'https://accounts.google.com/gsi/client';

  function loadGoogle() {
    return new Promise(function (resolve, reject) {
      if (window.google && google.accounts && google.accounts.id) { resolve(); return; }
      var s = document.createElement('script');
      s.src = GSI_SRC;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('gsi')); };
      document.head.appendChild(s);
      setTimeout(function () { reject(new Error('timeout')); }, 15000);
    });
  }

  /** Apps like LINE and Facebook open links in their own browser, where Google refuses to sign in. */
  function inAppBrowser() {
    return /Line\/|FBAN|FBAV|Instagram|MicroMessenger|TikTok|; wv\)/i.test(navigator.userAgent);
  }

  function afterLogin(data, next) {
    HH.token.set(data.token);
    if (data.recoveryCodes) showRecoveryCodes(data.recoveryCodes, next);
    else if (data.recoveryCodesLeft !== undefined) showRecoveryLeft(data.recoveryCodesLeft, next);
    else if (data.linkedEmail) showLinked(data.linkedEmail, next);
    else window.location.replace(next);
  }

  function showGoogle(ctx, t) {
    if (t.hasApp && !t.linked) { showVerify(ctx); return; }
    var main = screen('ยืนยันตัวตนด้วย Google');
    if (t.linked) {
      main.appendChild(el('p', 'muted', 'บัญชีผู้ดูแลต้องยืนยันตัวตนอีกขั้น กดปุ่มด้านล่าง แล้วเลือกบัญชี Google ที่ผูกไว้ (' + t.linkedEmail + ')'));
    } else {
      main.appendChild(el('p', 'muted', 'บัญชีผู้ดูแลแก้ข้อมูลของคนอื่นได้ จึงต้องยืนยันตัวตนอีกขั้นด้วยบัญชี Google'));
      var steps = el('ol', 'steps');
      steps.appendChild(el('li', '', 'กดปุ่ม "ดำเนินการต่อด้วย Google" ด้านล่าง'));
      steps.appendChild(el('li', '', 'เลือกบัญชี Google ของตัวเอง (บัญชีที่ใช้ประจำ)'));
      steps.appendChild(el('li', '', 'ครั้งต่อไปต้องใช้บัญชีเดิมนี้ทุกครั้ง'));
      main.appendChild(steps);
    }
    var slot = el('div', 'google-slot');
    main.appendChild(slot);
    var msg = el('p', 'msg');
    main.appendChild(msg);

    if (inAppBrowser()) {
      main.appendChild(el('p', 'msg bad', 'หน้านี้เปิดอยู่ในแอป (เช่น LINE) ซึ่ง Google ไม่ยอมให้ยืนยันตัวตน กรุณากด ⋯ แล้วเลือก "เปิดใน Safari/Chrome"'));
    }
    if (t.hasApp) {
      var useApp = el('button', 'link-btn', 'ใช้รหัส 6 หลักจากแอปแทน');
      useApp.type = 'button';
      useApp.addEventListener('click', function () { showVerify(ctx); });
      main.appendChild(useApp);
    }

    HH.say(msg, 'กำลังโหลดปุ่ม Google…');
    loadGoogle().then(function () {
      HH.say(msg, '');
      google.accounts.id.initialize({
        client_id: t.clientId,
        nonce: t.nonce,
        auto_select: false,
        cancel_on_tap_outside: true,
        use_fedcm_for_button: true,
        callback: function (resp) {
          HH.say(msg, 'กำลังตรวจสอบ…');
          HH.call('auth.google', { challenge: ctx.challenge, credential: resp.credential, studentId: ctx.studentId, userAgent: navigator.userAgent })
            .then(function (res) {
              if (!res.ok) {
                if (res.error.code === 'TWO_FACTOR_EXPIRED') { window.location.replace('login.html'); return; }
                HH.say(msg, HH.errorText(res), 'bad');
                return;
              }
              afterLogin(res.data, ctx.next);
            });
        },
      });
      google.accounts.id.renderButton(slot, {
        type: 'standard', theme: 'filled_blue', size: 'large', shape: 'pill',
        text: 'continue_with', locale: 'th', width: Math.min(320, slot.clientWidth || 320),
      });
    }, function () {
      HH.say(msg, 'โหลดปุ่ม Google ไม่ได้ ตรวจอินเทอร์เน็ต หรือลองเปิดใน Safari/Chrome แล้วเข้าสู่ระบบใหม่', 'bad');
    });
  }

  function showLinked(email, next) {
    var main = screen('ผูกบัญชี Google แล้ว');
    main.appendChild(el('p', '', 'บัญชีผู้ดูแลนี้ผูกกับ ' + email + ' แล้ว'));
    main.appendChild(el('p', 'muted', 'ครั้งต่อไปให้เลือกบัญชีนี้ทุกครั้ง ถ้าต้องการเปลี่ยนบัญชี ให้ผู้ดูแลระบบสูงสุดล้างการยืนยันให้'));
    var go = el('button', 'btn', 'เข้าใช้งาน');
    go.type = 'button';
    go.addEventListener('click', function () { window.location.replace(next); });
    main.appendChild(go);
  }

  function showVerify(ctx) {
    var main = screen('ยืนยันตัวตนอีกขั้น');
    main.appendChild(el('p', 'muted', 'เปิดแอปยืนยันตัวตนบนโทรศัพท์ แล้วกรอกรหัส 6 หลักที่เห็นตอนนี้'));
    codeForm(main, ctx, 'verify');
  }

  function showEnroll(ctx, t) {
    var main = screen('ตั้งค่าความปลอดภัย');
    main.appendChild(el('p', 'muted', 'บัญชีผู้ดูแลแก้ข้อมูลของคนอื่นได้ จึงต้องยืนยันตัวตนอีกขั้น ตั้งค่าครั้งเดียว ใช้เวลาประมาณ 2 นาที'));

    var steps = el('ol', 'steps');
    steps.appendChild(el('li', '', 'ลงแอป Google Authenticator หรือ Microsoft Authenticator (ฟรี)'));
    steps.appendChild(el('li', '', 'ในแอป กดเพิ่มบัญชี แล้วสแกน QR นี้'));
    steps.appendChild(el('li', '', 'กรอกรหัส 6 หลักที่แอปแสดง'));
    main.appendChild(steps);

    var box = el('div', 'qr-box');
    var qr = qrcode(0, 'M');
    qr.addData(t.otpauth);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    main.appendChild(box);

    var other = el('details', 'card');
    other.appendChild(el('summary', '', 'ใช้โทรศัพท์เครื่องนี้เครื่องเดียว สแกนไม่ได้?'));
    var open = el('a', 'btn secondary', 'เปิดในแอปบนเครื่องนี้');
    open.href = t.otpauth;
    other.appendChild(open);
    other.appendChild(el('p', 'muted small', 'หรือคัดลอกคีย์นี้ไปวางในแอป'));
    other.appendChild(el('p', 'key-text', t.secret));
    var copyMsg = el('p', 'msg');
    other.appendChild(copyButton('คัดลอกคีย์', function () { return t.secret; }, copyMsg));
    other.appendChild(copyMsg);
    main.appendChild(other);

    codeForm(main, ctx, 'enroll');
  }

  /** Shown once. The way forward stays closed until they confirm the codes are saved. */
  function showRecoveryCodes(codes, next) {
    var main = screen('เก็บรหัสสำรองไว้');
    main.appendChild(el('p', '', 'ถ้าโทรศัพท์หาย ใช้รหัสเหล่านี้เข้าระบบแทนได้ รหัสละครั้ง ระบบจะแสดงหน้านี้ครั้งเดียว'));
    var list = el('ul', 'recovery-list');
    codes.forEach(function (c) { list.appendChild(el('li', '', c)); });
    main.appendChild(list);
    var copyMsg = el('p', 'msg');
    main.appendChild(copyButton('คัดลอกรหัสทั้งหมด', function () { return codes.join('\n'); }, copyMsg));
    main.appendChild(copyMsg);

    var check = el('label', 'check-row');
    var box = el('input');
    box.type = 'checkbox';
    box.id = 'tf-saved';
    check.appendChild(box);
    check.appendChild(el('span', '', 'ฉันเก็บรหัสสำรองไว้ในที่ปลอดภัยแล้ว'));
    main.appendChild(check);

    var go = el('button', 'btn', 'เข้าใช้งาน');
    go.type = 'button';
    go.disabled = true;
    box.addEventListener('change', function () { go.disabled = !box.checked; });
    go.addEventListener('click', function () { window.location.replace(next); });
    main.appendChild(go);
  }

  function showRecoveryLeft(left, next) {
    var main = screen('เข้าระบบด้วยรหัสสำรองแล้ว');
    main.appendChild(el('p', '', 'เหลือรหัสสำรองอีก ' + left + ' รหัส'));
    main.appendChild(el('p', 'muted', 'ถ้าโทรศัพท์หายจริง ให้ผู้ดูแลระบบสูงสุดล้างการยืนยัน แล้วตั้งค่ากับเครื่องใหม่'));
    var go = el('button', 'btn', 'เข้าใช้งาน');
    go.type = 'button';
    go.addEventListener('click', function () { window.location.replace(next); });
    main.appendChild(go);
  }

  /**
   * @param {Object} data successful response of auth.login or auth.activate
   * @param {string} studentId the id typed on the form
   * @param {string=} next page to open afterwards
   */
  function finish(data, studentId, next) {
    var target = next || 'portal.html';
    if (!data.twoFactor) {
      HH.token.set(data.token);
      window.location.replace(target);
      return;
    }
    var ctx = { challenge: data.twoFactor.challenge, studentId: studentId, next: target };
    if (data.twoFactor.stage === 'google') showGoogle(ctx, data.twoFactor);
    else if (data.twoFactor.stage === 'enroll') showEnroll(ctx, data.twoFactor);
    else showVerify(ctx);
  }

  window.HH2FA = { finish: finish };
})();
