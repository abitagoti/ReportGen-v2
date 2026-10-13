'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'RELEASE-MANIFEST.json');
if (!fs.existsSync(manifestPath)) throw new Error('RELEASE-MANIFEST.json is missing. Generate a release manifest before deployment.');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.product !== 'ReportGen' || manifest.format !== 1) throw new Error('Release manifest format/product is invalid.');
if (String(manifest.version) !== String(pkg.version)) throw new Error(`Release version mismatch: manifest=${manifest.version}, package=${pkg.version}.`);

for (const [relative, expected] of Object.entries(manifest.files || {})) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`Release integrity failure: required file is missing: ${relative}`);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== expected) throw new Error(`Release integrity failure: ${relative} hash mismatch.`);
}

console.log(`Release integrity verified: ReportGen ${pkg.version}.`);
