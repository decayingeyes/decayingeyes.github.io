#!/usr/bin/env node
/**
 * Writes a Content-Security-Policy meta tag into every frontend page, listing a
 * hash for each inline script. GitHub Pages cannot send headers, so the meta tag
 * is how the browser learns to run only these scripts, even if someone manages
 * to inject HTML into a page.
 *   node tools/apply-csp.js          update the pages
 *   node tools/apply-csp.js --check  fail if any page is out of date (used by tests)
 * Run it after editing any inline <script>.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', 'frontend');
const META = /[ \t]*<meta http-equiv="Content-Security-Policy"[^>]*>\r?\n/;

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'vendor' ? [] : htmlFiles(p);
    return e.name.endsWith('.html') ? [p] : [];
  });
}

/**
 * Browsers turn CRLF into LF before hashing, and Git checks files out as CRLF on
 * Windows but LF on the Pages build, so hash the LF form to match everywhere.
 */
function inlineScripts(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1].replace(/\r\n?/g, '\n'));
}

function policy(html) {
  const hashes = inlineScripts(html).map((s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`);
  return [
    "default-src 'none'",
    ["script-src 'self'", ...hashes].join(' '),
    // Inline style attributes remain in the pages; they cannot run code.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    'connect-src https://script.google.com https://script.googleusercontent.com',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** The page with its policy tag placed right after the charset, before anything can load. */
function withPolicy(html) {
  const tag = `  <meta http-equiv="Content-Security-Policy" content="${policy(html)}">\n`;
  const clean = html.replace(META, '');
  const charset = /<meta charset="utf-8">\r?\n?/;
  if (!charset.test(clean)) throw new Error('page has no charset meta');
  return clean.replace(charset, (m) => (m.endsWith('\n') ? m : `${m}\n`) + tag);
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const file of htmlFiles(ROOT)) {
    const before = fs.readFileSync(file, 'utf8');
    const after = withPolicy(before);
    if (before === after) continue;
    stale++;
    if (check) console.error(`out of date: ${path.relative(ROOT, file)}`);
    else fs.writeFileSync(file, after);
  }
  if (check && stale > 0) process.exit(1);
  console.log(check ? 'CSP up to date' : `updated ${stale} page(s)`);
}

module.exports = { ROOT, htmlFiles, withPolicy };
