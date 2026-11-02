const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, htmlFiles, withPolicy } = require('../../tools/apply-csp');

const pages = htmlFiles(ROOT).map((file) => ({ file, name: path.relative(ROOT, file), html: fs.readFileSync(file, 'utf8') }));

test('every page has a current CSP tag (run: node tools/apply-csp.js)', () => {
  assert.ok(pages.length >= 10);
  for (const p of pages) assert.equal(p.html, withPolicy(p.html), p.name);
});

test('the CSP tag comes before any script or stylesheet', () => {
  for (const p of pages) {
    const csp = p.html.indexOf('Content-Security-Policy');
    const first = p.html.search(/<script|<link/);
    assert.ok(csp !== -1 && (first === -1 || csp < first), p.name);
  }
});

test('no page loads a script from another site', () => {
  for (const p of pages) {
    for (const m of p.html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
      assert.ok(!/^(https?:)?\/\//.test(m[1]), `${p.name}: ${m[1]}`);
    }
  }
});

test('every local script a page loads exists', () => {
  for (const p of pages) {
    for (const m of p.html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
      assert.ok(fs.existsSync(path.join(path.dirname(p.file), m[1])), `${p.name}: ${m[1]}`);
    }
  }
});

test('no inline event handlers, which the CSP would block', () => {
  for (const p of pages) assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(p.html), p.name);
});
