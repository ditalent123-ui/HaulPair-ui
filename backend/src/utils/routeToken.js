import crypto from 'node:crypto';

/**
 * Route tokens bind a calculation to a route that the backend actually obtained
 * from the routing provider. The browser receives the token with the route and
 * sends it back with the calculation request, so the server never has to trust
 * a client-supplied distance.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)).
 * The payload is readable by the client (it contains no secrets) but cannot be
 * modified without invalidating the signature.
 */

const TOKEN_VERSION = 1;

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function signRouteToken(payload, secret, { ttlS = 3600, now = Date.now() } = {}) {
  const issuedAt = Math.floor(now / 1000);
  const body = { ...payload, v: TOKEN_VERSION, iat: issuedAt, exp: issuedAt + ttlS };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return { token: `${encoded}.${sign(encoded, secret)}`, expiresAt: new Date(body.exp * 1000).toISOString() };
}

export class RouteTokenError extends Error {
  constructor(message, reason) {
    super(message);
    this.reason = reason;
  }
}

export function verifyRouteToken(token, secret, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 8192) {
    throw new RouteTokenError('Route token is missing or malformed.', 'malformed');
  }
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new RouteTokenError('Route token is malformed.', 'malformed');
  }
  const [encoded, signature] = parts;
  const expected = Buffer.from(sign(encoded, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new RouteTokenError('Route token signature is invalid. Request the route again.', 'signature');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new RouteTokenError('Route token payload is unreadable.', 'malformed');
  }
  if (payload.v !== TOKEN_VERSION) {
    throw new RouteTokenError('Route token version is not supported. Request the route again.', 'version');
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) {
    throw new RouteTokenError('Route token has expired. Request the route again.', 'expired');
  }
  return payload;
}
