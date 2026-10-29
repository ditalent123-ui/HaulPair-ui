import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Pure browser modules (no DOM) shared with the end-user app.
import { isCompanyCode, isVatCode, parseAmountT, validateCompany } from '../../../frontend/js/user/validators.js';
import { computeState, preparePolyline } from '../../../frontend/js/user/tracking.js';
import { parseDieselAnswer, validateDieselAnswer } from '../../src/services/ai/dieselPriceAi.js';

describe('legal entity validation', () => {
  it('company code is exactly 9 digits', () => {
    assert.equal(isCompanyCode('123456789'), true);
    assert.equal(isCompanyCode('12345678'), false);
    assert.equal(isCompanyCode('12345678A'), false);
  });
  it('VAT is optional, LT + 9 or 12 digits', () => {
    assert.equal(isVatCode(''), true);
    assert.equal(isVatCode('LT123456789'), true);
    assert.equal(isVatCode('lt123456789012'), true);
    assert.equal(isVatCode('LT1234567890'), false);
    assert.equal(isVatCode('LV123456789'), false);
  });
  it('reports every invalid field', () => {
    const e = validateCompany({ name: '', code: '1', vat: 'X', address: '', contact: '', phone: '12', email: 'a@' });
    assert.deepEqual(Object.keys(e).sort(), ['address', 'code', 'contact', 'email', 'name', 'phone', 'vat']);
  });
  it('parses decimal commas in amounts', () => {
    assert.equal(parseAmountT('10,5'), 10.5);
    assert.equal(parseAmountT('abc'), null);
  });
});

describe('simulated truck position', () => {
  const t0 = Date.parse('2026-10-29T08:00:00Z');
  const order = {
    createdAt: new Date(t0).toISOString(),
    dispatchAt: new Date(t0 + 10_000).toISOString(),
    from: { lat: 55, lon: 24 },
    to: { lat: 55, lon: 25 },
    legs: {
      approach: { geometry: [[55.1, 24], [55, 24]], durationS: 600, distanceKm: 11 },
      delivery: { geometry: [[55, 24], [55, 24.5], [55, 25]], durationS: 3600, distanceKm: 64 },
    },
  };
  const polys = { approach: preparePolyline(order.legs.approach.geometry), delivery: preparePolyline(order.legs.delivery.geometry) };

  it('moves along the route and drives the timeline from the position', () => {
    assert.equal(computeState(order, t0 + 1000, polys).phase, 'ordered');
    assert.equal(computeState(order, t0 + 6000, polys).phase, 'assigned');
    const mid = computeState(order, t0 + 10_000 + 300_000, polys);
    assert.equal(mid.phase, 'en_route');
    assert.ok(Math.abs(mid.lat - 55.05) < 0.001);
    assert.ok(Math.abs(mid.etaS - 300) < 1);
    assert.equal(computeState(order, t0 + 10_000 + 601_000, polys).phase, 'arrived');
    const loaded = { ...order, loadedAt: new Date(t0 + 700_000).toISOString() };
    assert.equal(computeState(loaded, t0 + 700_000 + 1800_000, polys).phase, 'loaded');
    assert.equal(computeState(loaded, t0 + 700_000 + 3601_000, polys).phase, 'delivered');
  });

  it('a future-dated order is scheduled with a countdown', () => {
    const future = { ...order, dispatchAt: new Date(t0 + 30 * 86_400_000).toISOString() };
    const s = computeState(future, t0 + 5000, polys);
    assert.equal(s.phase, 'scheduled');
    assert.ok(s.etaS > 29 * 86_400);
  });

  it('demo speed multiplier compresses time without jumping', () => {
    const fast = { ...order, sim: { anchorReal: t0 + 10_000, anchorSim: t0 + 10_000, multiplier: 60 } };
    assert.equal(computeState(fast, t0 + 10_000 + 5_000, polys).phase, 'en_route');
    assert.equal(computeState(fast, t0 + 10_000 + 11_000, polys).phase, 'arrived');
  });
});

describe('AI diesel answer parsing', () => {
  it('parses the strict one-line format and validates the sanity range and date', () => {
    const now = Date.parse('2026-10-29T10:00:00Z');
    const p = parseDieselAnswer('PRICE=2,149;DATE=2026-10-28;SOURCE=LEA;KIND=source');
    assert.deepEqual(validateDieselAnswer(p, { now }), { eurPerL: 2.149, priceDate: '2026-10-28', sourceName: 'LEA', kind: 'source' });
    assert.equal(parseDieselAnswer('PRICE=NONE'), null);
    assert.throws(() => validateDieselAnswer(parseDieselAnswer('PRICE=0.40;DATE=2026-10-28'), { now }), /sanity/);
    assert.throws(() => validateDieselAnswer(parseDieselAnswer('PRICE=2.1;DATE=2026-01-01'), { now }), /not current/);
  });
});
