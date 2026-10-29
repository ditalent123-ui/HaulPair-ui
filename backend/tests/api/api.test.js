import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { NoRouteError } from '../../src/utils/errors.js';
import { buildTestApp, calculationBody, createFakeProvider, KLAIPEDA, VILNIUS } from '../helpers/testApp.js';

async function getRoute(app, extra = {}) {
  const res = await request(app).post('/api/routes').send({ origin: VILNIUS, destination: KLAIPEDA, ...extra });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

describe('system endpoints', () => {
  it('GET /api/health reports ok', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'ok');
    assert.ok(res.headers['x-request-id']);
    assert.ok(res.headers['content-security-policy'].includes("connect-src 'self'"));
  });

  it('GET /api/health returns 503 when the database fails', async () => {
    const { app } = buildTestApp({ failDatabase: true });
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 503);
    assert.equal(res.body.data.status, 'degraded');
  });

  it('GET /api/config exposes no secrets', async () => {
    const { app } = buildTestApp({ env: { ORS_API_KEY: 'secret-ors-key-should-not-leak' } });
    const res = await request(app).get('/api/config');
    assert.equal(res.status, 200);
    assert.ok(!JSON.stringify(res.body).includes('secret-ors-key'));
    assert.equal(res.body.data.accessProtection, false);
    assert.equal(res.body.data.appName, 'HaulPair');
  });

  it('unknown API routes return JSON 404', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('serves the frontend and Leaflet', async () => {
    const { app } = buildTestApp();
    const html = await request(app).get('/');
    assert.equal(html.status, 200);
    // The end-user app is served at /; the legacy advanced planner stays reachable when enabled.
    assert.match(html.text, /js\/user\/main\.js/);
    const advanced = await request(app).get('/advanced.html');
    assert.equal(advanced.status, 200);
    assert.match(advanced.text, /js\/app\.js/);
    const leaflet = await request(app).get('/vendor/leaflet/leaflet-src.esm.js');
    assert.equal(leaflet.status, 200);
  });
});

describe('reference data', () => {
  it('GET /api/trucks and /api/cargo-types', async () => {
    const { app } = buildTestApp();
    assert.equal((await request(app).get('/api/trucks')).body.data[0].code, 'demo_tractor_tipper');
    assert.equal((await request(app).get('/api/cargo-types')).body.data[0].names.lt, 'Kviečiai');
  });
  it('returns 503 DATABASE_ERROR when the database fails', async () => {
    const { app } = buildTestApp({ failDatabase: true });
    const res = await request(app).get('/api/trucks');
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'DATABASE_ERROR');
    assert.ok(!JSON.stringify(res.body).includes('connection refused'), 'driver details must not leak');
  });
});

describe('POST /api/routes', () => {
  it('returns geometry, warnings and a signed token', async () => {
    const { app } = buildTestApp();
    const data = await getRoute(app, { includeReturn: true });
    assert.equal(data.outbound.distanceKm, 300);
    assert.equal(data.return.distanceKm, 310);
    assert.ok(data.outbound.geometry.length >= 2);
    assert.equal(data.truckRestrictionsApplied, false);
    assert.ok(data.routeToken.includes('.'));
  });

  it('validates coordinates and rejects unknown fields', async () => {
    const { app } = buildTestApp();
    const bad = await request(app).post('/api/routes').send({ origin: { ...VILNIUS, lat: 123 }, destination: KLAIPEDA });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.details[0].field, 'origin.lat');
    const extra = await request(app).post('/api/routes').send({ origin: VILNIUS, destination: KLAIPEDA, evil: 1 });
    assert.equal(extra.status, 400);
    const same = await request(app).post('/api/routes').send({ origin: VILNIUS, destination: VILNIUS });
    assert.equal(same.status, 400);
  });

  it('maps provider failures to clear errors and logs the failure', async () => {
    const { app, repos } = buildTestApp({ provider: createFakeProvider({ fail: new NoRouteError() }) });
    const res = await request(app).post('/api/routes').send({ origin: VILNIUS, destination: KLAIPEDA });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NO_ROUTE');
    assert.equal(repos.activity.at(-1).eventType, 'route.failed');
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    const { app } = buildTestApp();
    const bad = await request(app).post('/api/routes').set('Content-Type', 'application/json').send('{oops');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'INVALID_JSON');
    const big = await request(app).post('/api/routes').send({ origin: { ...VILNIUS, label: 'x'.repeat(40_000) }, destination: KLAIPEDA });
    assert.equal(big.status, 413);
  });
});

describe('calculations', () => {
  it('estimates using the signed route distance', async () => {
    const { app } = buildTestApp();
    const route = await getRoute(app);
    const res = await request(app).post('/api/calculations/estimate').send(calculationBody(route.routeToken));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const calc = res.body.data.calculation;
    // 300 km × 30 l/100 km = 90 l × 1.5 = 135 EUR; + 10 + 40 = 185 EUR (no driver expenses)
    assert.equal(calc.rounded.fuelLitres, 90);
    assert.equal(calc.rounded.totalCostEur, 185);
    assert.equal(calc.rounded.costPerTonneEur, 9.25); // 185 / 20 t
    assert.equal(res.body.data.sources.distance, 'routing_provider');
    // Density was not provided and is never silently assumed by grain type.
    assert.equal(res.body.data.sources.cargoDensity, null);
  });

  it('bulk density is optional and 0 is allowed; volume only for positive density', async () => {
    const { app } = buildTestApp();
    const route = await getRoute(app);
    const base = (density) => calculationBody(route.routeToken, { truck: { cargoVolumeM3: 59 }, cargo: density === undefined ? {} : { densityTPerM3: density } });

    const omitted = await request(app).post('/api/calculations/estimate').send(base(undefined));
    assert.equal(omitted.status, 200, JSON.stringify(omitted.body));
    assert.equal(omitted.body.data.calculation.rounded.volumeUtilizationPct, null);
    assert.equal(omitted.body.data.sources.cargoDensity, null);

    const zero = await request(app).post('/api/calculations/estimate').send(base(0));
    assert.equal(zero.status, 200, JSON.stringify(zero.body));
    assert.equal(zero.body.data.calculation.rounded.volumeUtilizationPct, null);
    assert.equal(zero.body.data.sources.cargoDensity, 'user_input');

    const positive = await request(app).post('/api/calculations/estimate').send(base(0.72));
    assert.equal(positive.status, 200, JSON.stringify(positive.body));
    assert.ok(positive.body.data.calculation.rounded.volumeUtilizationPct > 0);
    assert.equal(positive.body.data.sources.cargoDensity, 'user_input');

    const negative = await request(app).post('/api/calculations/estimate').send(base(-1));
    assert.equal(negative.status, 400);
    assert.equal(negative.body.error.details[0].field, 'cargo.densityTPerM3');
  });

  it('rejects requests without route data', async () => {
    const { app } = buildTestApp();
    const body = calculationBody('x');
    delete body.routeToken;
    const res = await request(app).post('/api/calculations/estimate').send(body);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].field, 'routeToken');
  });

  it('rejects a tampered route token', async () => {
    const { app } = buildTestApp();
    const route = await getRoute(app);
    const [payload, sig] = route.routeToken.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    decoded.outbound.distanceKm = 1;
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${sig}`;
    const res = await request(app).post('/api/calculations/estimate').send(calculationBody(forged));
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /signature/);
  });

  it('rejects cargo over capacity with 422', async () => {
    const { app } = buildTestApp();
    const route = await getRoute(app);
    const res = await request(app).post('/api/calculations/estimate').send(calculationBody(route.routeToken, { cargo: { quantityT: 25 } }));
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'CALCULATION_REJECTED');
    assert.equal(res.body.error.details[0].field, 'cargo.quantityT');
  });

  it('rejects invalid payloads (types, negatives, zero fuel price, unknown cargo)', async () => {
    const { app } = buildTestApp();
    const route = await getRoute(app);
    const cases = [
      [{ ...calculationBody(route.routeToken), fuelPriceEurPerL: 0 }, 'fuelPriceEurPerL'],
      [{ ...calculationBody(route.routeToken), fuelPriceEurPerL: '1.5' }, 'fuelPriceEurPerL'],
      [calculationBody(route.routeToken, { truck: { fuelConsumptionLPer100Km: -3 } }), 'truck.fuelConsumptionLPer100Km'],
      [calculationBody(route.routeToken, { costs: { tollsEur: -5 } }), 'costs.tollsEur'],
      [calculationBody(route.routeToken, { cargo: { quantityT: 0 } }), 'cargo.quantityT'],
    ];
    for (const [body, field] of cases) {
      const res = await request(app).post('/api/calculations/estimate').send(body);
      assert.equal(res.status, 400, `${field}: ${JSON.stringify(res.body)}`);
      assert.ok(res.body.error.details.some((d) => d.field === field), `${field} not reported`);
    }
    const unknown = await request(app).post('/api/calculations/estimate').send(calculationBody(route.routeToken, { cargo: { typeCode: 'gold' } }));
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.details[0].field, 'cargo.typeCode');
  });

  it('requires a return route for a return trip', async () => {
    const { app } = buildTestApp();
    const route = await getRoute(app); // without includeReturn
    const res = await request(app).post('/api/calculations/estimate').send(calculationBody(route.routeToken, { returnTrip: { mode: 'empty' } }));
    assert.equal(res.status, 422);
    assert.equal(res.body.error.details[0].field, 'route.return.distanceKm');
  });

  it('creates, lists, reads and deletes a calculation, logging activity', async () => {
    const { app, repos } = buildTestApp();
    const route = await getRoute(app, { includeReturn: true });
    const created = await request(app)
      .post('/api/calculations')
      .send(calculationBody(route.routeToken, { returnTrip: { mode: 'empty' }, extra: { label: 'Test' } }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.id;
    assert.equal(created.headers.location, `/api/calculations/${id}`);
    const row = repos.calculations.get(id).row;
    assert.equal(row.outbound_distance_km, 300);
    assert.equal(row.return_distance_km, 310);
    assert.equal(row.return_mode, 'empty');
    assert.equal(row.inputs.route.outbound.distanceKm, 300);

    const list = await request(app).get('/api/calculations');
    assert.equal(list.body.meta.total, 1);
    assert.equal((await request(app).get(`/api/calculations/${id}`)).status, 200);
    assert.equal((await request(app).delete(`/api/calculations/${id}`)).body.data.deleted, true);
    assert.equal((await request(app).get(`/api/calculations/${id}`)).status, 404);
    assert.equal((await request(app).delete(`/api/calculations/${id}`)).status, 404);
    assert.deepEqual(repos.activity.map((a) => a.eventType), ['route.requested', 'calculation.created', 'calculation.deleted']);
  });

  it('validates ids and pagination', async () => {
    const { app } = buildTestApp();
    assert.equal((await request(app).get('/api/calculations/not-a-uuid')).status, 400);
    assert.equal((await request(app).get('/api/calculations?limit=1000')).status, 400);
  });

  it('returns 503 when saving fails at the database', async () => {
    const ok = buildTestApp();
    const route = await getRoute(ok.app);
    const { app } = buildTestApp({ failDatabase: true });
    const res = await request(app).post('/api/calculations').send(calculationBody(route.routeToken));
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'DATABASE_ERROR');
  });
});

describe('logistics endpoints', () => {
  it('GET /api/logistics/catalog localises names (lt default, en on request)', async () => {
    const { app } = buildTestApp();
    const lt = await request(app).get('/api/logistics/catalog');
    assert.equal(lt.body.data.cargoTypes.find((c) => c.id === 'wheat').displayName, 'Kviečiai');
    const en = await request(app).get('/api/logistics/catalog?locale=en');
    assert.equal(en.body.data.cargoTypes.find((c) => c.id === 'wheat').displayName, 'Wheat');
  });

  it('POST /api/logistics/fuel matches the reference example', async () => {
    const { app } = buildTestApp();
    const res = await request(app).post('/api/logistics/fuel').send({ distanceKm: 250, consumptionLPer100Km: 30, fuelPriceEurPerLiter: 1.5 });
    assert.equal(res.body.data.fuelLiters, 75);
    assert.equal(res.body.data.fuelCostEurRounded, 112.5);
    const bad = await request(app).post('/api/logistics/fuel').send({ distanceKm: -1, consumptionLPer100Km: 30 });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.error.details.map((d) => d.field).sort(), ['distanceKm', 'fuelPriceEurPerLiter']);
  });

  it('POST /api/logistics/savings handles group and multi-customer requests', async () => {
    const { app } = buildTestApp();
    const g = await request(app).post('/api/logistics/savings').send({ separateTransportTotalEur: 360, combinedTransportTotalEur: 275, commissionRate: 0.2 });
    assert.equal(g.body.data.platformFeeEur, 17);
    const m = await request(app)
      .post('/api/logistics/savings?locale=en')
      .send({ combinedTransportTotalEur: 275, participants: [{ participantId: 'a', independentAlternativeEur: 200 }, { participantId: 'b', independentAlternativeEur: 160 }] });
    assert.equal(m.body.data.status, 'mutually_beneficial');
    const bad = await request(app).post('/api/logistics/savings').send({ separateTransportTotalEur: 1, combinedTransportTotalEur: 1, commissionRate: 20 });
    assert.equal(bad.status, 400);
  });

  it('POST /api/logistics/compatibility returns status, reasons and trailer suggestions', async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post('/api/logistics/compatibility')
      .send({
        trailer: { trailerId: 'schmitz_ski_light_agri', overrides: { internalVolumeM3: 59, maxPayloadKg: 24000 } },
        shipments: [
          { shipmentId: 's1', cargoTypeId: 'wheat', packaging: 'bulk', weightKg: 10000 },
          { shipmentId: 's2', cargoTypeId: 'barley', packaging: 'bulk', weightKg: 8000 },
        ],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'incompatible');
    assert.ok(res.body.data.reasons.some((r) => r.code === 'bulk_mixing'));
    assert.deepEqual(res.body.data.suggestedTrailerCategories, ['agricultural_tipper']);
    const bad = await request(app).post('/api/logistics/compatibility').send({ shipments: [], trailer: { trailerId: 'nope' } });
    assert.equal(bad.status, 400);
  });
});
