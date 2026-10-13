// Regression: /api/health reported a hard-coded, stale build label
// ('stage5-permission-isolation-v1'), so operators could not tell which
// version was actually running. It must follow package.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

test('health endpoint build label is derived from package.json, not hard-coded', () => {
  assert.doesNotMatch(server, /build:\s*'stage\d/i, 'hard-coded stage label found in /api/health');
  assert.match(server, /build:\s*`reportgen-server@\$\{require\('\.\.\/package\.json'\)\.version\}`/);
});
