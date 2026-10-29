import crypto from 'node:crypto';

/**
 * Shared HTTP Basic access protection for the whole prototype.
 *
 * This is a SINGLE shared credential: everyone who is let in shares the same
 * access and their data is NOT isolated from each other. It only keeps
 * anonymous visitors out (reads, deletes, logs and paid provider calls).
 * It is not multi-tenant user authentication. Credentials come only from the
 * server environment (config.auth); there is no default public password.
 *
 * Health checks stay public but minimal (no data, no configuration).
 */

const PUBLIC_PATHS = new Set(['/api/health']);

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  // Compare fixed-length digests so length differences do not leak via timing.
  const ah = crypto.createHash('sha256').update(ab).digest();
  const bh = crypto.createHash('sha256').update(bb).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function parseBasic(header) {
  if (typeof header !== 'string' || !header.startsWith('Basic ')) return null;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const i = decoded.indexOf(':');
  if (i < 0) return null;
  return { username: decoded.slice(0, i), password: decoded.slice(i + 1) };
}

/**
 * Access-control middleware. When auth is disabled (local/dev default) it is a
 * pass-through. When enabled it enforces Basic credentials on everything except
 * the minimal public health check. `authLimiter` (if provided) rate-limits
 * failed attempts and is only engaged on protected paths.
 */
export function createAccessControl({ auth, authLimiter }) {
  return function accessControl(req, res, next) {
    if (!auth.enabled) return next();
    if (req.method === 'GET' && PUBLIC_PATHS.has(req.path)) return next();

    const run = () => {
      const creds = parseBasic(req.headers.authorization);
      const ok =
        creds &&
        timingSafeEqualStr(creds.username, auth.username) &&
        timingSafeEqualStr(creds.password, auth.password);
      if (ok) return next();
      // Do not echo any submitted value; never log the credential.
      res.setHeader('WWW-Authenticate', `Basic realm="${auth.realm}", charset="UTF-8"`);
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.', requestId: req.id },
      });
    };

    // Count only failed attempts against the limiter (skipSuccessfulRequests).
    if (authLimiter) return authLimiter(req, res, run);
    return run();
  };
}

/**
 * CSRF guard for state-changing requests. Only relevant once shared credentials
 * exist, because browsers auto-attach cached Basic credentials to cross-site
 * requests (a confused-deputy risk). A cross-site page cannot set a custom
 * header or produce a same-site fetch, so we require one of those signals.
 * CORS is deliberately not treated as the protection.
 */
export function createCsrfGuard({ auth }) {
  const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  return function csrfGuard(req, res, next) {
    if (!auth.enabled) return next();
    if (!UNSAFE.has(req.method)) return next();
    const fetchSite = req.headers['sec-fetch-site'];
    const sameSite = fetchSite === 'same-origin' || fetchSite === 'same-site';
    const requestedWith = typeof req.headers['x-requested-with'] === 'string';
    if (sameSite || requestedWith) return next();
    return res.status(403).json({
      error: { code: 'CSRF_BLOCKED', message: 'Cross-site state-changing request blocked.', requestId: req.id },
    });
  };
}
