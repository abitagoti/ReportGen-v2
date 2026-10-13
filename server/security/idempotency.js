const crypto = require('node:crypto');
const { db } = require('../database/database');
const { nowIso } = require('../lib/time');

const KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/;

function stable(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stable);
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
}

function requestFingerprint(req) {
  const payload = {
    method: req.method,
    path: req.path,
    body: stable(req.body || {}),
    query: stable(req.query || {}),
    file: req.file ? {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      sha256: req.file.buffer ? crypto.createHash('sha256').update(req.file.buffer).digest('hex') : null
    } : null
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function requireIdempotency(req, res, next) {
  const rawKey = String(req.get('Idempotency-Key') || '').trim();
  if (!rawKey) return next();
  if (!KEY_RE.test(rawKey)) return res.status(400).json({ error: 'Idempotency-Key must be 8-200 characters using letters, numbers, dot, underscore, colon or hyphen.' });

  const companyId = req.user?.company_id;
  const userId = req.user?.user_id;
  if (!companyId || !userId) return next();

  const route = `${req.method} ${req.path}`;
  const fingerprint = requestFingerprint(req);
  const existing = db.prepare(`SELECT key,request_hash,status,response_status,response_body FROM idempotency_keys WHERE company_id=? AND user_id=? AND route=? AND key=?`).get(companyId, userId, route, rawKey);

  if (existing) {
    if (existing.request_hash !== fingerprint) {
      return res.status(409).json({ error: 'This Idempotency-Key was already used with different request data.' });
    }
    if (existing.status === 'completed') {
      res.status(Number(existing.response_status || 200));
      try { return res.json(JSON.parse(existing.response_body || '{}')); }
      catch { return res.json({ message: 'The previous request completed successfully.' }); }
    }
    return res.status(409).json({ error: 'A request with this Idempotency-Key is already being processed. Retry after it completes.' });
  }

  const createdAt = nowIso();
  try {
    db.prepare(`INSERT INTO idempotency_keys(company_id,user_id,route,key,request_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,'processing',?,?)`)
      .run(companyId, userId, route, rawKey, fingerprint, createdAt, createdAt);
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) return res.status(409).json({ error: 'A request with this Idempotency-Key is already being processed.' });
    throw error;
  }

  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    const status = Number(res.statusCode || 200);
    if (status >= 200 && status < 300) {
      // The response is captured by the json override below. If a route finishes
      // without JSON, keep the successful key reserved rather than allowing a
      // retry to repeat an already-committed financial mutation.
      if (!res.__reportgenIdempotencyCaptured) {
        db.prepare(`UPDATE idempotency_keys SET status='completed',response_status=?,response_body=?,updated_at=? WHERE company_id=? AND user_id=? AND route=? AND key=?`)
          .run(status, JSON.stringify({ message: 'Request completed successfully.' }), nowIso(), companyId, userId, route, rawKey);
      }
    } else {
      db.prepare('DELETE FROM idempotency_keys WHERE company_id=? AND user_id=? AND route=? AND key=?').run(companyId, userId, route, rawKey);
    }
  };

  const originalJson = res.json.bind(res);
  res.json = body => {
    if (!settled) {
      const status = Number(res.statusCode || 200);
      if (status >= 200 && status < 300) {
        res.__reportgenIdempotencyCaptured = true;
        db.prepare(`UPDATE idempotency_keys SET status='completed',response_status=?,response_body=?,updated_at=? WHERE company_id=? AND user_id=? AND route=? AND key=?`)
          .run(status, JSON.stringify(body === undefined ? null : body), nowIso(), companyId, userId, route, rawKey);
      } else {
        db.prepare('DELETE FROM idempotency_keys WHERE company_id=? AND user_id=? AND route=? AND key=?').run(companyId, userId, route, rawKey);
      }
      settled = true;
    }
    return originalJson(body);
  };
  res.once('finish', finish);
  next();
}

module.exports = { requireIdempotency, requestFingerprint };
