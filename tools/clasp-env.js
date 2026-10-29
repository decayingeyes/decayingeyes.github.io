#!/usr/bin/env node
/**
 * Run a clasp command against the TEST or PROD Apps Script project.
 *   node tools/clasp-env.js <test|prod> <clasp args...>
 * Copies backend-staff/.clasp.<env>.json to backend-staff/.clasp.json, then runs clasp there.
 *
 * `deploy` is special: it updates the env's existing web app deployment
 * (deploymentId in .clasp.<env>.json) so the /exec URL never changes.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [env, ...args] = process.argv.slice(2);
if (!['test', 'prod'].includes(env) || args.length === 0) {
  console.error('usage: node tools/clasp-env.js <test|prod> <clasp args...>');
  process.exit(2);
}

const dir = path.join(__dirname, '..', 'backend-staff');
const src = path.join(dir, `.clasp.${env}.json`);
if (!fs.existsSync(src)) {
  console.error(`Missing ${src}. Create the ${env.toUpperCase()} project first (see docs/README-TH.md).`);
  process.exit(1);
}
const conf = JSON.parse(fs.readFileSync(src, 'utf8'));
fs.writeFileSync(path.join(dir, '.clasp.json'), JSON.stringify({ scriptId: conf.scriptId, rootDir: '.' }, null, 2));

function clasp(claspArgs) {
  // One command string: Windows needs a shell to run npx, and Node warns on args + shell.
  const r = spawnSync(['npx', 'clasp', ...claspArgs].join(' '), { cwd: dir, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status || 1);
}

if (args[0] === 'deploy') {
  clasp(['push', '--force']);
  const desc = `${env.toUpperCase()} ${new Date().toISOString()}`;
  if (conf.deploymentId) {
    clasp(['deploy', '--deploymentId', conf.deploymentId, '--description', `"${desc}"`]);
  } else {
    clasp(['deploy', '--description', `"${desc}"`]);
    console.log(`\nFirst deployment created. Copy its deploymentId into ${src} so later deploys keep the same URL.`);
  }
} else if (args[0] === 'push') {
  // --force: push without the interactive manifest-overwrite prompt.
  clasp(args.includes('--force') ? args : [...args, '--force']);
} else {
  clasp(args);
}
