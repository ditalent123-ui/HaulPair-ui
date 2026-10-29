import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateCents,
  allocateSharedTransport,
  calculateFuelCostEur,
  calculateFuelLiters,
  calculateSavings,
  estimateFuel,
  estimateRouteDeviationFuel,
  estimateTransportOperatingCost,
  LogisticsValidationError,
  normalizeRouteInput,
  resolveConsumption,
  roundEur,
  routeInputFromPlannerLeg,
  getTractor,
} from '../../../src/lib/logistics/index.js';

const fields = (fn) => {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof LogisticsValidationError, `expected LogisticsValidationError, got ${err}`);
    return err.problems.map((p) => p.field).sort();
  }
  assert.fail('expected LogisticsValidationError');
};

// Clearly labelled sample route (not provider data).
const SAMPLE_ROUTE = { routeId: 'sample-1', distanceKm: 250, durationMinutes: 200, source: 'sample', dataStatus: 'demo_sample' };

describe('fuel calculator', () => {
  it('250 km at 30 l/100 km and €1.50/l → 75 l and €112.50', () => {
    const r = estimateFuel({ distanceKm: 250, consumptionLPer100Km: 30, fuelPriceEurPerLiter: 1.5 });
    assert.equal(r.fuelLiters, 75);
    assert.equal(r.fuelCostEur, 112.5);
    assert.equal(r.fuelCostEurRounded, 112.5);
  });

  it('15 km additional distance → €6.75', () => {
    const r = estimateRouteDeviationFuel({ additionalDistanceKm: 15, consumptionLPer100Km: 30, fuelPriceEurPerLiter: 1.5 });
    assert.equal(r.fuelLiters, 4.5);
    assert.equal(r.fuelCostEurRounded, 6.75);
  });

  it('formulas A and B separately', () => {
    assert.equal(calculateFuelLiters({ distanceKm: 100, consumptionLPer100Km: 30 }), 30);
    assert.equal(calculateFuelCostEur({ fuelLiters: 30, fuelPriceEurPerLiter: 1.5 }), 45);
  });

  it('rejects invalid or negative distances', () => {
    assert.deepEqual(fields(() => estimateFuel({ distanceKm: -1, consumptionLPer100Km: 30, fuelPriceEurPerLiter: 1.5 })), ['distanceKm']);
    assert.deepEqual(fields(() => estimateFuel({ distanceKm: Number.NaN, consumptionLPer100Km: 30, fuelPriceEurPerLiter: 1.5 })), ['distanceKm']);
    assert.deepEqual(fields(() => estimateFuel({ distanceKm: '250', consumptionLPer100Km: 30, fuelPriceEurPerLiter: 1.5 })), ['distanceKm']);
  });

  it('rejects missing fuel price and missing consumption', () => {
    assert.deepEqual(fields(() => estimateFuel({ distanceKm: 250, consumptionLPer100Km: 30 })), ['fuelPriceEurPerLiter']);
    assert.deepEqual(fields(() => estimateFuel({ distanceKm: 250, fuelPriceEurPerLiter: 1.5 })), ['consumptionLPer100Km']);
    assert.deepEqual(fields(() => estimateFuel({ distanceKm: 250, consumptionLPer100Km: 0, fuelPriceEurPerLiter: 0 })), ['consumptionLPer100Km', 'fuelPriceEurPerLiter']);
  });

  it('zero distance gives zero fuel and cost (valid: e.g. no detour)', () => {
    const r = estimateFuel({ distanceKm: 0, consumptionLPer100Km: 30, fuelPriceEurPerLiter: 1.5 });
    assert.equal(r.fuelLiters, 0);
    assert.equal(r.fuelCostEurRounded, 0);
  });

  it('handles decimal inputs and rounds cost to cents', () => {
    const r = estimateFuel({ distanceKm: 123.45, consumptionLPer100Km: 29.7, fuelPriceEurPerLiter: 1.479 });
    assert.equal(r.fuelLiters, (123.45 * 29.7) / 100);
    assert.equal(r.fuelCostEurRounded, 54.23); // 36.66465 l × 1.479 = 54.2270… → 54.23
  });

  it('resolveConsumption never silently uses the test-cycle reference value', () => {
    const volvo = getTractor('volvo_fh_aero_420_isave');
    const r = resolveConsumption({ tractor: volvo });
    assert.equal(r.valueLPer100Km, 30);
    assert.equal(r.source, 'demo_assumption');
    assert.equal(r.referenceLPer100Km, 21.2);
    assert.equal(resolveConsumption({ tractor: volvo, overrideLPer100Km: 33.5 }).source, 'user_override');
    assert.throws(() => resolveConsumption({ overrideLPer100Km: -1 }), LogisticsValidationError);
  });
});

describe('route input contract', () => {
  it('normalises totals including detours', () => {
    const r = normalizeRouteInput({ ...SAMPLE_ROUTE, additionalDistanceKm: 15, additionalDurationMinutes: 12 });
    assert.equal(r.totalDistanceKm, 265);
    assert.equal(r.totalDurationMinutes, 212);
    assert.deepEqual(r.stops, []);
  });
  it('rejects missing source/status and invalid stops', () => {
    assert.deepEqual(
      fields(() => normalizeRouteInput({ routeId: 'x', distanceKm: 10, stops: [{ type: 'teleport' }] })),
      ['route.dataStatus', 'route.source', 'route.stops.0.type'],
    );
  });
  it('adapts a planner route leg', () => {
    const r = routeInputFromPlannerLeg({ distanceKm: 300, durationS: 3600 }, { routeId: 'r1', providerName: 'openrouteservice' });
    assert.equal(r.durationMinutes, 60);
    assert.equal(r.dataStatus, 'provider');
  });
});

describe('transport operating cost', () => {
  const full = {
    route: { ...SAMPLE_ROUTE, additionalDistanceKm: 15, stops: [{ type: 'pickup', durationMinutes: 20 }] },
    fuel: { consumptionLPer100Km: 30, fuelPriceEurPerLiter: 1.5 },
    stopCostEur: 5,
    tollsEur: 12,
    vehicleCostPerKmEur: 0.2,
    otherExpenses: [{ label: 'parking', amountEur: 8 }],
  };

  it('sums all components when everything is known', () => {
    const r = estimateTransportOperatingCost(full);
    // fuel: 265 km × 0.3 l/km × 1.5 = 119.25
    assert.equal(r.fuel.fuelCostEur, 119.25);
    const c = Object.fromEntries(r.operatingCost.components.map((x) => [x.key, x.amountEur]));
    // Driver expenses are excluded by design: no such component exists.
    assert.equal(c.driverLabor, undefined);
    assert.equal(c.stops, 5);
    assert.equal(c.tolls, 12);
    assert.equal(c.vehicleOperating, 53); // 265 × 0.2
    assert.equal(c['other:parking'], 8);
    assert.equal(r.operatingCost.isComplete, true);
    assert.equal(r.operatingCost.totalEur, 197.25);
    assert.equal(r.customerTransportPriceEur, null);
    assert.equal(r.estimatedMarginEur, null);
  });

  it('keeps unknown components unknown instead of zero', () => {
    const r = estimateTransportOperatingCost({ route: SAMPLE_ROUTE, fuel: { consumptionLPer100Km: 30, fuelPriceEurPerLiter: 1.5 } });
    assert.equal(r.operatingCost.isComplete, false);
    assert.equal(r.operatingCost.totalEur, null);
    assert.equal(r.operatingCost.knownSubtotalEur, 112.5);
    assert.deepEqual(r.operatingCost.unknownComponents, ['tolls', 'vehicleOperating']);
  });

  it('keeps fuel cost, operating cost and customer price separate', () => {
    const r = estimateTransportOperatingCost({ ...full, customerTransportPriceEur: 320 });
    assert.equal(r.fuel.fuelCostEur, 119.25);
    assert.equal(r.operatingCost.totalEur, 197.25);
    assert.equal(r.customerTransportPriceEur, 320);
    assert.equal(r.estimatedMarginEur, 122.75);
  });

  it('rejects negative cost inputs', () => {
    assert.deepEqual(fields(() => estimateTransportOperatingCost({ ...full, tollsEur: -1, stopCostEur: -2 })), ['stopCostEur', 'tollsEur']);
  });
});

describe('savings and commission', () => {
  it('€360 separate vs €275 combined at 20 % → €85 / €17 / €68', () => {
    const r = calculateSavings({ separateTransportTotalEur: 360, combinedTransportTotalEur: 275, commissionRate: 0.2 });
    assert.equal(r.grossSavingsEur, 85);
    assert.equal(r.platformFeeEur, 17);
    assert.equal(r.netClientSavingsEur, 68);
    assert.equal(r.feeChargeable, true);
  });

  it('charges no fee when combined transport is more expensive', () => {
    const r = calculateSavings({ separateTransportTotalEur: 250, combinedTransportTotalEur: 275 });
    assert.equal(r.grossSavingsEur, -25);
    assert.equal(r.platformFeeEur, 0);
    assert.equal(r.netClientSavingsEur, -25);
    assert.equal(r.hasSavings, false);
    assert.equal(r.notes[0].key, 'savings.no_savings');
  });

  it('charges no fee at zero savings', () => {
    const r = calculateSavings({ separateTransportTotalEur: 275, combinedTransportTotalEur: 275 });
    assert.equal(r.grossSavingsEur, 0);
    assert.equal(r.platformFeeEur, 0);
  });

  it('charges no fee when services are not equivalent', () => {
    const r = calculateSavings({ separateTransportTotalEur: 360, combinedTransportTotalEur: 275, servicesEquivalent: false });
    assert.equal(r.platformFeeEur, 0);
    assert.ok(r.notes.some((n) => n.key === 'savings.services_not_equivalent'));
  });

  it('is configurable and rounds to cents', () => {
    const r = calculateSavings({ separateTransportTotalEur: 100.01, combinedTransportTotalEur: 50, commissionRate: 0.15 });
    assert.equal(r.grossSavingsEur, 50.01);
    assert.equal(r.platformFeeEur, 7.5); // 750.15 cents → 750
    assert.equal(r.netClientSavingsEur, 42.51);
  });

  it('rejects invalid commission rates', () => {
    for (const rate of [-0.1, 1, 20, Number.NaN, '0.2']) {
      assert.deepEqual(fields(() => calculateSavings({ separateTransportTotalEur: 360, combinedTransportTotalEur: 275, commissionRate: rate })), ['commissionRate']);
    }
  });

  it('allocates a shared cost proportionally so every customer saves', () => {
    const r = allocateSharedTransport({
      combinedTransportTotalEur: 275,
      participants: [
        { participantId: 'farm_a', independentAlternativeEur: 200 },
        { participantId: 'farm_b', independentAlternativeEur: 160 },
      ],
    });
    assert.equal(r.status, 'mutually_beneficial');
    assert.equal(r.grossSavingsEur, 85);
    const [a, b] = r.participants;
    assert.equal(a.allocatedTransportCostEur + b.allocatedTransportCostEur, 275);
    assert.equal(a.allocatedTransportCostEur, 152.78); // 275 × 200/360
    assert.equal(b.allocatedTransportCostEur, 122.22);
    assert.equal(a.platformFeeEur, 9.44); // 47.22 × 0.2
    assert.equal(b.platformFeeEur, 7.56); // 37.78 × 0.2
    assert.equal(r.totalPlatformFeeEur, 17);
    assert.equal(r.netClientSavingsEur, 68);
    assert.ok(r.participants.every((p) => !p.paysMoreThanAlternative && p.netSavingsEur > 0));
  });

  it('supports configurable allocation methods (weight, custom)', () => {
    const byWeight = allocateSharedTransport({
      combinedTransportTotalEur: 300,
      method: 'weight',
      participants: [
        { participantId: 'a', independentAlternativeEur: 250, weightKg: 18000 },
        { participantId: 'b', independentAlternativeEur: 150, weightKg: 6000 },
      ],
    });
    assert.deepEqual(byWeight.participants.map((p) => p.allocatedTransportCostEur), [225, 75]);
    const custom = allocateSharedTransport({
      combinedTransportTotalEur: 100,
      method: 'custom',
      customShares: { a: 0.333, b: 0.667 },
      participants: [{ participantId: 'a', independentAlternativeEur: 60 }, { participantId: 'b', independentAlternativeEur: 80 }],
    });
    assert.deepEqual(custom.participants.map((p) => p.allocatedTransportCostEur), [33.3, 66.7]);
  });

  it('flags a customer whose allocated cost exceeds their independent alternative', () => {
    const r = allocateSharedTransport({
      combinedTransportTotalEur: 300,
      method: 'equal',
      participants: [
        { participantId: 'big', independentAlternativeEur: 250 },
        { participantId: 'small', independentAlternativeEur: 120 },
      ],
    });
    // equal split: 150 each → "small" pays 30 more than alone
    assert.equal(r.status, 'not_mutually_beneficial');
    assert.equal(r.feesChargeable, false);
    assert.equal(r.totalPlatformFeeEur, 0);
    const small = r.participants.find((p) => p.participantId === 'small');
    assert.equal(small.paysMoreThanAlternative, true);
    assert.equal(small.grossSavingsEur, -30);
    assert.ok(r.notes.some((n) => n.key === 'savings.participant_worse_off' && n.participantId === 'small'));
  });

  it('reports no_savings for a group without savings', () => {
    const r = allocateSharedTransport({
      combinedTransportTotalEur: 400,
      participants: [{ participantId: 'a', independentAlternativeEur: 200 }, { participantId: 'b', independentAlternativeEur: 150 }],
    });
    assert.equal(r.status, 'no_savings');
    assert.equal(r.totalPlatformFeeEur, 0);
  });

  it('validates participants and shares', () => {
    assert.ok(fields(() => allocateSharedTransport({ combinedTransportTotalEur: 100, participants: [{ participantId: 'a', independentAlternativeEur: 60 }] })).includes('participants'));
    assert.ok(
      fields(() =>
        allocateSharedTransport({
          combinedTransportTotalEur: 100,
          method: 'custom',
          customShares: { a: 0.5, b: 0.4 },
          participants: [{ participantId: 'a', independentAlternativeEur: 60 }, { participantId: 'b', independentAlternativeEur: 80 }],
        }),
      ).includes('customShares'),
    );
  });
});

describe('money helpers', () => {
  it('largest-remainder allocation always sums to the total', () => {
    for (const total of [1, 100, 27500, 99999]) {
      const parts = allocateCents(total, [1, 1, 1]);
      assert.equal(parts.reduce((s, p) => s + p, 0), total);
    }
    assert.deepEqual(allocateCents(100, [1, 1, 1]), [34, 33, 33]);
  });
  it('roundEur rounds half away from zero at cents', () => {
    assert.equal(roundEur(1.005), 1.01);
    assert.equal(roundEur(112.5), 112.5);
    assert.equal(roundEur(-2.675), -2.68);
  });
});
