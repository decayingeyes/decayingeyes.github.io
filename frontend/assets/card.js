/**
 * Member card rendering (spec 5.5): HTML version for the screen and a
 * PNG version (canvas) the member can save to their phone for offline use.
 * Requires JsBarcode. Barcode is Code 128, black on pure white with quiet zones.
 */
(function () {
  var BARCODE_OPTS = { format: 'CODE128', displayValue: false, margin: 0, background: '#ffffff', lineColor: '#000000' };

  function bandText(c) {
    return c.deptName + (c.teamName ? ' · ' + c.teamName : '');
  }

  function renderHtml(c) {
    document.getElementById('c-event').textContent = c.eventName + (c.unitName ? ' — ' + c.unitName : '');
    document.getElementById('c-nick').textContent = c.nickname;
    document.getElementById('c-name').textContent = c.firstName + ' ' + c.lastName;
    document.getElementById('c-sid').textContent = c.studentId;
    var band = document.getElementById('c-band');
    band.textContent = bandText(c);
    band.style.background = c.deptColor;
    JsBarcode('#c-barcode', c.barcode, Object.assign({ width: 3, height: 110 }, BARCODE_OPTS));
  }

  function fitText(ctx, text, maxWidth, size, weight) {
    var s = size;
    do {
      ctx.font = weight + ' ' + s + 'px "Noto Sans Thai", sans-serif';
      s -= 4;
    } while (ctx.measureText(text).width > maxWidth && s > 20);
  }

  /** @return {Promise<string>} PNG data URL, 1080x1920 portrait */
  function toPng(c) {
    var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    return ready.then(function () {
      var W = 1080, H = 1920, PAD = 60;
      var canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0f0f12';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';

      ctx.fillStyle = '#a0a0ab';
      fitText(ctx, c.eventName + (c.unitName ? ' — ' + c.unitName : ''), W - PAD * 2, 44, '700');
      ctx.fillText(c.eventName + (c.unitName ? ' — ' + c.unitName : ''), W / 2, 150);

      ctx.fillStyle = '#f2f2f5';
      fitText(ctx, c.nickname, W - PAD * 2, 260, '700');
      ctx.fillText(c.nickname, W / 2, 440);

      fitText(ctx, c.firstName + ' ' + c.lastName, W - PAD * 2, 64, '400');
      ctx.fillText(c.firstName + ' ' + c.lastName, W / 2, 560);

      ctx.fillStyle = '#a0a0ab';
      ctx.font = '400 54px "Noto Sans Thai", sans-serif';
      ctx.fillText(c.studentId, W / 2, 650);

      ctx.fillStyle = c.deptColor || '#888888';
      ctx.fillRect(0, 720, W, 130);
      ctx.fillStyle = '#ffffff';
      fitText(ctx, bandText(c), W - PAD * 2, 60, '700');
      ctx.fillText(bandText(c), W / 2, 805);

      // White barcode area with generous quiet zones.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 900, W, 700);
      // Whole-pixel bar width so bars stay crisp: measure modules at width 1, then fit.
      var maxW = W - 120 * 2;
      var probe = document.createElement('canvas');
      JsBarcode(probe, c.barcode, Object.assign({ width: 1, height: 10 }, BARCODE_OPTS));
      var module = Math.max(1, Math.floor(maxW / probe.width));
      var bc = document.createElement('canvas');
      JsBarcode(bc, c.barcode, Object.assign({ width: module, height: 420 }, BARCODE_OPTS));
      ctx.drawImage(bc, Math.round((W - bc.width) / 2), 980);
      ctx.fillStyle = '#000000';
      ctx.font = '400 48px "Noto Sans Thai", sans-serif';
      ctx.fillText(c.studentId, W / 2, 1480);

      ctx.fillStyle = '#a0a0ab';
      ctx.font = '400 40px "Noto Sans Thai", sans-serif';
      ctx.fillText('เปิดความสว่างหน้าจอให้สูงสุดก่อนสแกน', W / 2, 1720);
      return canvas.toDataURL('image/png');
    });
  }

  window.HHCard = { renderHtml: renderHtml, toPng: toPng };
})();
