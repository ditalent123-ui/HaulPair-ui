import { createPool } from './database/pool.js';
import { createActivityRepository, createHealthRepository } from './database/repositories/activityRepository.js';
import { createCalculationRepository } from './database/repositories/calculationRepository.js';
import { createFuelPriceRepository } from './database/repositories/fuelPriceRepository.js';
import { createReferenceDataRepository } from './database/repositories/referenceDataRepository.js';
import { createGeocodingProvider, createGeocodingService } from './services/geocoding/geocodingService.js';
import { createRoutingProvider, createRoutingService } from './services/routing/routingService.js';
import { createHttpClient } from './utils/httpClient.js';

/** Wire real infrastructure (PostgreSQL, HTTP providers) for the running server. */
export function buildDependencies(config, logger) {
  const pool = createPool(config.database, logger);
  const requestJson = createHttpClient(config.http);

  const routingService = createRoutingService({
    provider: createRoutingProvider(config.routing, requestJson),
    tokenSecret: config.routing.tokenSecret,
    tokenTtlS: config.routing.tokenTtlS,
  });
  const geocodingService = createGeocodingService({
    provider: createGeocodingProvider(config.geocoding, requestJson),
  });

  return {
    pool,
    deps: {
      healthRepository: createHealthRepository(pool),
      referenceDataRepository: createReferenceDataRepository(pool),
      calculationRepository: createCalculationRepository(pool),
      fuelPriceRepository: createFuelPriceRepository(pool),
      activityRepository: createActivityRepository(pool),
      routingService,
      geocodingService,
      // Used by the booking truck router (openrouteservice driving-hgv when a key is set).
      requestJson,
    },
  };
}
