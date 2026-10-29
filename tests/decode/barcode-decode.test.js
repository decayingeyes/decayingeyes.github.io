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
