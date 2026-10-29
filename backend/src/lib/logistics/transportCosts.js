import { estimateFuel } from './fuelCalculator.js';
import { fromCents, roundEur, toCents } from './money.js';
import { normalizeRouteInput } from './routeInput.js';
import { createValidator } from './types.js';

/**
 * Estimated transport OPERATING cost for one journey.
 *
 * Three separate concepts are kept apart in the output:
 *   1. fuelCostEur                 — fuel only
 *   2. operatingCost               — journey expenses (fuel + stops + tolls + vehicle + other)
 *   3. customerTransportPriceEur   — the carrier's quoted/agreed price, only if provided
 *
 * A component left undefined is UNKNOWN (not zero). If any component is
 * unknown, operatingCost.totalEur is null and only knownSubtotalEur is given.
 * Pass 0 explicitly when a cost genuinely does not apply.
 *
 * Driver expenses (wages, per diem, accommodation, any other driver cost) are
 * excluded by design: there is no input for them and they are never added.
 *
 * @param {object} input
 * @param {import('./types.js').RouteInput} input.route
 * @param {{ consumptionLPer100Km: number, fuelPriceEurPerLiter: number }} input.fuel
 * @param {number} [input.stopCostEur]             Cost per intermediate stop (pickup/delivery/other).
 * @param {number} [input.tollsEur]
 * @param {number} [input.vehicleCostPerKmEur]      Depreciation, maintenance, tyres, insurance… per km.
 * @param {{ label: string, amountEur: number }[]} [input.otherExpenses]
 * @param {number} [input.customerTransportPriceEur]
 */
export function estimateTransportOperatingCost(input) {
  const route = normalizeRouteInput(input?.route);

  const v = createValidator();
  for (const key of ['stopCostEur', 'tollsEur', 'vehicleCostPerKmEur', 'customerTransportPriceEur']) {
    v.finiteNumber(key, input[key], { min: 0, max: 1_000_000, required: false });
  }
  (input.otherExpenses ?? []).forEach((e, i) => {
    if (typeof e?.label !== 'string' || !e.label) v.add(`otherExpenses.${i}.label`, 'required', 'is required');
    v.finiteNumber(`otherExpenses.${i}.amountEur`, e?.amountEur, { min: 0, max: 1_000_000 });
  });
  v.throwIfInvalid();

  const fuel = estimateFuel({
    distanceKm: route.totalDistanceKm,
    consumptionLPer100Km: input.fuel?.consumptionLPer100Km,
    fuelPriceEurPerLiter: input.fuel?.fuelPriceEurPerLiter,
  });

  const has = (k) => input[k] !== undefined && input[k] !== null;
  const components = [];
  const add = (key, amountEur, status, basis) => components.push({ key, amountEur: amountEur === null ? null : roundEur(amountEur), status, basis });

  add('fuel', fuel.fuelCostEur, 'calculated', { distanceKm: route.totalDistanceKm, ...input.fuel, fuelLiters: fuel.fuelLiters });

  if (route.stops.length === 0) add('stops', 0, 'calculated', { stopCount: 0 });
  else if (has('stopCostEur')) add('stops', route.stops.length * input.stopCostEur, 'calculated', { stopCount: route.stops.length, stopCostEur: input.stopCostEur });
  else add('stops', null, 'unknown', { stopCount: route.stops.length, missing: ['stopCostEur'] });

  add('tolls', has('tollsEur') ? input.tollsEur : null, has('tollsEur') ? 'provided' : 'unknown', {});

  if (has('vehicleCostPerKmEur')) {
    add('vehicleOperating', route.totalDistanceKm * input.vehicleCostPerKmEur, 'calculated', { distanceKm: route.totalDistanceKm, vehicleCostPerKmEur: input.vehicleCostPerKmEur });
  } else add('vehicleOperating', null, 'unknown', { missing: ['vehicleCostPerKmEur'] });

  for (const e of input.otherExpenses ?? []) add(`other:${e.label}`, e.amountEur, 'provided', {});

  const known = components.filter((c) => c.amountEur !== null);
  const unknownComponents = components.filter((c) => c.amountEur === null).map((c) => c.key);
  const knownSubtotalCents = known.reduce((s, c) => s + toCents(c.amountEur), 0);
  const isComplete = unknownComponents.length === 0;
  const totalEur = isComplete ? fromCents(knownSubtotalCents) : null;

  const price = has('customerTransportPriceEur') ? roundEur(input.customerTransportPriceEur) : null;

  return {
    route: { routeId: route.routeId, totalDistanceKm: route.totalDistanceKm, totalDurationMinutes: route.totalDurationMinutes, source: route.source, dataStatus: route.dataStatus },
    fuel: { fuelLiters: fuel.fuelLiters, fuelCostEur: fuel.fuelCostEurRounded },
    operatingCost: {
      components,
      knownSubtotalEur: fromCents(knownSubtotalCents),
      totalEur,
      isComplete,
      unknownComponents,
      isEstimate: true,
    },
    customerTransportPriceEur: price,
    // Margin only when both the price and a complete cost estimate exist.
    estimatedMarginEur: price !== null && totalEur !== null ? roundEur(price - totalEur) : null,
  };
}
