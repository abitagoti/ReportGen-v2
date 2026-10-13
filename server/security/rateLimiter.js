const buckets = new Map();
// Track the widest window any limiter is using, so the periodic sweep below
// knows how stale a bucket has to be before it's safe to drop entirely.
let maxWindowMs = 0;
let sweepTimer = null;

function sweepStaleBuckets() {
  const now = Date.now();
  for (const [key, timestamps] of buckets) {
    const active = timestamps.filter(ts => now - ts < maxWindowMs);
    if (active.length) buckets.set(key, active);
    else buckets.delete(key);
  }
}

function rateLimit({ windowMs, max, keyGenerator }) {
  maxWindowMs = Math.max(maxWindowMs, windowMs);
  // On a long-running server, buckets for keys that are no longer active would
  // otherwise sit in memory forever (this Map is only ever pruned on read).
  // A periodic sweep every 5x the window keeps memory bounded to actually-active
  // callers instead of every distinct ip|path this process has ever seen.
  if (!sweepTimer) {
    sweepTimer = setInterval(sweepStaleBuckets, Math.max(windowMs * 5, 60_000));
    sweepTimer.unref?.();
  }
  return (req, res, next) => {
    const identity = typeof keyGenerator === 'function' ? keyGenerator(req) : req.ip;
    const key = `${identity}|${req.path}`;
    const now = Date.now();
    const existing = buckets.get(key) || [];
    const active = existing.filter(ts => now - ts < windowMs);

    if (active.length >= max) {
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }

    active.push(now);
    buckets.set(key, active);
    next();
  };
}

module.exports = { rateLimit };
