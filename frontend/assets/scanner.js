/**
 * Camera code scanner shared by the scan page and the camera test page.
 *
 * Decoding the full 1080x1920 iPhone frame with ZXing found nothing, so each
 * tick crops the centre of the frame (where the aim box is), scales it down,
 * and tries:
 *   1. jsQR on the square crop (QR, robust to blur/glare)
 *   2. ZXing Code 128 on a horizontal band through the centre
 * Requires jsQR and @zxing/library (window.ZXing).
 */
(function () {
  var TICK_MS = 120;
  var CROP_FRACTION = 0.8; // of the shorter video side
  var WORK_SIZE = 640; // px, longest side of the analysed image

  function Scanner(video, onText, onStatus) {
    this.video = video;
    this.onText = onText;
    this.onStatus = onStatus || function () {};
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.frames = 0;
    this.timer = null;
    this.stream = null;
    var hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.CODE_128]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    this.zxing = new ZXing.MultiFormatReader();
    this.zxing.setHints(hints);
  }

  Scanner.prototype.start = function () {
    var self = this;
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    }).then(function (stream) {
      self.stream = stream;
      self.video.srcObject = stream;
      self.video.setAttribute('playsinline', '');
      self.video.muted = true;
      return self.video.play();
    }).then(function () {
      self.timer = setInterval(function () { self.tick(); }, TICK_MS);
    });
  };

  Scanner.prototype.stop = function () {
    clearInterval(this.timer);
    if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
  };

  /** Draw the centre crop of the current frame scaled to at most WORK_SIZE. */
  Scanner.prototype.grab = function (wFrac, hFrac) {
    var v = this.video;
    var vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return null;
    var side = Math.min(vw, vh) * CROP_FRACTION;
    var sw = side * wFrac, sh = side * hFrac;
    var sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    var scale = Math.min(1, WORK_SIZE / Math.max(sw, sh));
    var w = Math.round(sw * scale), h = Math.round(sh * scale);
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
    return this.ctx.getImageData(0, 0, w, h);
  };

  Scanner.prototype.tick = function () {
    if (this.busy) return;
    this.busy = true;
    try {
      this.frames++;
      var text = null;
      var how = '';

      var sq = this.grab(1, 1);
      if (sq) {
        var qr = jsQR(sq.data, sq.width, sq.height, { inversionAttempts: 'attemptBoth' });
        if (qr && qr.data) { text = qr.data; how = 'QR'; }
      }

      // Code 128 every other tick: a wide, short band through the centre.
      if (!text && this.frames % 2 === 0) {
        var band = this.grab(1.2, 0.35);
        if (band) {
          text = this.decodeLinear(band);
          if (text) how = 'CODE128';
        }
      }

      if (this.frames % 10 === 0) {
        this.onStatus({ frames: this.frames, width: this.video.videoWidth, height: this.video.videoHeight });
      }
      if (text) this.onText(text, how);
    } catch (e) {
      this.onStatus({ error: e && (e.name + ' ' + e.message) });
    }
    this.busy = false;
  };

  Scanner.prototype.decodeLinear = function (img) {
    var lum = new Uint8ClampedArray(img.width * img.height);
    for (var i = 0, j = 0; i < lum.length; i++, j += 4) {
      lum[i] = (img.data[j] * 299 + img.data[j + 1] * 587 + img.data[j + 2] * 114) / 1000;
    }
    var source = new ZXing.RGBLuminanceSource(lum, img.width, img.height);
    var binarizers = [ZXing.HybridBinarizer, ZXing.GlobalHistogramBinarizer];
    for (var b = 0; b < binarizers.length; b++) {
      try {
        return this.zxing.decode(new ZXing.BinaryBitmap(new binarizers[b](source))).getText();
      } catch (e) {
        // NotFound: try the next binarizer
      }
    }
    return null;
  };

  window.HHScanner = Scanner;
})();
