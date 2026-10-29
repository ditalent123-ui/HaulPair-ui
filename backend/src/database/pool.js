import pg from 'pg';

// Return NUMERIC columns as JS numbers. Our NUMERIC columns are bounded
// (≤ 12 significant digits), so this is lossless for the values we store.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => (value === null ? null : Number(value)));
// BIGINT ids from activity_logs stay as strings to avoid precision loss.

export function createPool({ url, ssl, poolMax }, logger) {
  const pool = new pg.Pool({
    connectionString: url,
    max: poolMax,
    ssl: ssl ? { rejectUnauthorized: true } : undefined,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    application_name: 'grain-transport-api',
  });
  pool.on('error', (err) => {
    // Errors on idle clients (e.g. the server restarted). The pool replaces the client.
    logger?.error({ err: { message: err.message, code: err.code } }, 'PostgreSQL idle client error');
  });
  return pool;
}
