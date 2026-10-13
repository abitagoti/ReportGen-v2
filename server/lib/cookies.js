function parseCookieHeader(header) {
  const cookies = {};
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function cookieMiddleware(req, res, next) {
  req.cookies = parseCookieHeader(req.headers.cookie);

  res.cookie = (name, value, options = {}) => {
    const parts = [`${name}=${encodeURIComponent(String(value))}`];
    if (options.maxAge != null) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
    if (options.httpOnly) parts.push('HttpOnly');
    if (options.secure) parts.push('Secure');
    if (options.sameSite) parts.push(`SameSite=${String(options.sameSite).charAt(0).toUpperCase()}${String(options.sameSite).slice(1).toLowerCase()}`);
    if (options.path || true) parts.push(`Path=${options.path || '/'}`);
    res.append('Set-Cookie', parts.join('; '));
    return res;
  };

  res.clearCookie = (name, options = {}) => {
    return res.cookie(name, '', { ...options, maxAge: 0, path: options.path || '/' });
  };

  next();
}

module.exports = { cookieMiddleware };
