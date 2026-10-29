import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { createPool } from '../../src/database/pool.js';
import { migrate } from '../../src/database/migrate.js';
import { createActivityRepository, createHealthRepository } from '../../src/database/repositories/activityRepository.js';
import { createCalculationRepository } from '../../src/database/repositories/calculationRepository.js';
import { createReferenceDataRepository } from '../../src/database/repositories/referenceDataRepository.js';
import { createRoutingService } from '../../src/services/routing/routingService.js';
import { createLogger } from '../../src/utils/logger.js';
import { calculationBody, createFakeProvider, KLAIPEDA, TEST_SECRET, VILNIUS } from '../helpers/testApp.js';

/**
 * Runs against a real PostgreSQL database given by TEST_DATABASE_URL.
 * WARNING: it deletes all rows from transport_calculations and activity_logs in that database.
 * Routing uses the synthetic test provider; persistence is real.
 */
dotenv.config({ quiet: true });
const url = process.env.TEST_DATABASE_URL;

describe('PostgreSQL integration', { skip: !url && 'TEST_DATABASE_URL not set' }, () => {
  let pool;
  const logger = createLogger({ level: 'silent' });

  function buildApp(p) {
    const config = loadConfig({ NODE_ENV: 'test', ROUTE_TOKEN_SECRET: TEST_SECRET, ADVANCED_TOOLS_ENABLED: 'true' }, { loadDotenv: false });
    return createApp({
      config,
      logger,
      deps: {
        healthRepository: createHealthRepository(p),
        referenceDataRepository: createReferenceDataRepository(p),
        calculationRepository: createCalculationRepository(p),
        activityRepository: createActivityRepository(p),
        routingService: createRoutingService({ provider: createFakeProvider(), tokenSecret: TEST_SECRET, tokenTtlS: 600 }),
        geocodingService: { describe: () => ({ name: 'none', supportsAutocomplete: false }), search: async () => [] },
      },
    });
  }

  before(async () => {
    pool = createPool({ url, ssl: false, poolMax: 4 });
    const client = await pool.connect();
    try {
      await migrate(client, { log: () => {} });
      await client.query('DELETE FROM transport_calculations');
      await client.query('DELETE FROM activity_logs');
    } finally {
      client.release();
    }
  });

  after(async () => {
    await pool?.end();
  });

  it('migrations are idempotent', async () => {
    const client = await pool.connect();
    try {
      assert.deepEqual(await migrate(client, { log: () => {} }), []);
    } finally {
      client.release();
    }
  });

  it('serves seeded reference data with Lithuanian names', async () => {
    const app = buildApp(pool);
    const trucks = (await request(app).get('/api/trucks')).body.data;
    assert.ok(trucks.length >= 4);
    assert.ok(trucks.every((t) => t.capacityT === 24 && t.fuelConsumptionLPer100Km === 30));
    assert.equal(trucks.find((t) => t.code === 'volvo_fh_aero_ski_light_59').tractorModelId, 'volvo_fh_aero_420_isave');
    const cargo = (await request(app).get('/api/cargo-types')).body.data;
    assert.equal(cargo.find((c) => c.code === 'wheat').names.lt, 'Kviečiai');
    assert.equal(cargo.find((c) => c.code === 'rapeseed').typicalDensityTPerM3, null);
  });

  it('persists a calculation that survives a new connection pool (restart)', async () => {
    const app = buildApp(pool);
    const route = (await request(app).post('/api/routes').send({ origin: VILNIUS, destination: KLAIPEDA, includeReturn: true })).body.data;
    const trucks = (await request(app).get('/api/trucks')).body.data;
    const body = calculationBody(route.routeToken, { returnTrip: { mode: 'loaded', cargoQuantityT: 18 }, extra: { label: 'Integration' } });
    body.truckConfigurationId = trucks[0].id;
    const created = await request(app).post('/api/calculations').send(body);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.id;
    assert.equal(created.body.data.outboundDistanceKm, 300);
    assert.equal(created.body.data.returnMode, 'loaded');

    // Simulate an application restart with a fresh pool.
    const pool2 = createPool({ url, ssl: false, poolMax: 2 });
    try {
      const app2 = buildApp(pool2);
      const list = await request(app2).get('/api/calculations');
      assert.equal(list.body.meta.total, 1);
      const full = (await request(app2).get(`/api/calculations/${id}`)).body.data;
      assert.equal(full.label, 'Integration');
      assert.equal(full.origin.label, VILNIUS.label);
      assert.equal(full.inputs.cargo.quantityT, 20);
      // fuel: 300 km + 310 km at 30 l/100 km = 183 l × 1.5 = 274.5 EUR; + 50 EUR tolls/loading (no driver expenses)
      assert.equal(full.costs.fuelLitres, 183);
      assert.equal(full.costs.totalCostEur, 324.5);
      assert.equal(full.results.calculation.rounded.totalCostEur, 324.5);
      assert.equal(full.truckSnapshot.capacityT, 24);
      // Localised cargo names are available for the history list (wheat → Kviečiai).
      assert.equal(list.body.data[0].cargoTypeNames.lt, 'Kviečiai');
      assert.equal(list.body.data[0].cargoTypeNames.en, 'Wheat');
      // Fuel-price origin snapshot defaults to manual when no meta is sent.
      assert.equal(full.fuelPrice.origin, 'manual');

      const del = await request(app2).delete(`/api/calculations/${id}`);
      assert.equal(del.status, 200);
      assert.equal((await request(app2).get(`/api/calculations/${id}`)).status, 404);

      const activity = (await request(app2).get('/api/activity')).body.data.map((a) => a.eventType);
      assert.deepEqual(activity.slice(0, 3), ['calculation.deleted', 'calculation.created', 'route.requested']);
    } finally {
      await pool2.end();
    }
  });

  it('database constraints reject impossible rows even if the API were bypassed', async () => {
    await assert.rejects(
      pool.query(
        `INSERT INTO transport_calculations (calculation_version, origin_label, origin_lat, origin_lon, destination_label,
          destination_lat, destination_lon, routing_provider, routing_profile, truck_restrictions_applied, outbound_distance_km,
          return_mode, truck_snapshot, truck_capacity_t, fuel_type, fuel_consumption_l_100km, fuel_price_eur_l, cargo_type_id,
          cargo_type_code, cargo_quantity_t, fuel_litres, fuel_cost_eur, total_cost_eur, cost_per_tonne_eur, cost_per_tonne_km_eur,
          capacity_utilization_pct, inputs, results)
         VALUES ('1', 'a', 54, 25, 'b', 55, 21, 'x', 'y', false, 100, 'none', '{}', 10, 'diesel', 30, 1.5,
          (SELECT id FROM cargo_types WHERE code='wheat'), 'wheat', 12, 30, 45, 45, 3.75, 0.0375, 100, '{}', '{}')`,
      ),
      /cargo_within_capacity/,
    );
  });

  it('returns 503 when the database is unreachable', async () => {
    const dead = createPool({ url: 'postgres://nobody:nothing@127.0.0.1:1/none', ssl: false, poolMax: 1 });
    try {
      const res = await request(buildApp(dead)).get('/api/calculations');
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, 'DATABASE_ERROR');
    } finally {
      await dead.end();
    }
  });
});
