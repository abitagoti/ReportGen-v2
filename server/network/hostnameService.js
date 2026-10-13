const dgram = require('node:dgram');
const os = require('node:os');

const MULTICAST = '224.0.0.251';
const PORT = 5353;
let responders = [];
let advertisedAddresses = [];

function isValidLocalHostname(hostname) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$/i.test(hostname);
}
function getLanInterfaces() {
  const result = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        if (!result.some((x) => x.address === entry.address)) result.push({ name, address: entry.address, netmask: entry.netmask });
      }
    }
  }
  return result;
}
function readName(buf, offset) {
  const labels = []; let p = offset;
  while (p < buf.length) {
    const len = buf[p++];
    if (len === 0) break;
    if ((len & 0xc0) === 0xc0) { p += 1; break; }
    if (p + len > buf.length) break;
    labels.push(buf.subarray(p, p + len).toString('utf8')); p += len;
  }
  return { name: labels.join('.'), next: p };
}
function encodeName(name) {
  const parts = String(name).replace(/\.$/, '').split('.').filter(Boolean);
  const chunks = [];
  for (const part of parts) { const b = Buffer.from(part); if (b.length > 63) throw new Error('mDNS label too long'); chunks.push(Buffer.from([b.length]), b); }
  chunks.push(Buffer.from([0])); return Buffer.concat(chunks);
}
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
function buildAResponse(query, host, address, ttl = 120) {
  const answerName = Buffer.from([0xc0, 0x0c]);
  const question = Buffer.concat([encodeName(host), u16(1), u16(1)]);
  const rdata = Buffer.from(address.split('.').map(Number));
  const answer = Buffer.concat([answerName, u16(1), u16(1), u32(ttl), u16(4), rdata]);
  return Buffer.concat([u16(query.readUInt16BE(0)), Buffer.from([0x84, 0x00]), u16(1), u16(1), u16(0), u16(0), question, answer]);
}
function buildAnnouncement(host, address, ttl = 120) {
  const rdata = Buffer.from(address.split('.').map(Number));
  const answer = Buffer.concat([encodeName(host), u16(1), u16(1), u32(ttl), u16(4), rdata]);
  return Buffer.concat([u16(0), Buffer.from([0x84, 0x00]), u16(0), u16(1), u16(0), u16(0), answer]);
}
function ipToInt(ip) { return String(ip).split('.').reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0); }
function sameSubnet(a, b, mask) { const m = ipToInt(mask); return ((ipToInt(a) & m) >>> 0) === ((ipToInt(b) & m) >>> 0); }
// Answer with the address of the interface the asker is on, so a client on one
// subnet is never handed the address of another adapter it cannot reach.
function selectInterfaceFor(interfaces, sourceAddress) {
  if (!interfaces.length) return null;
  const self = interfaces.find((i) => i.address === sourceAddress);
  if (self) return self;
  return interfaces.find((i) => i.netmask && sameSubnet(i.address, sourceAddress, i.netmask)) || interfaces[0];
}
// Pure function (unit-tested): returns { response, address } when `msg` is an
// mDNS query for `fqdn`, otherwise null.
function buildReplyForQuery(msg, fqdn, interfaces, sourceAddress) {
  if (!msg || msg.length < 12) return null;
  // Ignore mDNS *responses* (QR bit). The socket receives its own multicast
  // replies back through loopback; answering them would loop forever.
  if (msg[2] & 0x80) return null;
  const qd = msg.readUInt16BE(4); let offset = 12;
  for (let i = 0; i < qd; i++) {
    const q = readName(msg, offset); if (q.next + 4 > msg.length) return null;
    const qtype = msg.readUInt16BE(q.next); const qclass = msg.readUInt16BE(q.next + 2) & 0x7fff; offset = q.next + 4;
    if (q.name.toLowerCase() !== fqdn || qclass !== 1 || (qtype !== 1 && qtype !== 255)) continue;
    const chosen = selectInterfaceFor(interfaces, sourceAddress);
    if (!chosen) return null;
    return { response: buildAResponse(msg, fqdn, chosen.address), address: chosen.address };
  }
  return null;
}
function startLocalHostnameService({ hostname, logger = console } = {}) {
  if (!hostname || !isValidLocalHostname(hostname)) return { enabled: false, reason: 'invalid-hostname' };
  const fqdn = hostname.replace(/\.$/, '').toLowerCase();
  const interfaces = getLanInterfaces();
  advertisedAddresses = interfaces.map((x) => x.address);
  if (!interfaces.length) return { enabled: false, reason: 'no-lan-address' };
  // One socket bound to the wildcard address. A socket bound to a specific
  // unicast address is never delivered multicast datagrams (destination
  // 224.0.0.251 does not match), so it would never see a single query.
  // Interface selection is done with multicast group membership instead.
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const joined = [];
  socket.on('error', (error) => logger.warn(`[NETWORK] mDNS socket error: ${error.message}`));
  socket.on('message', (msg, rinfo) => {
    try {
      const reply = buildReplyForQuery(msg, fqdn, joined, rinfo.address);
      if (!reply) return;
      socket.send(reply.response, rinfo.port, rinfo.address);
      socket.setMulticastInterface(reply.address);
      socket.send(reply.response, PORT, MULTICAST);
    } catch {}
  });
  try {
    socket.bind({ port: PORT, address: '0.0.0.0', exclusive: false }, () => {
      try { socket.setMulticastTTL(255); socket.setMulticastLoopback(true); } catch (error) { logger.warn(`[NETWORK] mDNS socket option failed: ${error.message}`); }
      for (const item of interfaces) {
        try {
          socket.addMembership(MULTICAST, item.address);
          joined.push(item);
          socket.setMulticastInterface(item.address);
          socket.send(buildAnnouncement(fqdn, item.address), PORT, MULTICAST);
        } catch (error) { logger.warn(`[NETWORK] mDNS setup failed on ${item.address}: ${error.message}`); }
      }
    });
  } catch (error) {
    logger.warn(`[NETWORK] mDNS bind failed: ${error.message}`);
    try { socket.close(); } catch {}
    return { enabled: false, reason: 'bind-failed' };
  }
  responders = [{ socket, interfaces }];
  logger.log(`[NETWORK] mDNS hostname available: ${hostname} -> ${advertisedAddresses.join(', ')}`);
  logger.log('[NETWORK] mDNS responder listening on UDP 5353 (wildcard bind, per-interface multicast membership).');
  return { enabled: true, hostname, addresses: advertisedAddresses };
}
function stopLocalHostnameService() {
  for (const item of responders) {
    for (const iface of item.interfaces || []) { try { item.socket.dropMembership(MULTICAST, iface.address); } catch {} }
    try { item.socket.close(); } catch {}
  }
  responders = []; advertisedAddresses = [];
}
module.exports = { startLocalHostnameService, stopLocalHostnameService, isValidLocalHostname, buildReplyForQuery, selectInterfaceFor };
