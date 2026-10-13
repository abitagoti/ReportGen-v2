const crypto = require('node:crypto');

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

module.exports = { id };
