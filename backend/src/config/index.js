import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: booleanString.default(false),
  TRUST_PROXY: booleanString.default(false),

  DATABASE_URL: optionalString,
  DATABASE_SSL: booleanString.default(false),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  // --- Access protection (shared HTTP Basic auth) ---
  // In production authentication is mandatory: the app refuses to start publicly without it.
  AUTH_ENABLED: booleanString.optional(),
  AUTH_USERNAME: optionalString,
  AUTH_PASSWORD: optionalString,
  AUTH_REALM: z.string().default('HaulPair (shared prototype access)'),

  ROUTING_PROVIDER: z.enum(['osrm', 'openrouteservice']).default('osrm'),
  OSRM_BASE_URL: z.url().default('https://router.project-osrm.org'),
  ORS_BASE_URL: z.url().default('https://api.openrouteservice.org'),
  ORS_API_KEY: optionalString,

  GEOCODER_PROVIDER: z.enum(['photon', 'openrouteservice']).default('photon'),
  PHOTON_BASE_URL: z.url().default('https://photon.komoot.io'),

  APP_USER_AGENT: z.string().min(5).default('HaulPairPlanner/0.2 (prototype)'),
  EXTERNAL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),

  // Shared ceilings for ALL outbound provider calls (routing + geocoding), on top of per-IP limits.
  EXTERNAL_DAILY_MAX: z.coerce.number().int().min(1).default(2000),
  EXTERNAL_MAX_CONCURRENT: z.coerce.number().int().min(1).max(100).default(6),

  MAP_TILE_URL: z.string().default('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  MAP_TILE_ATTRIBUTION: z
    .string()
    .default('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'),
  MAP_TILE_MAX_ZOOM: z.coerce.number().int().min(1).max(22).default(19),

  ROUTE_TOKEN_SECRET: optionalString,
  ROUTE_TOKEN_TTL_S: z.coerce.number().int().min(60).max(86400).default(3600),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_API_MAX: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_ROUTES_MAX: z.coerce.number().int().min(1).default(20),
  RATE_LIMIT_GEOCODE_MAX: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_AI_MAX: z.coerce.number().int().min(1).default(10),

  // --- AI "describe shipment" feature — Google Gemini only, off until configured ---
  // No key field in the public form; the admin sets these in the server environment.
  // A key alone is NOT proof of free usage: free-tier eligibility depends on the
  // project, model, region (incl. EU terms) and Google's current terms. No paid plan,
  // auto-reload or provider switch is ever activated.
  AI_ENABLED: booleanString.default(false),
  AI_DAILY_MAX: z.coerce.number().int().min(1).default(50),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().min(100).max(20000).default(2000),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_BASE_URL: z.url().default('https://generativelanguage.googleapis.com'),

  // --- End-user booking flow ---
  // Truck routing for quotes/orders/planner: 'auto' = openrouteservice driving-hgv when
  // ORS_API_KEY is set, otherwise the labelled DEMO route; 'demo' forces the demo route.
  TRUCK_ROUTING_PROVIDER: z.enum(['auto', 'openrouteservice', 'demo']).default('auto'),
  // Optional override of pricing.json marginPct (backend-only; never sent to the browser).
  PRICING_MARGIN_PCT: z.coerce.number().min(0).max(100).optional(),
  // How old the stored diesel price may get before the AI refreshes it (when AI is ready).
  DIESEL_AI_REFRESH_HOURS: z.coerce.number().min(1).max(168).default(12),
  // The legacy advanced planner (/advanced.html and its technical API endpoints) is an
  // internal tool, hidden from end users unless explicitly enabled.
  ADVANCED_TOOLS_ENABLED: booleanString.default(false),

  // --- AI-assisted fuel price (off; source not yet provided) ---
  FUEL_PRICE_ENABLED: booleanString.default(false),
  FUEL_PRICE_SOURCE_URL: optionalString,
  FUEL_PRICE_ADMIN_TOKEN: optionalString,
  FUEL_PRICE_MAX_AGE_HOURS: z.coerce.number().int().min(1).default(48),
});

export class ConfigError extends Error {}

/**
 * Build a validated, frozen configuration object from environment variables.
 * Accepts an explicit env object so tests can construct configs without touching process.env.
 */
export function loadConfig(env = process.env, { loadDotenv = true } = {}) {
  if (loadDotenv && env === process.env) {
    dotenv.config({ quiet: true });
  }

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid environment configuration: ${problems}`);
  }
  const e = parsed.data;

  if (e.NODE_ENV !== 'test' && !e.DATABASE_URL) {
    throw new ConfigError('DATABASE_URL is required. Copy .env.example to .env and set it.');
  }
  if (e.TRUCK_ROUTING_PROVIDER === 'openrouteservice' && !e.ORS_API_KEY) {
    throw new ConfigError('ORS_API_KEY is required when TRUCK_ROUTING_PROVIDER is "openrouteservice" (use "auto" to fall back to the demo route).');
  }
  if ((e.ROUTING_PROVIDER === 'openrouteservice' || e.GEOCODER_PROVIDER === 'openrouteservice') && !e.ORS_API_KEY) {
    throw new ConfigError('ORS_API_KEY is required when ROUTING_PROVIDER or GEOCODER_PROVIDER is "openrouteservice".');
  }

  // Access protection. Mandatory in production; opt-in elsewhere via AUTH_ENABLED.
  const authEnabled = e.AUTH_ENABLED ?? e.NODE_ENV === 'production';
  if (authEnabled) {
    if (!e.AUTH_USERNAME || !e.AUTH_PASSWORD) {
      throw new ConfigError(
        e.NODE_ENV === 'production'
          ? 'AUTH_USERNAME and AUTH_PASSWORD are required in production. The app will not start publicly without access protection.'
          : 'AUTH_USERNAME and AUTH_PASSWORD are required when AUTH_ENABLED=true.',
      );
    }
    if (e.AUTH_PASSWORD.length < 8) {
      throw new ConfigError('AUTH_PASSWORD must be at least 8 characters.');
    }
  } else if (e.NODE_ENV === 'production') {
    // Defensive: authEnabled is already forced true in production, but keep an explicit guard.
    throw new ConfigError('Access protection is mandatory in production.');
  }

  let routeTokenSecret = e.ROUTE_TOKEN_SECRET;
  let routeTokenSecretGenerated = false;
  if (!routeTokenSecret) {
    if (e.NODE_ENV === 'production') {
      throw new ConfigError('ROUTE_TOKEN_SECRET must be set in production (at least 32 random characters).');
    }
    // Development fallback: tokens become invalid after a restart, which is acceptable locally.
    routeTokenSecret = crypto.randomBytes(32).toString('hex');
    routeTokenSecretGenerated = true;
  } else if (routeTokenSecret.length < 32) {
    throw new ConfigError('ROUTE_TOKEN_SECRET must be at least 32 characters long.');
  }

  // AI is "ready" only when enabled AND a Gemini key is present. A missing key never
  // throws — the feature stays off and the manual form keeps working.
  const aiReady = e.AI_ENABLED && Boolean(e.GEMINI_API_KEY);
  const aiDisabledReason = !e.AI_ENABLED ? 'disabled' : !e.GEMINI_API_KEY ? 'no_api_key' : null;

  return Object.freeze({
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    host: e.HOST,
    port: e.PORT,
    trustProxy: e.TRUST_PROXY,
    log: Object.freeze({ level: e.LOG_LEVEL, pretty: e.LOG_PRETTY }),
    auth: Object.freeze({
      enabled: authEnabled,
      username: e.AUTH_USERNAME,
      password: e.AUTH_PASSWORD,
      realm: e.AUTH_REALM,
    }),
    database: Object.freeze({
      url: e.DATABASE_URL,
      ssl: e.DATABASE_SSL,
      poolMax: e.DATABASE_POOL_MAX,
    }),
    http: Object.freeze({
      userAgent: e.APP_USER_AGENT,
      timeoutMs: e.EXTERNAL_TIMEOUT_MS,
    }),
    external: Object.freeze({
      dailyMax: e.EXTERNAL_DAILY_MAX,
      maxConcurrent: e.EXTERNAL_MAX_CONCURRENT,
    }),
    routing: Object.freeze({
      provider: e.ROUTING_PROVIDER,
      osrmBaseUrl: e.OSRM_BASE_URL,
      orsBaseUrl: e.ORS_BASE_URL,
      orsApiKey: e.ORS_API_KEY,
      tokenSecret: routeTokenSecret,
      tokenSecretGenerated: routeTokenSecretGenerated,
      tokenTtlS: e.ROUTE_TOKEN_TTL_S,
    }),
    geocoding: Object.freeze({
      provider: e.GEOCODER_PROVIDER,
      photonBaseUrl: e.PHOTON_BASE_URL,
      orsBaseUrl: e.ORS_BASE_URL,
      orsApiKey: e.ORS_API_KEY,
    }),
    booking: Object.freeze({
      truckRouting: e.TRUCK_ROUTING_PROVIDER,
      marginPctOverride: e.PRICING_MARGIN_PCT,
      dieselRefreshHours: e.DIESEL_AI_REFRESH_HOURS,
    }),
    advancedTools: Object.freeze({ enabled: e.ADVANCED_TOOLS_ENABLED }),
    ai: Object.freeze({
      enabled: e.AI_ENABLED,
      ready: aiReady,
      provider: 'gemini',
      disabledReason: aiDisabledReason,
      dailyMax: e.AI_DAILY_MAX,
      maxInputChars: e.AI_MAX_INPUT_CHARS,
      timeoutMs: e.AI_TIMEOUT_MS,
      apiKey: e.GEMINI_API_KEY,
      model: e.GEMINI_MODEL,
      baseUrl: e.GEMINI_BASE_URL,
    }),
    fuelPrice: Object.freeze({
      enabled: e.FUEL_PRICE_ENABLED,
      sourceUrl: e.FUEL_PRICE_SOURCE_URL,
      adminToken: e.FUEL_PRICE_ADMIN_TOKEN,
      maxAgeHours: e.FUEL_PRICE_MAX_AGE_HOURS,
    }),
    map: Object.freeze({
      tileUrl: e.MAP_TILE_URL,
      tileAttribution: e.MAP_TILE_ATTRIBUTION,
      maxZoom: e.MAP_TILE_MAX_ZOOM,
    }),
    rateLimit: Object.freeze({
      windowMs: e.RATE_LIMIT_WINDOW_MS,
      apiMax: e.RATE_LIMIT_API_MAX,
      routesMax: e.RATE_LIMIT_ROUTES_MAX,
      geocodeMax: e.RATE_LIMIT_GEOCODE_MAX,
      authMax: e.RATE_LIMIT_AUTH_MAX,
      aiMax: e.RATE_LIMIT_AI_MAX,
    }),
  });
}
