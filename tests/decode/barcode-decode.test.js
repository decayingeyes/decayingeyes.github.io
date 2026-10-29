/**
 * End-to-end barcode check without a camera: encode card payloads with JsBarcode
 * (same lib as the member card), rasterize the bars, decode with ZXing (same lib
 * as the scan page). Catches payloads or settings the scanner cannot read.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const JsBarcode = require('jsbarcode');
const ZXing = require('@zxing/library');
const crypto = require('node:crypto');
const B = require('../../backend-staff/core/barcode');

const hmacBytes = (key, msg) => [...crypto.createHmac('sha256', key).update(msg, 'utf8').digest()];

function bars(text) {
  const out = {};
  JsBarcode(out, text, { format: 'CODE128' });
  return out.encodings.map((e) => e.data).join('');
}

function decode(binary, moduleWidth, quiet = 20, height = 40) {
  const width = (binary.length + quiet * 2) * moduleWidth;
  const lum = new Uint8ClampedArray(width * height).fill(255);
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < binary.length; i++) {
      if (binary[i] === '1') {
        for (let k = 0; k < moduleWidth; k++) lum[y * width + (quiet + i) * moduleWidth + k] = 0;
      }
    }
  }
  const hints = new Map([
    [ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.CODE_128]],
    [ZXing.DecodeHintType.TRY_HARDER, true],
  ]);
  const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.RGBLuminanceSource(lum, width, height)));
  return new ZXing.MultiFormatReader().decode(bitmap, hints).getText();
}

test('card payloads decode back exactly (module widths 1-4)', () => {
  const ids = ['9900004', '6512345678', '0650001', 'A1B2C3D4E5F6G7H8I9J0'];
  for (const id of ids) {
    for (const version of [1, 7]) {
      const payload = B.payload(id, version, 'secret', hmacBytes);
      for (const w of [1, 2, 3, 4]) {
        assert.equal(decode(bars(payload), w), payload, `${payload} @${w}px`);
      }
    }
  }
});

test('decoded text round-trips through barcode.parse', () => {
  const payload = B.payload('9900004', 1, 'secret', hmacBytes);
  assert.deepEqual(B.parse(decode(bars(payload), 2)), { studentId: '9900004', check: payload.slice(-4) });
});

const qrcode = require('qrcode-generator');

function decodeQr(text, cell = 4) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + 8) * cell;
  const lum = new Uint8ClampedArray(size * size).fill(255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) lum[((r + 4) * cell + y) * size + (c + 4) * cell + x] = 0;
      }
    }
  }
  const hints = new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.CODE_128]]]);
  const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.RGBLuminanceSource(lum, size, size)));
  return new ZXing.MultiFormatReader().decode(bitmap, hints).getText();
}

test('card QR codes decode to the same payload as the Code 128 barcode', () => {
  for (const id of ['9900004', '6512345678', '0650001']) {
    const payload = B.payload(id, 1, 'secret', hmacBytes);
    assert.equal(decodeQr(payload), payload);
    assert.deepEqual(B.parse(decodeQr(payload)), B.parse(payload));
  }
});

const jsQR = require('jsqr');

test('jsQR (scan page QR decoder) reads card QR codes, including a downscaled blurry copy', () => {
  for (const id of ['9900004', '6512345678']) {
    const payload = B.payload(id, 1, 'secret', hmacBytes);
    const qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    const n = qr.getModuleCount();
    const cell = 6;
    const size = (n + 8) * cell;
    const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const r = Math.floor(y / cell) - 4, c = Math.floor(x / cell) - 4;
        if (r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c)) {
          const i = (y * size + x) * 4;
          rgba[i] = rgba[i + 1] = rgba[i + 2] = 40; // dark grey, like a glossy screen
        }
      }
    }
    // 3x3 box blur to mimic camera softness
    const blurred = new Uint8ClampedArray(rgba);
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += rgba[((y + dy) * size + x + dx) * 4];
        const i = (y * size + x) * 4;
        blurred[i] = blurred[i + 1] = blurred[i + 2] = s / 9;
      }
    }
    assert.equal(jsQR(rgba, size, size).data, payload);
    assert.equal(jsQR(blurred, size, size).data, payload);
  }
});
