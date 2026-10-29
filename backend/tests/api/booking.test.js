import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildTestApp, createFakeProvider, KAUNAS } from '../helpers/testApp.js';

// The end-user configuration: legacy advanced tools hidden.
const userEnv = { ADVANCED_TOOLS_ENABLED: 'false' };
const FORBIDDEN_KEYS = /fuel|diesel|breakdown|profile|payload|axle|vehicle|driver|margin|litre|toll/i;
const quoteBody = (over = {}) => ({ pickup: KAUNAS, destination: { dropoffId: 'klasco_klaipeda' }, cargoType: 'wheat', amountT: 10, ...over });

function vilniusDate(offsetMonths = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius' }).format(d);
}

describe('booking API (end-user)', () => {
  it('lists cargo types and drop-off points grouped by type/region', async () => {
    const { app } = buildTestApp({ env: userEnv });
    const res = await request(app).get('/api/booking/options');
    assert.equal(res.status, 200);
    const ids = res.body.data.cargoTypes.map((c) => c.id);
    for (const id of ['wheat', 'rapeseed', 'barley', 'potatoes', 'fertiliser']) assert.ok(ids.includes(id), id);
    assert.ok(res.body.data.dropoffs.every((d) => d.name && d.address && d.type && d.region && typeof d.demo === 'boolean'));
    assert.equal(res.body.data.routingDemo, true, 'no ORS key → labelled demo routing');
  });

  it('quote response is minimal: total + map data, nothing technical', async () => {
    const { app } = buildTestApp({ env: userEnv });
    const res = await request(app).post('/api/quote').send(quoteBody());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const d = res.body.data;
    assert.deepEqual(Object.keys(d).sort(), ['currency', 'destination', 'expiresAt', 'pickup', 'quoteToken', 'route', 'totalEur']);
    assert.deepEqual(Object.keys(d.route).sort(), ['attribution', 'demo', 'distanceKm', 'durationMin', 'geometry']);
    assert.ok(Number.isInteger(d.totalEur) && d.totalEur > 0);
    assert.equal(d.route.demo, true);
    const visible = JSON.stringify({ ...d, quoteToken: undefined, route: { ...d.route, geometry: undefined } });
    assert.doesNotMatch(visible, FORBIDDEN_KEYS);
    // The token is opaque: no truck plan, diesel price or cost inputs readable by the browser.
    assert.doesNotMatch(Buffer.from(d.quoteToken.split('.')[1], 'base64url').toString('latin1'), /grain_24t|eurPerL|diesel/);
  });

  it('routes with truck restrictions of the auto-selected ~24 t truck when a truck router is configured', async () => {
    const hgv = createFakeProvider({ supportsTruckRestrictions: true });
    const { app } = buildTestApp({ env: userEnv, truckRoutingProvider: hgv });
    const res = await request(app).post('/api/quote').send(quoteBody());
    assert.equal(res.status, 200);
    assert.equal(res.body.data.route.demo, false);
    assert.equal(hgv.calls.length, 1);
    assert.deepEqual(hgv.calls[0].vehicle, { grossWeightT: 26, heightM: 3.6, widthM: 2.55, lengthM: 10, axleLoadT: 10 });
  });

  it('falls back to the labelled demo route when the truck router fails', async () => {
    const { UpstreamError } = await import('../../src/utils/errors.js');
    const hgv = createFakeProvider({ supportsTruckRestrictions: true, fail: new UpstreamError('down', { code: 'UPSTREAM_UNREACHABLE' }) });
    const { app } = buildTestApp({ env: userEnv, truckRoutingProvider: hgv });
    const res = await request(app).post('/api/quote').send(quoteBody());
    assert.equal(res.status, 200);
    assert.equal(res.body.data.route.demo, true);
  });

  it('validates inputs in plain terms', async () => {
    const { app } = buildTestApp({ env: userEnv });
    assert.equal((await request(app).post('/api/quote').send(quoteBody({ amountT: 0 }))).status, 400);
    assert.equal((await request(app).post('/api/quote').send(quoteBody({ cargoType: 'gold' }))).status, 400);
    assert.equal((await request(app).post('/api/quote').send(quoteBody({ pickup: { lat: 52.23, lon: 21.01, label: 'Warszawa' } }))).status, 400);
    assert.equal((await request(app).post('/api/quote').send(quoteBody({ destination: { dropoffId: 'nope' } }))).status, 404);
  });

  it('books next month with a time window; rejects past dates and bad tokens', async () => {
    const { app } = buildTestApp({ env: userEnv });
    const q = (await request(app).post('/api/quote').send(quoteBody())).body.data;
    const next = vilniusDate(1);
    const ok = await request(app).post('/api/orders').send({ quoteToken: q.quoteToken, pickupDate: next, timeWindow: '10-12', asCompany: true });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const o = ok.body.data;
    assert.equal(o.pickupDate, next);
    assert.equal(o.timeWindow.label, '10:00–12:00');
    assert.equal(o.totalEur, q.totalEur);
    assert.equal(o.truck.classLabel, '24 t klasė');
    assert.ok(o.legs.approach.geometry.length > 1 && o.legs.delivery.geometry.length > 1);
    assert.ok(Date.parse(o.dispatchAt) > Date.now() + 86_400_000, 'future order is scheduled, not dispatched now');
    assert.equal(o.invoiceToCompany, true);
    assert.doesNotMatch(JSON.stringify(o), /company code|vat|example\.com/i);

    const past = await request(app).post('/api/orders').send({ quoteToken: q.quoteToken, pickupDate: '2020-01-01', timeWindow: '10-12' });
    assert.equal(past.body.error.code, 'PAST_DATE');
    const bad = await request(app).post('/api/orders').send({ quoteToken: `${q.quoteToken.slice(0, -4)}AAAA`, pickupDate: next, timeWindow: '10-12' });
    assert.equal(bad.body.error.code, 'QUOTE_INVALID');
  });

  it('price tracker: every price has a source and timestamp; seeded data is DEMO', async () => {
    const { app } = buildTestApp({ env: userEnv });
    const res = await request(app).get('/api/prices');
    assert.equal(res.status, 200);
    const { diesel, grain } = res.body.data;
    assert.ok(diesel.eurPerL > 0 && diesel.sourceName && diesel.updatedAt);
    assert.equal(diesel.demo, true);
    assert.ok(diesel.history.length > 1);
    for (const p of grain) for (const x of p.prices) assert.ok(x.sourceName && x.updatedAt && x.demo === true);
  });

  it('planner ranks drop-off points by net result, with net per tonne', async () => {
    const { app } = buildTestApp({ env: userEnv });
    const res = await request(app).post('/api/planner/compare').send({ pickup: KAUNAS, cargoType: 'wheat', amountT: 24 });
    assert.equal(res.status, 200);
    const { options, best, runnerUp } = res.body.data;
    assert.ok(options.length >= 2);
    for (let i = 1; i < options.length; i += 1) assert.ok(options[i - 1].netEur >= options[i].netEur);
    assert.equal(best.rank, 1);
    assert.equal(runnerUp.rank, 2);
    for (const o of options) {
      assert.equal(o.netEur, Math.round((o.revenueEur - o.transportCostEur) * 100) / 100);
      assert.ok(Math.abs(o.netPerTonneEur - o.netEur / 24) < 0.01);
    }
  });

  it('hides the legacy advanced planner from end users', async () => {
    const { app } = buildTestApp({ env: userEnv });
    for (const path of ['/api/trucks', '/api/fuel-price?fuelType=diesel', '/api/logistics/catalog']) {
      assert.equal((await request(app).get(path)).status, 404, path);
    }
    assert.equal((await request(app).post('/api/ai/parse-shipment').send({ text: 'x' })).status, 404);
    assert.equal((await request(app).get('/advanced.html')).status, 404);
  });

  it('exchange returns read-only DEMO offers and trucks', async () => {
    const { app } = buildTestApp({ env: userEnv });
    const res = await request(app).get('/api/exchange');
    assert.equal(res.body.data.demo, true);
    assert.ok(res.body.data.cargoOffers.length > 0 && res.body.data.trucks.length > 0);
  });

  it('place search falls back to the labelled offline list when the geocoder fails', async () => {
    const geocodingService = { describe: () => ({}), async search() { throw new Error('unreachable'); } };
    const { app } = buildTestApp({ env: userEnv, geocodingService });
    const res = await request(app).get('/api/places?q=kaun');
    assert.equal(res.body.data.source, 'offline_demo');
    assert.equal(res.body.data.results[0].label, 'Kaunas');
    assert.equal(res.body.data.results[0].demo, true);
  });
});

describe('AI-managed diesel price', () => {
  const aiEnv = { ...userEnv, AI_ENABLED: 'true', GEMINI_API_KEY: 'test-key' };
  const today = new Date().toISOString().slice(0, 10);
  const fake = (text, calls = []) => {
    const fn = async (args) => { calls.push(args); return { text, sources: [{ title: 'LEA', uri: 'https://www.ena.lt/' }] }; };
    fn.calls = calls;
    return fn;
  };

  it('stores a validated, grounded AI price with timestamp and uses it', async () => {
    const model = fake(`PRICE=2.155;DATE=${today};SOURCE=Lietuvos energetikos agentūra;KIND=source`);
    const { app, repos } = buildTestApp({ env: aiEnv, aiCallModel: model });
    const res = await request(app).get('/api/prices');
    assert.equal(res.body.data.diesel.eurPerL, 2.155);
    assert.equal(res.body.data.diesel.demo, false);
    assert.equal(res.body.data.diesel.method, 'ai_assisted');
    assert.equal(model.calls[0].googleSearch, true);
    assert.equal(model.calls[0].responseFormat, 'text');
    const stored = await repos.fuelPriceRepository.get('diesel');
    assert.equal(stored.priceEurPerL, 2.155);
    assert.ok(stored.updatedAt);
  });

  it('rejects an out-of-range AI value and keeps the last known good value', async () => {
    const model = fake(`PRICE=9.99;DATE=${today};SOURCE=x;KIND=source`);
    const { app, repos } = buildTestApp({ env: aiEnv, aiCallModel: model });
    await repos.fuelPriceRepository.upsert({ fuelType: 'diesel', priceEurPerL: 2.05, priceDate: '2026-01-02', priceBasis: 'test', sourceName: 'LEA import', sourceUrl: 'https://www.ena.lt/', method: 'manual_import' });
    // Make the stored value old enough to trigger a refresh.
    (await repos.fuelPriceRepository.get('diesel')).updatedAt = '2026-01-02T00:00:00.000Z';
    const res = await request(app).get('/api/prices');
    assert.equal(model.calls.length, 1);
    assert.equal(res.body.data.diesel.eurPerL, 2.05);
    assert.equal(res.body.data.diesel.sourceName, 'LEA import');
  });

  it('falls back to the labelled DEMO seed when AI fails and nothing is stored', async () => {
    const model = async () => { throw Object.assign(new Error('quota'), { code: 'AI_QUOTA' }); };
    const { app } = buildTestApp({ env: aiEnv, aiCallModel: model });
    const res = await request(app).get('/api/prices');
    assert.equal(res.body.data.diesel.demo, true);
  });

  it('makes no AI call when AI is disabled (default)', async () => {
    const model = fake('PRICE=2.1');
    const { app } = buildTestApp({ env: userEnv, aiCallModel: model });
    await request(app).get('/api/prices');
    await request(app).post('/api/quote').send(quoteBody());
    assert.equal(model.calls.length, 0);
  });
});
