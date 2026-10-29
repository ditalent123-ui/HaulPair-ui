import pino from 'pino';

// Paths that must never reach log output. pino replaces them with "[Redacted]".
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.apiKey',
  '*.api_key',
  '*.password',
  '*.token',
  '*.routeToken',
  '*.secret',
];

export function createLogger({ level = 'info', pretty = false } = {}) {
  return pino({
    level,
    base: { service: 'grain-transport-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
    transport: pretty ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } : undefined,
  });
}
