import crypto from 'node:crypto';

/**
 * Opaque, authenticated tokens (AES-256-GCM). Used for booking quotes so the
 * browser can hold a quote without being able to read its internals (truck
 * plan, diesel price, cost inputs) — the booking UI only ever receives the
 * final total — and without being able to tamper with it.
 */

const VERSION = 'q1';

function keyFrom(secret) {
  return crypto.createHash('sha256').update(`haulpair-sealed-token:${secret}`).digest();
}

export class SealedTokenError extends Error {
  constructor(message, reason) {
    super(message);
    this.reason = reason;
  }
}

export function sealToken(payload, secret, { ttlS = 1800, now = Date.now() } = {}) {
  const iat = Math.floor(now / 1000);
  const body = Buffer.from(JSON.stringify({ ...payload, iat, exp: iat + ttlS }), 'utf8');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(body), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    token: `${VERSION}.${Buffer.concat([iv, tag, enc]).toString('base64url')}`,
    expiresAt: new Date((iat + ttlS) * 1000).toISOString(),
  };
}

export function openToken(token, secret, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 16384 || !token.startsWith(`${VERSION}.`)) {
    throw new SealedTokenError('The quote is missing or malformed.', 'malformed');
  }
  let payload;
  try {
    const raw = Buffer.from(token.slice(VERSION.length + 1), 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    payload = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
  } catch {
    throw new SealedTokenError('The quote is invalid. Please request the price again.', 'invalid');
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) {
    throw new SealedTokenError('The quote has expired. Please request the price again.', 'expired');
  }
  return payload;
}
