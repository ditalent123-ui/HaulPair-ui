import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadBookingCatalog } from '../../src/services/booking/catalog.js';
import { capacityFor, routingVehicleFor, selectTrucks } from '../../src/services/booking/truckSelection.js';
import { priceHaul } from '../../src/services/booking/pricing.js';
import { resolveWindow } from '../../src/services/booking/timeWindows.js';
import { createDemoTruckProvider, haversineKm } from '../../src/services/routing/providers/demoTruck.js';
import { openToken, sealToken } from '../../src/utils/sealedToken.js';

const catalog = loadBookingCatalog();
const wheat = catalog.getCargo('wheat');

describe('booking seed data', () => {
  it('loads a truck fleet ordered small → large with complete limits', () => {
    assert.ok(catalog.fleet.length >= 4);
    for (const p of catalog.fleet) {
      for (const k of ['payloadT', 'cargoVolumeM3', 'grossWeightT', 'heightM', 'widthM', 'lengthM', 'axleLoadT']) assert.ok(p[k] > 0, `${p.id}.${k}`);
    }
  });

  it('contains no driver-cost keys in fleet or pricing config', () => {
    const text = JSON.stringify({ fleet: catalog.fleet, pricing: catalog.pricing });
    assert.doesNotMatch(text, /"[^"]*(driver|wage|perdiem|per_diem|accommodation)[^"]*"\s*:/i);
  });

  it('every drop-off point has name, address, coordinates, type, and unverified ones are marked demo', () => {
    for (const d of catalog.dropoffs) {
      assert.ok(d.name && d.address && Number.isFinite(d.lat) && Number.isFinite(d.lon) && d.type);
      if (d.verification.coordinates !== 'verified') assert.equal(d.demo, true, d.id);
    }
  });
});

describe('truck selection', () => {
  it('10 t of wheat maps to the 24 t-class grain truck, not the 40 t combination', () => {
    const plan = selectTrucks({ fleet: catalog.fleet, cargo: wheat, amountT: 10 });
    assert.equal(plan.truckCount, 1);
    assert.equal(plan.trucks[0].profileId, 'grain_24t');
  });

  it('uses the smallest truck for small loads', () => {
    assert.equal(selectTrucks({ fleet: catalog.fleet, cargo: wheat, amountT: 3 }).trucks[0].profileId, 'small_tipper');
    assert.equal(selectTrucks({ fleet: catalog.fleet, cargo: wheat, amountT: 6 }).trucks[0].profileId, 'rigid_14t');
  });

  it('accounts for volume: light oats are volume-limited', () => {
    const oats = catalog.getCargo('oats');
    const cap = capacityFor(catalog.getProfile('grain_24t'), oats);
    assert.equal(cap.limitedBy, 'volume');
    assert.ok(cap.capacityT < catalog.getProfile('grain_24t').payloadT);
    // 12 t fits a 24 t-class truck by weight but not by volume (22 m³ × 0.42 t/m³ ≈ 9.2 t).
    assert.equal(selectTrucks({ fleet: catalog.fleet, cargo: oats, amountT: 12 }).trucks[0].profileId, 'combination_40t');
  });

  it('splits a load larger than one truck into the fewest trucks', () => {
    const plan = selectTrucks({ fleet: catalog.fleet, cargo: wheat, amountT: 60 });
    assert.equal(plan.truckCount, 3); // 26 t per combination → ceil(60 / 26) = 3
    assert.ok(plan.trucks.every((t) => t.loadT === 20));
    const plan2 = selectTrucks({ fleet: catalog.fleet, cargo: wheat, amountT: 30 });
    assert.equal(plan2.truckCount, 2);
    assert.equal(plan2.trucks[0].profileId, 'grain_24t'); // 15 t each fits the smaller class
  });

  it('uses the most restrictive vehicle of the plan for routing', () => {
    const v = routingVehicleFor(selectTrucks({ fleet: catalog.fleet, cargo: wheat, amountT: 10 }), catalog.getProfile);
    assert.deepEqual(v, { grossWeightT: 26, heightM: 3.6, widthM: 2.55, lengthM: 10, axleLoadT: 10 });
  });
});

describe('deterministic pricing', () => {
  const plan = selectTrucks({ fleet: catalog.fleet, cargo: wheat, amountT: 10 });
  const route = { distanceKm: 230, durationS: (230 / 62) * 3600 };

  it('is deterministic and rounds up to whole euros', () => {
    const a = priceHaul({ plan, route, dieselEurPerL: 2, pricing: catalog.pricing, getProfile: catalog.getProfile });
    const b = priceHaul({ plan, route, dieselEurPerL: 2, pricing: catalog.pricing, getProfile: catalog.getProfile });
    assert.equal(a.totalEur, b.totalEur);
    assert.ok(Number.isInteger(a.totalEur));
    assert.ok(a.totalEur >= a.breakdown.trucks[0].totalEur);
  });

  it('matches the documented formula', () => {
    const p = catalog.getProfile('grain_24t');
    const pr = catalog.pricing;
    const f = plan.trucks[0].loadFraction;
    const emptyKm = 230 * pr.emptyReturnFactor;
    const fuelL = (230 * (p.fuelLPer100Km.empty + (p.fuelLPer100Km.full - p.fuelLPer100Km.empty) * f)) / 100 + (emptyKm * p.fuelLPer100Km.empty) / 100;
    const hours = route.durationS / 3600;
    const cost = fuelL * 2 + (230 + emptyKm) * p.vehicleCostEurPerKm + (hours * (1 + pr.emptyReturnFactor) + pr.handlingHoursPerTruck) * p.vehicleTimeCostEurPerHour + (230 + emptyKm) * p.tollEurPerKm;
    const expected = Math.ceil(Math.max(pr.minimumChargeEurPerTruck, cost * (1 + pr.marginPct / 100)) - 1e-9);
    assert.equal(priceHaul({ plan, route, dieselEurPerL: 2, pricing: pr, getProfile: catalog.getProfile }).totalEur, expected);
  });

  it('rises with the diesel price and has no driver component', () => {
    const lo = priceHaul({ plan, route, dieselEurPerL: 1.5, pricing: catalog.pricing, getProfile: catalog.getProfile });
    const hi = priceHaul({ plan, route, dieselEurPerL: 2.5, pricing: catalog.pricing, getProfile: catalog.getProfile });
    assert.ok(hi.totalEur > lo.totalEur);
    assert.deepEqual(Object.keys(lo.breakdown.trucks[0]).sort(), ['distanceEur', 'fuelEur', 'fuelL', 'marginEur', 'profileId', 'timeEur', 'tollsEur', 'totalEur']);
  });

  it('never goes below the minimum charge per truck', () => {
    const r = priceHaul({ plan, route: { distanceKm: 2, durationS: 120 }, dieselEurPerL: 2, pricing: catalog.pricing, getProfile: catalog.getProfile });
    assert.equal(r.totalEur, catalog.pricing.minimumChargeEurPerTruck);
  });
});

describe('demo truck route', () => {
  it('is flagged demo and estimates road distance from the straight line', async () => {
    const p = createDemoTruckProvider({ roadFactor: 1.25, averageSpeedKmh: 62 });
    const a = { lat: 54.8985, lon: 23.9036 };
    const b = { lat: 55.718, lon: 21.109 };
    const r = await p.route({ origin: a, destination: b });
    assert.equal(p.demo, true);
    assert.ok(Math.abs(r.distanceM / 1000 - haversineKm(a, b) * 1.25) < 0.01);
    assert.deepEqual(r.coordinates[0], [a.lon, a.lat]);
    assert.deepEqual(r.coordinates.at(-1), [b.lon, b.lat]);
  });
});

describe('pickup time windows', () => {
  const now = Date.parse('2026-10-29T08:30:00Z'); // 10:30 in Vilnius (EET)
  it('rejects past dates and passed windows, accepts next month', () => {
    assert.equal(resolveWindow({ date: '2026-10-28', windowId: '10-12', now }).error, 'PAST_DATE');
    assert.equal(resolveWindow({ date: '2026-10-29', windowId: '08-10', now }).error, 'WINDOW_PASSED');
    const r = resolveWindow({ date: '2026-11-29', windowId: '10-12', now });
    assert.equal(r.error, undefined);
    assert.equal(new Date(r.startAt).toISOString(), '2026-11-29T08:00:00.000Z'); // 10:00 EET
  });
  it('allows ASAP only today and respects summer time', () => {
    assert.equal(resolveWindow({ date: '2026-10-30', windowId: 'asap', now }).error, 'ASAP_ONLY_TODAY');
    assert.equal(resolveWindow({ date: '2026-10-29', windowId: 'asap', now }).asap, true);
    assert.equal(resolveWindow({ date: '2027-06-10', windowId: '08-10', now }).error, 'TOO_FAR_AHEAD');
    const summer = resolveWindow({ date: '2027-06-10', windowId: '08-10', now: Date.parse('2027-06-01T09:00:00Z') });
    assert.equal(new Date(summer.startAt).toISOString(), '2027-06-10T05:00:00.000Z'); // 08:00 EEST
  });
});

describe('sealed quote tokens', () => {
  it('are opaque, tamper-proof and expire', () => {
    const { token } = sealToken({ totalEur: 401, diesel: { eurPerL: 2.17 } }, 'secret-'.repeat(6), { ttlS: 60, now: 0 });
    assert.doesNotMatch(Buffer.from(token.split('.')[1], 'base64url').toString('latin1'), /2\.17|totalEur/);
    assert.equal(openToken(token, 'secret-'.repeat(6), { now: 1000 }).totalEur, 401);
    assert.throws(() => openToken(`${token.slice(0, -2)}AA`, 'secret-'.repeat(6), { now: 1000 }));
    assert.throws(() => openToken(token, 'secret-'.repeat(6), { now: 120_000 }), /expired/);
  });
});
