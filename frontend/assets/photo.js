/**
 * Card photo capture for heads/admins: opens the camera (or gallery), crops to
 * a 3:4 portrait, shrinks to a small JPEG (fits a Sheets cell) and uploads.
 * Exposes window.HHPhoto.
 */
(function () {
  var W = 300, H = 400, MAX_CHARS = 44000;

  /** Center-crop to 3:4 and encode as JPEG, lowering quality until it fits. */
  function toSmallJpeg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        var ctx = canvas.getContext('2d');
        var srcRatio = img.width / img.height, dstRatio = W / H;
        var sw = img.width, sh = img.height, sx = 0, sy = 0;
        if (srcRatio > dstRatio) { sw = img.height * dstRatio; sx = (img.width - sw) / 2; }
        else { sh = img.width / dstRatio; sy = (img.height - sh) / 2; }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
        URL.revokeObjectURL(url);
        var q = 0.8, data;
        do {
          data = canvas.toDataURL('image/jpeg', q);
          q -= 0.1;
        } while (data.length > MAX_CHARS && q > 0.2);
        if (data.length > MAX_CHARS) reject(new Error('too large'));
        else resolve(data);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('not an image')); };
      img.src = url;
    });
  }

  /**
   * Let the user take/choose a photo, then upload it for `studentId`.
   * @param {function(string, string): void} onDone (status 'ok'|'error', message or dataUrl)
   */
  function capture(studentId, onDone) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment'); // the head photographs the member in front of them
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      toSmallJpeg(file).then(function (dataUrl) {
        return HH.call('photo.set', { studentId: studentId, photo: dataUrl }).then(function (res) {
          if (!res.ok) onDone('error', HH.errorText(res));
          else onDone('ok', dataUrl);
        });
      }).catch(function () { onDone('error', 'ใช้รูปนี้ไม่ได้ ลองถ่ายใหม่อีกครั้ง'); });
    });
    input.click();
  }

  function remove(studentId, onDone) {
    HH.call('photo.set', { studentId: studentId, photo: '' }).then(function (res) {
      onDone(res.ok ? 'ok' : 'error', res.ok ? '' : HH.errorText(res));
    });
  }

  window.HHPhoto = { capture: capture, remove: remove };
})();
