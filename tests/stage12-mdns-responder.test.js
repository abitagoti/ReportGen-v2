// Regression: the mDNS responder must be reachable by other devices.
// A previous build bound its UDP socket to the machine's own LAN address, which
// never receives multicast datagrams, so no other device could resolve
// reportgen.local. These tests cover the query handling and the bind rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildReplyForQuery, selectInterfaceFor } = require('../server/network/hostnameService');

function query(name, { response = false, qtype = 1 } = {}) {
  const labels = name.split('.').map((p) => Buffer.concat([Buffer.from([p.length]), Buffer.from(p)]));
  const header = Buffer.from([0x12, 0x34, response ? 0x84 : 0x00, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([header, ...labels, Buffer.from([0, 0, qtype, 0, 1])]);
}
const ifaces = [
  { name: 'Ethernet', address: '10.10.110.3', netmask: '255.255.255.0' },
  { name: 'Wi-Fi', address: '192.168.1.20', netmask: '255.255.255.0' }
];
const lastFour = (buf) => [...buf.subarray(buf.length - 4)].join('.');

test('answers a query for the configured name with the address on the asker\'s subnet', () => {
  const a = buildReplyForQuery(query('reportgen.local'), 'reportgen.local', ifaces, '10.10.110.77');
  assert.equal(a.address, '10.10.110.3');
  assert.equal(lastFour(a.response), '10.10.110.3');
  const b = buildReplyForQuery(query('ReportGen.LOCAL'), 'reportgen.local', ifaces, '192.168.1.55');
  assert.equal(b.address, '192.168.1.20');
  assert.equal(lastFour(b.response), '192.168.1.20');
});

test('answers ANY queries and falls back to the first interface for unknown subnets', () => {
  const r = buildReplyForQuery(query('reportgen.local', { qtype: 255 }), 'reportgen.local', ifaces, '172.16.0.9');
  assert.equal(r.address, '10.10.110.3');
});

test('ignores other names, non-A types and mDNS responses (no reply loop)', () => {
  assert.equal(buildReplyForQuery(query('other.local'), 'reportgen.local', ifaces, '10.10.110.77'), null);
  assert.equal(buildReplyForQuery(query('reportgen.local', { qtype: 28 }), 'reportgen.local', ifaces, '10.10.110.77'), null);
  assert.equal(buildReplyForQuery(query('reportgen.local', { response: true }), 'reportgen.local', ifaces, '10.10.110.3'), null);
  assert.equal(buildReplyForQuery(Buffer.alloc(4), 'reportgen.local', ifaces, '10.10.110.77'), null);
});

test('interface selection prefers the asker itself, then its subnet', () => {
  assert.equal(selectInterfaceFor(ifaces, '192.168.1.20').address, '192.168.1.20');
  assert.equal(selectInterfaceFor(ifaces, '192.168.1.99').address, '192.168.1.20');
  assert.equal(selectInterfaceFor([], '10.0.0.1'), null);
});

test('responder socket is bound to the wildcard address, never to a unicast LAN address', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'network', 'hostnameService.js'), 'utf8');
  assert.match(source, /socket\.bind\(\{ port: PORT, address: '0\.0\.0\.0'/);
  assert.doesNotMatch(source, /socket\.bind\(\{ port: PORT, address: item\.address/);
});
