const buckets = new Map();
const active = new Map();
const WINDOW_MS = 60 * 1000;
const DEFAULT_REQUESTS = 180;
const MAX_TRACKED_BUCKETS = 10000;

function clientKey(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 100);
}

function apiRateLimit(options = {}) {
  const max = Number(options.max || DEFAULT_REQUESTS);
  return (req, res, next) => {
    const now = Date.now();
    const key = `${options.name || 'api'}:${clientKey(req)}`;
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.started >= WINDOW_MS) {
      bucket = { started: now, count: 0 };
      if (buckets.size >= MAX_TRACKED_BUCKETS && !buckets.has(key)) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - bucket.started)) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }
    next();
  };
}

function concurrencyLimit(name, max = 1) {
  const limit = Math.max(1, Number(max) || 1);
  return (req, res, next) => {
    const count = active.get(name) || 0;
    if (count >= limit) {
      res.setHeader('Retry-After', '10');
      return res.status(429).json({ error: 'This operation is busy processing another request. Please try again shortly.' });
    }
    active.set(name, count + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const nextCount = Math.max(0, (active.get(name) || 1) - 1);
      if (nextCount) active.set(name, nextCount); else active.delete(name);
    };
    res.once('finish', release);
    res.once('close', release);
    try { next(); } catch (error) { release(); throw error; }
  };
}

function cleanup() {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [key, bucket] of buckets) if (bucket.started < cutoff) buckets.delete(key);
}
const cleanupTimer = setInterval(cleanup, WINDOW_MS);
cleanupTimer.unref?.();

module.exports = { apiRateLimit, concurrencyLimit };
