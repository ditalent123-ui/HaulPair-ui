import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkCompatibility, LogisticsValidationError, suggestTrailerCategories } from '../../../src/lib/logistics/index.js';

const CURTAIN = { trailerId: 'schmitz_scs_universal_13_62', overrides: { maxPayloadKg: 24000 } };
const TIPPER = { trailerId: 'schmitz_ski_light_agri', overrides: { maxPayloadKg: 24000, internalVolumeM3: 59 } };
const REEFER = { trailerId: 'schmitz_sko_cool_smart_13_4', overrides: { maxPayloadKg: 22000 } };

const feed = (id, extra = {}) => ({ shipmentId: id, ownerId: id, cargoTypeId: 'packaged_animal_feed', packaging: 'palletized', weightKg: 8000, palletPositions: 12, ...extra });
const codes = (r, severity) => r.reasons.filter((x) => !severity || x.severity === severity).map((x) => x.code);

describe('cargo compatibility', () => {
  it('two compatible palletised shipments', () => {
    const r = checkCompatibility({ shipments: [feed('a'), feed('b', { weightKg: 9000, palletPositions: 14 })], trailer: CURTAIN });
    assert.equal(r.status, 'compatible', JSON.stringify(codes(r)));
    assert.equal(r.totals.weightKg, 17000);
    assert.equal(r.totals.palletPositions, 26);
    assert.equal(r.limits.euroPallets, 34);
    assert.ok(r.disclaimer.length > 0);
    assert.match(r.summary, /galima vežti kartu/); // Lithuanian by default
  });

  it('incompatible: exceeded trailer weight capacity', () => {
    const r = checkCompatibility({ shipments: [feed('a', { weightKg: 15000 }), feed('b', { weightKg: 10000 })], trailer: CURTAIN });
    assert.equal(r.status, 'incompatible');
    assert.ok(codes(r, 'incompatible').includes('weight_exceeded'));
  });

  it('incompatible: exceeded pallet capacity', () => {
    const r = checkCompatibility({ shipments: [feed('a', { palletPositions: 20 }), feed('b', { palletPositions: 16 })], trailer: CURTAIN });
    assert.equal(r.status, 'incompatible');
    assert.deepEqual(codes(r, 'incompatible'), ['pallets_exceeded']);
  });

  it('incompatible: conflicting temperature requirements', () => {
    const r = checkCompatibility({
      shipments: [
        feed('a', { temperatureRequirementC: { minC: 2, maxC: 6 } }),
        feed('b', { temperatureRequirementC: { minC: 12, maxC: 16 } }),
      ],
      trailer: REEFER,
    });
    assert.equal(r.status, 'incompatible');
    assert.ok(codes(r, 'incompatible').includes('temperature_conflict'));
  });

  it('incompatible: temperature control required on a curtainsider', () => {
    const r = checkCompatibility({ shipments: [feed('a', { temperatureRequirementC: { minC: 2, maxC: 6 } })], trailer: CURTAIN });
    assert.ok(codes(r, 'incompatible').includes('temperature_control_unavailable'));
  });

  it('incompatible: different bulk grains cannot be mixed', () => {
    const r = checkCompatibility({
      shipments: [
        { shipmentId: 'w', cargoTypeId: 'wheat', packaging: 'bulk', weightKg: 12000 },
        { shipmentId: 'b', cargoTypeId: 'barley', packaging: 'bulk', weightKg: 10000 },
      ],
      trailer: TIPPER,
    });
    assert.equal(r.status, 'incompatible');
    assert.ok(codes(r, 'incompatible').includes('bulk_mixing'));
  });

  it('needs review: same bulk grain from two owners', () => {
    const r = checkCompatibility({
      shipments: [
        { shipmentId: 'w1', ownerId: 'farm_a', cargoTypeId: 'wheat', packaging: 'bulk', weightKg: 12000 },
        { shipmentId: 'w2', ownerId: 'farm_b', cargoTypeId: 'wheat', packaging: 'bulk', weightKg: 10000 },
      ],
      trailer: TIPPER,
    });
    assert.equal(r.status, 'needs_review');
    assert.ok(codes(r).includes('bulk_same_type_multiple_owners'));
    // 22 t at the conservative 0.72 t/m³ lower bound ≈ 30.6 m³ ≤ 59 m³
    assert.equal(r.totals.volumeM3, 30.6);
  });

  it('incompatible: volume exceeded for low-density bulk (oats)', () => {
    const r = checkCompatibility({
      shipments: [{ shipmentId: 'o', cargoTypeId: 'oats', packaging: 'bulk', weightKg: 24000 }],
      trailer: { trailerId: 'schmitz_ski_light_agri', overrides: { maxPayloadKg: 24000, internalVolumeM3: 38 } },
    });
    assert.ok(codes(r, 'incompatible').includes('volume_exceeded')); // 24 / 0.41 ≈ 58.5 m³ > 38 m³
  });

  it('incompatible: packaging and trailer requirements', () => {
    const bulkOnCurtain = checkCompatibility({ shipments: [{ shipmentId: 'w', cargoTypeId: 'wheat', packaging: 'bulk', weightKg: 1000 }], trailer: CURTAIN });
    assert.ok(codes(bulkOnCurtain, 'incompatible').includes('trailer_category_unsuitable'));
    assert.ok(codes(bulkOnCurtain, 'incompatible').includes('trailer_packaging_unsupported'));
    const hayInBags = checkCompatibility({ shipments: [{ shipmentId: 'h', cargoTypeId: 'hay', packaging: 'bagged', weightKg: 1000 }], trailer: CURTAIN });
    assert.ok(codes(hayInBags, 'incompatible').includes('packaging_not_permitted'));
    const mixedTipper = checkCompatibility({
      shipments: [
        { shipmentId: 'w', cargoTypeId: 'wheat', packaging: 'bulk', weightKg: 1000 },
        { shipmentId: 'p', cargoTypeId: 'potatoes', packaging: 'bagged', weightKg: 1000 },
      ],
      trailer: TIPPER,
    });
    assert.ok(codes(mixedTipper, 'incompatible').includes('bulk_with_other_packaging'));
  });

  it('needs review: missing information (weight, pallets, unknown payload limit)', () => {
    const r = checkCompatibility({
      shipments: [feed('a', { weightKg: undefined }), feed('b', { palletPositions: undefined })],
      trailer: { trailerId: 'schmitz_scs_universal_13_62' },
    });
    assert.equal(r.status, 'needs_review');
    assert.ok(codes(r).includes('weight_unknown'));
    assert.ok(codes(r).includes('pallets_unknown'));
    assert.ok(codes(r).includes('payload_limit_unknown'));
  });

  it('uses the 24 t demo payload profile only when asked, and labels it', () => {
    const r = checkCompatibility({ shipments: [feed('a')], trailer: { trailerId: 'schmitz_scs_universal_13_62' }, useDemoPayloadProfile: true });
    assert.equal(r.limits.maxPayloadKg, 24000);
    assert.equal(r.limits.payloadSource, 'demo_assumption');
    assert.ok(codes(r, 'info').includes('payload_demo_profile'));
  });

  it('needs review: hygiene/contamination not verified between different products', () => {
    const r = checkCompatibility({
      shipments: [feed('a'), { shipmentId: 'm', cargoTypeId: 'agricultural_machinery_components', packaging: 'palletized', weightKg: 2000, palletPositions: 4 }],
      trailer: CURTAIN,
    });
    assert.equal(r.status, 'needs_review');
    assert.ok(codes(r).includes('contamination_risk'));
    const veg = checkCompatibility({
      shipments: [
        { shipmentId: 'c', cargoTypeId: 'carrots', packaging: 'palletized', weightKg: 5000, palletPositions: 10 },
        { shipmentId: 'o', cargoTypeId: 'onions', packaging: 'palletized', weightKg: 5000, palletPositions: 10 },
      ],
      trailer: REEFER,
    });
    // Same hygiene group, but temperature needs are unknown → still review, never "compatible".
    assert.equal(veg.status, 'needs_review');
    assert.ok(codes(veg).includes('temperature_unknown'));
  });

  it('flags an unknown cargo type for review and validates input', () => {
    const r = checkCompatibility({ shipments: [{ shipmentId: 'x', cargoTypeId: 'unobtainium', packaging: 'boxed', weightKg: 10 }], trailer: CURTAIN });
    assert.ok(codes(r).includes('unknown_cargo_type'));
    assert.throws(() => checkCompatibility({ shipments: [{ shipmentId: 'x', cargoTypeId: 'wheat', packaging: 'loose' }], trailer: CURTAIN }), LogisticsValidationError);
    assert.throws(() => checkCompatibility({ shipments: [feed('a')], trailer: { trailerId: 'nope' } }), LogisticsValidationError);
    assert.throws(() => checkCompatibility({ shipments: [feed('a'), feed('a')], trailer: CURTAIN }), LogisticsValidationError);
  });

  it('localises messages to English on request', () => {
    const r = checkCompatibility({ shipments: [feed('a', { weightKg: 30000 })], trailer: CURTAIN, locale: 'en' });
    assert.match(r.reasons.find((x) => x.code === 'weight_exceeded').message, /exceeds the permitted payload/);
  });

  it('suggests trailer categories common to all shipments', () => {
    assert.deepEqual(suggestTrailerCategories([{ cargoTypeId: 'carrots', packaging: 'palletized' }, { cargoTypeId: 'packaged_agricultural_products', packaging: 'boxed' }]), ['curtainsider', 'refrigerated']);
    assert.deepEqual(suggestTrailerCategories([{ cargoTypeId: 'hay', packaging: 'baled' }, { cargoTypeId: 'carrots', packaging: 'palletized' }]), ['curtainsider']);
  });
});
