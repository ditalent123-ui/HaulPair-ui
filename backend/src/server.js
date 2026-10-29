import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config/index.js';
import { buildDependencies } from './container.js';
import { createLogger } from './utils/logger.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`Configuration error: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const logger = createLogger(config.log);
const { pool, deps } = buildDependencies(config, logger);

if (config.routing.tokenSecretGenerated) {
  logger.warn('ROUTE_TOKEN_SECRET is not set; using a random per-process secret (route tokens reset on restart).');
}

// Fail early with a clear message if the database is unreachable or not migrated.
try {
  await pool.query('SELECT 1 FROM transport_calculations LIMIT 1');
} catch (err) {
  const hint =
    err.code === '42P01'
      ? 'The schema is missing — run "npm run db:migrate".'
      : 'Check DATABASE_URL and that PostgreSQL is running (e.g. "docker compose up -d db").';
  logger.fatal({ err: { message: err.message, code: err.code } }, `Database check failed. ${hint}`);
  await pool.end().catch(() => {});
  process.exit(1);
}

const app = createApp({ config, logger, deps });
const server = app.listen(config.port, config.host, () => {
  logger.info(
    {
      url: `http://${config.host}:${config.port}`,
      routingProvider: config.routing.provider,
      geocodingProvider: config.geocoding.provider,
      env: config.env,
    },
    'Vilkašia API listening (local prototype — no authentication)',
  );
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
