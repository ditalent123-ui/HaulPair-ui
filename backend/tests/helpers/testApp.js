import crypto from 'node:crypto';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { createRoutingService } from '../../src/services/routing/routingService.js';
import { createLogger } from '../../src/utils/logger.js';
import { DatabaseError } from '../../src/utils/errors.js';

/**
 * Test doubles. These exist ONLY in tests so API behaviour can be checked
 * without PostgreSQL or network access. The geometry and distances below are
 * synthetic fixtures, not real routing results.
 */

export const TEST_SECRET = 'test-route-token-secret-0123456789abcdef';

export const TRUCKS = [
  {
    id: 1, code: 'demo_tractor_tipper', name: 'Demo profile', names: { lt: 'Demo', en: 'Demo' },
    tractorModelId: null, trailerModelId: null, truckType: 'tractor_semitrailer', capacityT: 24, cargoVolumeM3: null,
    fuelType: 'diesel', fuelConsumptionLPer100Km: 30, emptyFuelConsumptionLPer100Km: null,
    vehicle: { heightM: 4, widthM: 2.55, lengthM: 16.5, grossWeightT: 40, axleLoadT: 11.5 }, isDemoAssumption: true,
  },
];
export const CARGO = [
  { id: 1, code: 'wheat', name: 'Wheat', names: { lt: 'Kviečiai', en: 'Wheat' }, typicalDensityTPerM3: 0.72, notes: '' },
  { id: 6, code: 'rapeseed', name: 'Rapeseed', names: { lt: 'Rapsai', en: 'Rapeseed' }, typicalDensityTPerM3: null, notes: '' },
];

export function createFakeRepositories({ failDatabase = false } = {}) {
  const calculations = new Map();
  const activity = [];
  const fuelPricesStore = new Map();
  const fuelPriceHistory = [];
  const fail = () => {
    if (failDatabase) throw new DatabaseError(undefined, { cause: new Error('connection refused (simulated)') });
  };
  return {
    calculations,
    activity,
    healthRepository: { async ping() { fail(); } },
    referenceDataRepository: {
      async listTrucks() { fail(); return TRUCKS; },
      async getTruckById(id) { fail(); return TRUCKS.find((t) => t.id === id) ?? null; },
      async listCargoTypes() { fail(); return CARGO; },
      async getCargoTypeByCode(code) { fail(); return CARGO.find((c) => c.code === code) ?? null; },
    },
    calculationRepository: {
      async create(row) {
        fail();
        const id = crypto.randomUUID();
        const record = {
          id, createdAt: new Date().toISOString(), label: row.label, originLabel: row.origin_label,
          destinationLabel: row.destination_label, outboundDistanceKm: row.outbound_distance_km,
          totalCostEur: row.total_cost_eur, routingProvider: row.routing_provider, row,
        };
        calculations.set(id, record);
        return record;
      },
      async list({ limit, offset }) {
        fail();
        const items = [...calculations.values()].reverse();
        return { items: items.slice(offset, offset + limit), total: items.length };
      },
      async getById(id) { fail(); return calculations.get(id) ?? null; },
      async deleteById(id) { fail(); return calculations.delete(id); },
    },
    activityRepository: {
      async record(e) { fail(); activity.push(e); },
      async list({ limit }) { fail(); return activity.slice(-limit).reverse(); },
    },
    fuelPriceRepository: {
      async get(fuelType) { fail(); return fuelPricesStore.get(fuelType) ?? null; },
      async list() { fail(); return [...fuelPricesStore.values()]; },
      async listHistory(fuelType) { fail(); return fuelPriceHistory.filter((h) => h.fuelType === fuelType); },
      async upsert(record) {
        fail();
        const saved = { ...record, geography: record.geography ?? 'LT', method: record.method ?? 'manual_import', fetchedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        fuelPricesStore.set(record.fuelType, saved);
        fuelPriceHistory.push({ fuelType: saved.fuelType, priceDate: saved.priceDate, priceEurPerL: saved.priceEurPerL, sourceName: saved.sourceName, method: saved.method });
        return saved;
      },
    },
  };
}

/** Fake routing provider: fixed synthetic distances; records calls. */
export function createFakeProvider({ supportsTruckRestrictions = false, fail = null } = {}) {
  const calls = [];
  return {
    calls,
    name: supportsTruckRestrictions ? 'fake-hgv' : 'fake-car',
    displayName: 'Fake provider (tests)',
    profile: supportsTruckRestrictions ? 'driving-hgv' : 'driving',
    profileDescription: 'test',
    supportsTruckRestrictions,
    attribution: 'test',
    async route({ origin, destination, vehicle }) {
      calls.push({ origin, destination, vehicle });
      if (fail) throw fail;
      const outbound = origin.lat < destination.lat;
      return {
        distanceM: outbound ? 300_000 : 310_000,
        durationS: outbound ? 12_600 : 13_000,
        coordinates: [[origin.lon, origin.lat], [(origin.lon + destination.lon) / 2, (origin.lat + destination.lat) / 2], [destination.lon, destination.lat]],
      };
    },
  };
}

export function buildTestApp({ provider = createFakeProvider(), failDatabase = false, env = {}, aiCallModel, truckRoutingProvider, geocodingService: geocoderOverride } = {}) {
  // The legacy advanced API is enabled by default in tests so its existing suites keep running;
  // booking tests pass ADVANCED_TOOLS_ENABLED='false' to check the end-user configuration.
  const config = loadConfig({ NODE_ENV: 'test', ROUTE_TOKEN_SECRET: TEST_SECRET, RATE_LIMIT_API_MAX: '1000', RATE_LIMIT_ROUTES_MAX: '1000', ADVANCED_TOOLS_ENABLED: 'true', ...env }, { loadDotenv: false });
  const logger = createLogger({ level: 'silent' });
  const repos = createFakeRepositories({ failDatabase });
  const routingService = createRoutingService({ provider, tokenSecret: TEST_SECRET, tokenTtlS: 3600 });
  const geocodingService = geocoderOverride ?? {
    describe: () => ({ name: 'fake', supportsAutocomplete: true, attribution: 'test' }),
    async search({ query }) { return [{ label: `${query}, Lithuania`, name: query, countryCode: 'LT', type: 'city', lat: 54.9, lon: 23.9 }]; },
  };
  const app = createApp({ config, logger, deps: { ...repos, routingService, geocodingService, aiCallModel, truckRoutingProvider } });
  return { app, repos, provider, config };
}

export const VILNIUS = { lat: 54.6872, lon: 25.2797, label: 'Vilnius, Lithuania' };
export const KLAIPEDA = { lat: 55.7033, lon: 21.1443, label: 'Klaipėda, Lithuania' };
export const KAUNAS = { lat: 54.8985, lon: 23.9036, label: 'Kaunas' };

export function calculationBody(routeToken, overrides = {}) {
  return {
    routeToken,
    truckConfigurationId: 1,
    truck: { capacityT: 24, fuelType: 'diesel', fuelConsumptionLPer100Km: 30, ...(overrides.truck ?? {}) },
    cargo: { typeCode: 'wheat', quantityT: 20, ...(overrides.cargo ?? {}) },
    fuelPriceEurPerL: 1.5,
    returnTrip: overrides.returnTrip ?? { mode: 'none' },
    costs: { tollsEur: 10, loadingUnloadingEur: 40, otherEur: 0, ...(overrides.costs ?? {}) },
    ...(overrides.extra ?? {}),
  };
}
