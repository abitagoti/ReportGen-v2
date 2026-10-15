const express = require('express');
const os = require('node:os');
const config = require('../config');
const { requireAuth, requirePermission } = require('../auth/middleware');

const router = express.Router();

function diagnostics() {
  return {
    hostname: os.hostname(),
    platform: process.platform,
    nodeVersion: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    network: config.getLanAddresses()
  };
}

router.get('/api/settings/configuration', requireAuth, requirePermission('settings.manage'), (req, res) => {
  res.json({ configuration: config.publicConfig(), diagnostics: diagnostics() });
});

router.get('/api/settings/network/diagnostics', requireAuth, requirePermission('settings.manage'), (req, res) => {
  res.json({ configuration: config.publicConfig(), diagnostics: diagnostics() });
});

module.exports = router;
