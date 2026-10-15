const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../server/permissions.js'), 'utf8');
test('permission overrides support both legacy decision and current effect schema', () => {
 assert.match(source, /columns\.includes\('effect'\)/);
 assert.match(source, /columns\.includes\('decision'\)/);
 assert.match(source, /AS override_value/);
 assert.match(source, /permission,\$\{col\},updated_by/);
});
