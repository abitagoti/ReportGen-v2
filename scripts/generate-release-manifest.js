'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const files = [
  'package.json',
  'electron-main.js',
  'server/server.js',
  'server/config.js',
  'server/database/database.js',
  'server/security/logger.js',
  'server/security/resourceProtection.js'
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
}

const manifest = {
  format: 1,
  product: 'ReportGen',
  version: String(pkg.version),
  generatedAt: new Date().toISOString(),
  files: Object.fromEntries(files.map(file => [file, sha256(file)]))
};

fs.writeFileSync(path.join(root, 'RELEASE-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Release manifest generated for ReportGen ${manifest.version}.`);
