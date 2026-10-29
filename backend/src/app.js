import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { pinoHttp } from 'pino-http';

import { createAiController } from './controllers/aiController.js';
import { createBookingController } from './controllers/bookingController.js';
import { createFuelPriceController } from './controllers/fuelPriceController.js';
import { createCalculationController } from './controllers/calculationController.js';
import { createLogisticsController } from './controllers/logisticsController.js';
import { createReferenceDataController } from './controllers/referenceDataController.js';
import { createRoutingController } from './controllers/routingController.js';
import { createSystemController } from './controllers/systemController.js';
import { createAccessControl, createCsrfGuard } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createRateLimiters, securityHeaders } from './middleware/security.js';
import { createApiRouter } from './routes/index.js';
import { createActivityService } from './services/activityService.js';
import { createCalculationService } from './services/calculationService.js';
import { createExternalQuota } from './services/externalQuota.js';
import { createGeminiClient } from './services/ai/geminiClient.js';
import { createShipmentAiService } from './services/ai/shipmentParser.js';
import { createDieselPriceAi } from './services/ai/dieselPriceAi.js';
import { loadBookingCatalog } from './services/booking/catalog.js';
import { createMarketPrices } from './services/booking/marketPrices.js';
import { createPlaceSearch } from './services/booking/places.js';
import { createPlannerService } from './services/booking/plannerService.js';
import { createQuoteService } from './services/booking/quoteService.js';
import { createDieselPriceService } from './services/fuelPrice/dieselPriceService.js';
import { createTruckRouter } from './services/routing/truckRouter.js';

/** Build the Gemini client when AI is ready; otherwise null (service throws AI_DISABLED, no call). */
function buildAiClient(ai) {
  if (!ai.ready) return null;
  return createGeminiClient({ apiKey: ai.apiKey, model: ai.model, baseUrl: ai.baseUrl, timeoutMs: ai.timeoutMs });
}
import { createFuelPriceService } from './services/fuelPrice/fuelPriceService.js';

/** Booking-flow services (catalog, truck router, AI-managed diesel price, quotes, planner). */
function buildBookingServices({ config, logger, deps, externalQuota, aiQuota, aiCallModel }) {
  const marginOverride = config.booking.marginPctOverride;
  const catalog = deps.bookingCatalog ?? loadBookingCatalog({ overrides: marginOverride === undefined ? {} : { pricing: { marginPct: marginOverride } } });
  const truckRouter =
    deps.truckRouter ??
    createTruckRouter({
      mode: config.booking.truckRouting,
      orsBaseUrl: config.routing.orsBaseUrl,
      orsApiKey: config.routing.orsApiKey,
      requestJson: deps.requestJson,
      realProvider: deps.truckRoutingProvider,
      demoOptions: catalog.pricing.demoRoute,
      logger,
      quota: externalQuota,
    });
  // The AI manages exactly one input: the current diesel price. Off unless AI is ready.
  const dieselAi = config.ai.ready && aiCallModel
    ? createDieselPriceAi({
        callModel: async (args) => {
          const release = aiQuota.reserve('AI diesel price');
          try {
            return await aiCallModel(args);
          } finally {
            release();
          }
        },
      })
    : null;
  const dieselPrice = createDieselPriceService({
    fuelPriceRepository: deps.fuelPriceRepository,
    dieselAi,
    demoSeed: catalog.market.diesel,
    refreshHours: config.booking.dieselRefreshHours,
    logger,
  });
  const marketPrices = createMarketPrices({ catalog });
  const quoteService = createQuoteService({ catalog, truckRouter, dieselPrice, tokenSecret: config.routing.tokenSecret, logger });
  const plannerService = createPlannerService({ catalog, truckRouter, dieselPrice, marketPrices });
  const placeSearch = createPlaceSearch({ geocodingService: deps.geocodingService, catalog, logger, quota: externalQuota });
  return { catalog, truckRouter, dieselPrice, marketPrices, quoteService, plannerService, placeSearch };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(here, '../../frontend');
const require = createRequire(import.meta.url);
const LEAFLET_DIST = path.dirname(require.resolve('leaflet/dist/leaflet.css'));
const { version } = require('../../package.json');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Build the Express application from explicit dependencies, so tests can
 * substitute repositories and providers without network or database access.
 *
 * deps: { healthRepository, referenceDataRepository, calculationRepository,
 *         activityRepository, routingService, geocodingService }
 */
export function createApp({ config, logger, deps }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // Log only what is needed to operate the service: no IPs, headers, or query strings
      // (location searches can contain addresses).
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, path: req.url?.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => !req.url.startsWith('/api/') },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );

  app.use(securityHeaders(config.map));

  const limiters = createRateLimiters(config.rateLimit);

  // Access protection covers the whole app (static frontend + API), except the
  // minimal public health check. A pass-through when auth is disabled (dev).
  app.use(createAccessControl({ auth: config.auth, authLimiter: limiters.auth }));

  app.use(express.json({ limit: '32kb', strict: true }));
  // CSRF defence for state-changing /api requests once shared credentials exist.
  app.use('/api', createCsrfGuard({ auth: config.auth }));

  const externalQuota = createExternalQuota(config.external);
  // AI has its own small daily budget (default 50/day), sharing the concurrency ceiling.
  const aiQuota = createExternalQuota({ dailyMax: config.ai.dailyMax, maxConcurrent: config.external.maxConcurrent });

  const activityService = createActivityService({ activityRepository: deps.activityRepository, logger });
  const calculationService = createCalculationService({
    calculationRepository: deps.calculationRepository,
    referenceDataRepository: deps.referenceDataRepository,
    activityService,
    routeTokenSecret: config.routing.tokenSecret,
  });

  const aiCallModel = deps.aiCallModel ?? buildAiClient(config.ai) ?? undefined;
  const booking = buildBookingServices({ config, logger, deps, externalQuota, aiQuota, aiCallModel });

  const controllers = {
    booking: createBookingController({ ...booking, activityService }),
    system: createSystemController({
      config,
      healthRepository: deps.healthRepository,
      routingService: deps.routingService,
      geocodingService: deps.geocodingService,
      version,
      startedAt: Date.now(),
    }),
    routing: createRoutingController({
      routingService: deps.routingService,
      geocodingService: deps.geocodingService,
      activityService,
    }),
    calculations: createCalculationController({ calculationService }),
    reference: createReferenceDataController({ referenceDataRepository: deps.referenceDataRepository, activityService }),
    logistics: createLogisticsController(),
    ai: createAiController({
      shipmentAiService: createShipmentAiService({
        config: config.ai,
        getGrainTypes: async () => (await deps.referenceDataRepository.listCargoTypes()).map((c) => c.code),
        // Real client only for the selected, ready provider; otherwise the service
        // throws AI_DISABLED before any provider call. Tests inject a fake callModel.
        callModel: aiCallModel,
        quota: aiQuota,
      }),
      activityService,
      maxInputChars: config.ai.maxInputChars,
    }),
    fuelPrice: createFuelPriceController({
      fuelPriceService: createFuelPriceService({ config: config.fuelPrice, fuelPriceRepository: deps.fuelPriceRepository }),
      onImported: () => booking.dieselPrice.invalidate(),
      fuelPriceRepository: deps.fuelPriceRepository,
      activityService,
      adminToken: config.fuelPrice.adminToken,
    }),
  };

  app.use('/api', limiters.api, (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', createApiRouter({ controllers, limiters, externalQuota, advancedTools: config.advancedTools.enabled }));
  app.use('/api', notFoundHandler);

  app.use('/vendor/leaflet', express.static(LEAFLET_DIST, { maxAge: '7d', index: false }));
  // The legacy advanced planner is an internal tool, not part of the end-user app.
  if (!config.advancedTools.enabled) {
    app.get('/advanced.html', (_req, res) => res.status(404).type('text/plain').send('Not found'));
  }
  app.use(express.static(FRONTEND_DIR, { maxAge: config.isProduction ? '1h' : 0, index: 'index.html' }));

  app.use(errorHandler);
  return app;
}
