import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTransportCost, CalculationError, round } from '../../src/services/calculation/transportCost.js';

/** Deterministic base input: 300 km, 32 l/100 km, 1.50 EUR/l, 24 t of 26 t. */
function baseInput(overrides = {}) {
  return {
    route: { outbound: { distanceKm: 300, durationS: 14400 }, return: null },
    truck: { capacityT: 26, fuelConsumptionLPer100Km: 32, cargoVolumeM3: 58, fuelType: 'diesel' },
    cargo: { typeCode: 'wheat', quantityT: 24, densityTPerM3: 0.78 },
    fuelPriceEurPerL: 1.5,
    returnTrip: { mode: 'none' },
    costs: { tollsEur: 20, loadingUnloadingEur: 30, otherEur: 10 },
    ...overrides,
  };
}

function problemsOf(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof CalculationError, `expected CalculationError, got ${err}`);
    return err.problems.map((p) => p.field);
  }
  assert.fail('expected a CalculationError');
}

describe('calculateTransportCost', () => {
  it('calculates a normal one-way transport', () => {
    const r = calculateTransportCost(baseInput());
    // 300 × 32 / 100 = 96 l; 96 × 1.5 = 144 EUR
    assert.equal(r.exact.fuelLitres, 96);
    assert.equal(r.exact.fuelCostEur, 144);
    // 144 + 20 + 30 + 10 = 204 (driver expenses are excluded by design)
    assert.equal(r.exact.totalCostEur, 204);
    assert.equal(r.exact.costPerTonneEur, 8.5);
    // 204 / (24 × 300) = 0.028333…
    assert.equal(round(r.exact.costPerTonneKmEur, 6), round(204 / 7200, 6));
    assert.equal(round(r.exact.capacityUtilizationPct, 4), round((24 / 26) * 100, 4));
    assert.equal(r.rounded.totalCostEur, 204);
    assert.equal(r.legs.length, 1);
    assert.equal(r.calculationVersion, '1.0.0');
  });

  it('includes additional costs and labels their source as user input', () => {
    const r = calculateTransportCost(baseInput());
    const byKey = Object.fromEntries(r.costLines.map((c) => [c.key, c]));
    assert.equal(byKey.fuel.source, 'calculated');
    assert.equal(byKey.tolls.amountEur, 20);
    assert.equal(byKey.tolls.source, 'user_input');
    assert.equal(byKey.loadingUnloading.amountEur, 30);
    assert.equal(byKey.driver, undefined, 'driver expenses are excluded by design');
    assert.equal(byKey.other.amountEur, 10);
    assert.equal(byKey.returnTolls, undefined);
  });

  it('treats omitted additional costs as zero', () => {
    const r = calculateTransportCost(baseInput({ costs: {} }));
    assert.equal(r.exact.totalCostEur, 144);
  });

  it('handles an empty return with its own consumption and tolls', () => {
    const r = calculateTransportCost(
      baseInput({
        route: { outbound: { distanceKm: 300, durationS: 14400 }, return: { distanceKm: 310, durationS: 15000 } },
        truck: { capacityT: 26, fuelConsumptionLPer100Km: 32, emptyFuelConsumptionLPer100Km: 25, fuelType: 'diesel' },
        returnTrip: { mode: 'empty' },
        costs: { tollsEur: 20, returnTollsEur: 15, loadingUnloadingEur: 30, otherEur: 10 },
      }),
    );
    // return: 310 × 25 / 100 = 77.5 l → 116.25 EUR
    assert.equal(r.legs[1].fuelLitres, 77.5);
    assert.equal(r.legs[1].loaded, false);
    assert.equal(r.exact.fuelLitres, 173.5);
    assert.equal(r.exact.fuelCostEur, 260.25);
    // 260.25 + 20 + 15 + 30 + 10 = 335.25
    assert.equal(r.exact.totalCostEur, 335.25);
    // tonnes delivered stay 24; tonne-km only for the loaded leg
    assert.equal(r.exact.tonnesDelivered, 24);
    assert.equal(r.exact.tonneKm, 7200);
    assert.equal(r.exact.durationS, 29400);
    assert.equal(r.exact.distanceKm, 610);
  });

  it('uses loaded consumption for an empty return when no empty value is given, and says so', () => {
    const r = calculateTransportCost(
      baseInput({
        route: { outbound: { distanceKm: 300 }, return: { distanceKm: 300 } },
        returnTrip: { mode: 'empty' },
      }),
    );
    assert.equal(r.legs[1].fuelConsumptionLPer100Km, 32);
    assert.equal(r.legs[1].fuelConsumptionSource, 'default_assumption');
    assert.equal(r.assumptions.length, 1);
  });

  it('counts the return cargo for a loaded return', () => {
    const r = calculateTransportCost(
      baseInput({
        route: { outbound: { distanceKm: 300 }, return: { distanceKm: 300 } },
        returnTrip: { mode: 'loaded', cargoQuantityT: 20 },
        costs: {},
      }),
    );
    // fuel 2 × 144 = 288; tonnes 44; tonne-km 24×300 + 20×300 = 13200
    assert.equal(r.exact.totalCostEur, 288);
    assert.equal(r.exact.tonnesDelivered, 44);
    assert.equal(r.exact.tonneKm, 13200);
    assert.equal(round(r.exact.costPerTonneEur, 6), round(288 / 44, 6));
    assert.equal(round(r.exact.returnCapacityUtilizationPct, 4), round((20 / 26) * 100, 4));
  });

  it('rejects zero and negative route distance', () => {
    assert.deepEqual(problemsOf(() => calculateTransportCost(baseInput({ route: { outbound: { distanceKm: 0 } } }))), ['route.outbound.distanceKm']);
    assert.deepEqual(problemsOf(() => calculateTransportCost(baseInput({ route: { outbound: { distanceKm: -5 } } }))), ['route.outbound.distanceKm']);
  });

  it('rejects missing route data', () => {
    assert.deepEqual(problemsOf(() => calculateTransportCost(baseInput({ route: undefined }))), ['route.outbound.distanceKm']);
    assert.deepEqual(problemsOf(() => calculateTransportCost(baseInput({ route: { outbound: { distanceKm: NaN } } }))), ['route.outbound.distanceKm']);
  });

  it('rejects a return trip without return route data', () => {
    assert.deepEqual(problemsOf(() => calculateTransportCost(baseInput({ returnTrip: { mode: 'empty' } }))), ['route.return.distanceKm']);
  });

  it('rejects zero and negative fuel price', () => {
    assert.deepEqual(problemsOf(() => calculateTransportCost(baseInput({ fuelPriceEurPerL: 0 }))), ['fuelPriceEurPerL']);
    assert.deepEqual(problemsOf(() => calculateTransportCost(baseInput({ fuelPriceEurPerL: -1.2 }))), ['fuelPriceEurPerL']);
  });

  it('rejects invalid fuel consumption', () => {
    for (const c of [0, -10, Number.POSITIVE_INFINITY, undefined]) {
      const input = baseInput();
      input.truck = { ...input.truck, fuelConsumptionLPer100Km: c };
      assert.deepEqual(problemsOf(() => calculateTransportCost(input)), ['truck.fuelConsumptionLPer100Km']);
    }
  });

  it('rejects cargo exceeding truck capacity', () => {
    const fields = problemsOf(() => calculateTransportCost(baseInput({ cargo: { typeCode: 'wheat', quantityT: 26.5 } })));
    assert.deepEqual(fields, ['cargo.quantityT']);
  });

  it('rejects return cargo exceeding capacity', () => {
    const fields = problemsOf(() =>
      calculateTransportCost(
        baseInput({ route: { outbound: { distanceKm: 300 }, return: { distanceKm: 300 } }, returnTrip: { mode: 'loaded', cargoQuantityT: 30 } }),
      ),
    );
    assert.deepEqual(fields, ['returnTrip.cargoQuantityT']);
  });

  it('protects against division by zero (zero cargo / zero capacity)', () => {
    assert.deepEqual(problemsOf(() => calculateTransportCost(baseInput({ cargo: { typeCode: 'wheat', quantityT: 0 } }))), ['cargo.quantityT']);
    const fields = problemsOf(() => calculateTransportCost(baseInput({ truck: { capacityT: 0, fuelConsumptionLPer100Km: 32 } })));
    assert.ok(fields.includes('truck.capacityT'));
  });

  it('rejects negative additional costs', () => {
    assert.deepEqual(problemsOf(() => calculateTransportCost(baseInput({ costs: { tollsEur: -1 } }))), ['costs.tollsEur']);
  });

  it('treats bulk density as optional: null density → no volume metric, still calculates', () => {
    const r = calculateTransportCost(baseInput({ cargo: { typeCode: 'wheat', quantityT: 24, densityTPerM3: null } }));
    assert.equal(r.volume, null);
    assert.equal(r.rounded.volumeUtilizationPct, null);
    // Density-independent metrics are unaffected.
    assert.equal(r.exact.totalCostEur, 204);
    assert.equal(r.rounded.capacityUtilizationPct, round((24 / 26) * 100, 1));
  });

  it('accepts an explicit 0 density without dividing by zero', () => {
    const r = calculateTransportCost(baseInput({ cargo: { typeCode: 'wheat', quantityT: 24, densityTPerM3: 0 } }));
    assert.equal(r.volume, null);
    assert.equal(r.rounded.volumeUtilizationPct, null);
    assert.ok(Number.isFinite(r.exact.totalCostEur));
  });

  it('computes volume only for a positive density', () => {
    const r = calculateTransportCost(baseInput({ cargo: { typeCode: 'wheat', quantityT: 22, densityTPerM3: 0.72 }, truck: { capacityT: 26, fuelConsumptionLPer100Km: 32, cargoVolumeM3: 59 } }));
    // 22 / 0.72 ≈ 30.6 m³ of 59 m³ ≈ 51.8 %
    assert.equal(round(r.volume.requiredM3, 1), 30.6);
    assert.equal(r.rounded.volumeUtilizationPct, 51.8);
  });

  it('rejects a negative density but allows 0', () => {
    assert.deepEqual(problemsOf(() => calculateTransportCost(baseInput({ cargo: { typeCode: 'wheat', quantityT: 24, densityTPerM3: -0.5 } }))), ['cargo.densityTPerM3']);
  });

  it('warns when the load is volume-limited', () => {
    // 24 t oats at 0.41 t/m³ ≈ 58.5 m³ > 50 m³ body
    const r = calculateTransportCost(
      baseInput({ truck: { capacityT: 26, fuelConsumptionLPer100Km: 32, cargoVolumeM3: 50 }, cargo: { typeCode: 'oats', quantityT: 24, densityTPerM3: 0.41 } }),
    );
    assert.ok(r.volume.utilizationPct > 100);
    assert.equal(r.warnings.length, 1);
  });

  it('rounds for display but keeps exact values', () => {
    const r = calculateTransportCost(baseInput({ route: { outbound: { distanceKm: 123.4567 } }, costs: {} }));
    assert.equal(r.exact.fuelCostEur, (123.4567 * 32 * 1.5) / 100);
    assert.equal(r.rounded.fuelCostEur, 59.26);
    assert.equal(r.rounded.costPerTonneKmEur, round(r.exact.costPerTonneKmEur, 4));
  });

  it('round() rounds half away from zero', () => {
    assert.equal(round(1.005, 2), 1.01);
    assert.equal(round(2.675, 2), 2.68);
    assert.equal(round(-1.005, 2), -1.01);
  });
});
