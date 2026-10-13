const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifestSource = fs.readFileSync(path.join(root, 'scripts/verify-release-integrity.js'), 'utf8');
const updater = fs.readFileSync(path.join(root, 'update-reportgen.bat'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'build/installer.nsh'), 'utf8');
const electronMain = fs.readFileSync(path.join(root, 'electron-main.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'server/config.js'), 'utf8');

test('release integrity is version-bound and hash-verifies critical files', () => {
  assert.match(manifestSource, /manifest\.version.*pkg\.version/s);
  assert.match(manifestSource, /sha256/);
  assert.match(manifestSource, /hash mismatch/);
  assert.equal(typeof pkg.scripts['release:verify'], 'string');
  assert.equal(typeof pkg.scripts['release:manifest'], 'string');
});

test('desktop data and certificates remain outside the application folder', () => {
  assert.match(electronMain, /app\.getPath\('appData'\)/);
  assert.match(electronMain, /ReportGen-v2/);
  assert.match(config, /stable-user-data/);
  assert.match(config, /REPORTGEN_DATA_DIR/);
});

test('safe updater never performs an automatic npm install', () => {
  assert.doesNotMatch(updater, /call\s+npm\s+install|^\s*npm\s+install/im);
  assert.match(updater, /release-integrity\.js/);
  assert.match(updater, /RELEASE-MANIFEST\.json/);
});

test('installer does not delete application data on uninstall and stops service before replacement', () => {
  assert.match(installer, /ReportGenStopServiceForUpdate/);
  assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /deleteAppDataOnUninstall[\"']?\s*:\s*false/);
  assert.match(installer, /ReportGenRestartServiceAfterUpdate/);
});

test('release package excludes private deployment material', () => {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const files = JSON.stringify(pkgJson.build?.files || []);
  assert.match(files, /config\/certificates/);
});
