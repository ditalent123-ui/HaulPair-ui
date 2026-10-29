import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signRouteToken, verifyRouteToken, RouteTokenError } from '../../src/utils/routeToken.js';
import { parseOsrmResponse } from '../../src/services/routing/providers/osrm.js';
import { buildOrsOptions, parseOrsResponse } from '../../src/services/routing/providers/openrouteservice.js';
import { createRoutingService } from '../../src/services/routing/routingService.js';
import { parsePhotonResponse } from '../../src/services/geocoding/providers/photon.js';
import { tileOrigins } from '../../src/middleware/security.js';
import { TtlCache } from '../../src/utils/ttlCache.js';
import { createFakeProvider, KLAIPEDA, VILNIUS } from '../helpers/testApp.js';

// Payloads below are minimal synthetic fixtures shaped like the documented provider
// responses; they test our parsing logic, not real routes.

const SECRET = 'unit-test-secret-unit-test-secret-1234';

describe('route tokens', () => {
  it('round-trips a signed payload', () => {
    const { token } = signRouteToken({ outbound: { distanceKm: 300 } }, SECRET);
    assert.equal(verifyRouteToken(token, SECRET).outbound.distanceKm, 300);
  });

  it('rejects a tampered payload', () => {
    const { token } = signRouteToken({ outbound: { distanceKm: 300 } }, SECRET);
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ outbound: { distanceKm: 1 }, v: 1, exp: 9e9 })).toString('base64url');
    assert.throws(() => verifyRouteToken(`${forged}.${sig}`, SECRET), RouteTokenError);
  });

  it('rejects a token signed with another secret, and expired tokens', () => {
    const { token } = signRouteToken({ a: 1 }, SECRET);
    assert.throws(() => verifyRouteToken(token, `${SECRET}x`), /signature/);
    const old = signRouteToken({ a: 1 }, SECRET, { ttlS: 60, now: Date.now() - 120_000 });
    assert.throws(() => verifyRouteToken(old.token, SECRET), /expired/);
  });

  it('rejects malformed input', () => {
    for (const bad of [undefined, '', 'abc', 'a.b.c', 'x'.repeat(9000)]) assert.throws(() => verifyRouteToken(bad, SECRET), RouteTokenError);
  });
});

describe('OSRM response parsing', () => {
  it('normalises a successful response', () => {
    const r = parseOsrmResponse(200, { code: 'Ok', routes: [{ distance: 1000, duration: 60, geometry: { coordinates: [[1, 2], [3, 4]] } }] });
    assert.deepEqual(r, { distanceM: 1000, durationS: 60, coordinates: [[1, 2], [3, 4]] });
  });
  it('maps NoRoute to a 422 NO_ROUTE error', () => {
    assert.throws(() => parseOsrmResponse(400, { code: 'NoRoute' }), (e) => e.code === 'NO_ROUTE' && e.status === 422);
  });
  it('maps rate limiting and malformed bodies to upstream errors', () => {
    assert.throws(() => parseOsrmResponse(429, null), (e) => e.code === 'UPSTREAM_RATE_LIMITED');
    assert.throws(() => parseOsrmResponse(200, { code: 'Ok', routes: [] }), (e) => e.code === 'UPSTREAM_ERROR');
  });
});

describe('openrouteservice adapter', () => {
  it('maps vehicle dimensions to HGV restrictions', () => {
    assert.deepEqual(buildOrsOptions({ heightM: 4, widthM: 2.55, lengthM: 16.5, grossWeightT: 40, axleLoadT: 11.5 }), {
      vehicle_type: 'hgv',
      profile_params: { restrictions: { height: 4, width: 2.55, length: 16.5, weight: 40, axleload: 11.5 } },
    });
    assert.deepEqual(buildOrsOptions({}), { vehicle_type: 'hgv' });
  });
  it('parses GeoJSON and maps errors', () => {
    const ok = parseOrsResponse(200, { features: [{ properties: { summary: { distance: 5000, duration: 300 } }, geometry: { coordinates: [[1, 2], [3, 4]] } }] });
    assert.equal(ok.distanceM, 5000);
    assert.throws(() => parseOrsResponse(404, { error: { code: 2010 } }), (e) => e.code === 'NO_ROUTE');
    assert.throws(() => parseOrsResponse(403, {}), (e) => e.code === 'UPSTREAM_AUTH');
  });
});

describe('Photon parsing', () => {
  it('builds labels and keeps coordinates', () => {
    const [r] = parsePhotonResponse(200, {
      features: [{ geometry: { coordinates: [21.14, 55.7] }, properties: { name: 'Klaipėda', county: 'Klaipėdos apskritis', country: 'Lietuva', countrycode: 'lt' } }],
    });
    assert.equal(r.label, 'Klaipėda, Klaipėdos apskritis, Lietuva');
    assert.equal(r.countryCode, 'LT');
    assert.equal(r.lat, 55.7);
  });
});

describe('routing service', () => {
  it('labels car routing as not truck-compliant and ignores vehicle dimensions', async () => {
    const provider = createFakeProvider({ supportsTruckRestrictions: false });
    const svc = createRoutingService({ provider, tokenSecret: SECRET, tokenTtlS: 600 });
    const r = await svc.getRoute({ origin: VILNIUS, destination: KLAIPEDA, vehicle: { heightM: 4 } });
    assert.equal(r.truckRestrictionsApplied, false);
    assert.match(r.warnings[0], /NOT checked against truck/);
    assert.match(r.warnings[1], /ignored/);
    assert.deepEqual(provider.calls[0].vehicle, {});
    assert.equal(r.outbound.distanceKm, 300);
    assert.deepEqual(r.outbound.geometry[0], [VILNIUS.lat, VILNIUS.lon]);
  });

  it('passes restrictions to a truck-capable provider and fetches the reverse leg', async () => {
    const provider = createFakeProvider({ supportsTruckRestrictions: true });
    const svc = createRoutingService({ provider, tokenSecret: SECRET, tokenTtlS: 600 });
    const r = await svc.getRoute({ origin: VILNIUS, destination: KLAIPEDA, includeReturn: true, vehicle: { heightM: 4, grossWeightT: 40 } });
    assert.equal(provider.calls.length, 2);
    assert.deepEqual(provider.calls[0].vehicle, { heightM: 4, grossWeightT: 40 });
    assert.equal(r.return.distanceKm, 310);
    const payload = verifyRouteToken(r.routeToken, SECRET);
    assert.equal(payload.return.distanceKm, 310);
    assert.equal(payload.truckRestrictionsApplied, true);
  });

  it('caches identical requests', async () => {
    const provider = createFakeProvider();
    const svc = createRoutingService({ provider, tokenSecret: SECRET, tokenTtlS: 600 });
    await svc.getRoute({ origin: VILNIUS, destination: KLAIPEDA });
    const second = await svc.getRoute({ origin: VILNIUS, destination: KLAIPEDA });
    assert.equal(provider.calls.length, 1);
    assert.equal(second.cached, true);
  });
});

describe('utilities', () => {
  it('derives CSP tile origins from templates', () => {
    assert.deepEqual(tileOrigins('https://tile.openstreetmap.org/{z}/{x}/{y}.png'), ['https://tile.openstreetmap.org']);
    assert.equal(tileOrigins('https://{s}.tile.example.com/{z}/{x}/{y}.png').length, 3);
  });
  it('TtlCache expires and evicts', () => {
    let now = 0;
    const c = new TtlCache({ ttlMs: 10, maxEntries: 2, now: () => now });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    assert.equal(c.get('a'), undefined);
    now = 11;
    assert.equal(c.get('b'), undefined);
  });
});
