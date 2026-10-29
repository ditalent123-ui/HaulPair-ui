import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

/** Derive allowed image origins from a Leaflet tile URL template ({s} subdomains expanded). */
export function tileOrigins(tileUrl) {
  const variants = tileUrl.includes('{s}') ? ['a', 'b', 'c'].map((s) => tileUrl.replace('{s}', s)) : [tileUrl];
  const origins = new Set();
  for (const v of variants) {
    try {
      const u = new URL(v.replace(/\{[^}]+\}/g, '0'));
      origins.add(u.origin);
    } catch {
      // Invalid template: ignore here; the map simply will not load tiles.
    }
  }
  return [...origins];
}

export function securityHeaders(mapConfig) {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:', ...tileOrigins(mapConfig.tileUrl)],
        // All provider calls go through this backend; the browser only talks to 'self'.
        'connect-src': ["'self'"],
        'font-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': null,
      },
    },
    // OSM tile policy asks that the Referer is sent; strict-origin keeps it to the origin only.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  });
}

function limiter({ windowMs, limit, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler: (req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message, requestId: req.id } });
    },
  });
}

export function createRateLimiters({ windowMs, apiMax, routesMax, geocodeMax, authMax, aiMax }) {
  return {
    api: limiter({ windowMs, limit: apiMax, message: 'Too many requests. Please slow down.' }),
    routes: limiter({
      windowMs,
      limit: routesMax,
      message: 'Too many route requests. Routing providers limit usage; wait a minute and try again.',
    }),
    geocode: limiter({ windowMs, limit: geocodeMax, message: 'Too many location searches. Wait a moment.' }),
    ai: limiter({ windowMs, limit: aiMax ?? 10, message: 'Too many AI requests. Wait a moment.' }),
    // Only failed auth attempts are counted, so legitimate authenticated traffic is unaffected.
    auth: limiter({
      windowMs,
      limit: authMax ?? 10,
      message: 'Too many failed sign-in attempts. Wait a minute and try again.',
      skipSuccessfulRequests: true,
    }),
  };
}
