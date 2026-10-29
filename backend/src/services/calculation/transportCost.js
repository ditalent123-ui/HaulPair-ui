/**
 * Transport cost calculation engine.
 *
 * Pure functions only: no I/O, no clock, no randomness, so results are
 * deterministic and reproducible from the stored inputs. Every saved
 * calculation records CALCULATION_VERSION so a later change of formulas can be
 * distinguished from historical results.
 *
 * Formulas (per leg):
 *   fuel litres        = distance_km × consumption_l_per_100km / 100
 *   fuel cost          = fuel litres × fuel price (EUR/l)
 * Totals:
 *   total cost         = fuel cost + tolls + return tolls + loading/unloading + other
 *                        (driver expenses are excluded by design)
 *   cost per tonne     = total cost / tonnes delivered
 *   cost per tonne-km  = total cost / Σ(cargo tonnes × leg distance)
 *
 * Extension points (VAT, margins, contracted freight rates, profitability) are
 * meant to be added as further pure steps that take the object returned by
 * calculateTransportCost() and add their own section, without changing the
 * base cost formulas.
 */

import { calculateFuelCostEur, calculateFuelLiters } from '../../lib/logistics/fuelCalculator.js';

export const CALCULATION_VERSION = '1.0.0';

export const RETURN_MODES = Object.freeze(['none', 'empty', 'loaded']);

/** Value provenance, shown in the UI so users can see what is theirs vs. derived. */
export const SOURCE = Object.freeze({
  USER: 'user_input',
  ROUTING: 'routing_provider',
  CALCULATED: 'calculated',
  ASSUMPTION: 'default_assumption',
});

export class CalculationError extends Error {
  constructor(problems) {
    super(`Transport calculation rejected: ${problems.map((p) => p.message).join(' ')}`);
    this.name = 'CalculationError';
    this.problems = problems;
  }
}

/** Round half away from zero to `decimals` places. Only used for presentation. */
export function round(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * factor)) / factor;
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function validate(input) {
  const problems = [];
  const add = (field, message) => problems.push({ field, message });

  const route = input?.route;
  const outbound = route?.outbound;
  if (!outbound || !isFiniteNumber(outbound.distanceKm)) {
    add('route.outbound.distanceKm', 'Route distance is missing. Calculate a route first.');
  } else if (outbound.distanceKm <= 0) {
    add('route.outbound.distanceKm', 'Route distance must be greater than 0 km.');
  }

  const truck = input?.truck ?? {};
  if (!isFiniteNumber(truck.capacityT) || truck.capacityT <= 0) {
    add('truck.capacityT', 'Truck cargo capacity must be greater than 0 t.');
  }
  if (!isFiniteNumber(truck.fuelConsumptionLPer100Km) || truck.fuelConsumptionLPer100Km <= 0) {
    add('truck.fuelConsumptionLPer100Km', 'Fuel consumption must be greater than 0 l/100 km.');
  }
  if (
    truck.emptyFuelConsumptionLPer100Km !== undefined &&
    truck.emptyFuelConsumptionLPer100Km !== null &&
    (!isFiniteNumber(truck.emptyFuelConsumptionLPer100Km) || truck.emptyFuelConsumptionLPer100Km <= 0)
  ) {
    add('truck.emptyFuelConsumptionLPer100Km', 'Empty-run fuel consumption must be greater than 0 l/100 km.');
  }
  if (
    truck.cargoVolumeM3 !== undefined &&
    truck.cargoVolumeM3 !== null &&
    (!isFiniteNumber(truck.cargoVolumeM3) || truck.cargoVolumeM3 <= 0)
  ) {
    add('truck.cargoVolumeM3', 'Cargo body volume must be greater than 0 m³ when provided.');
  }

  if (!isFiniteNumber(input?.fuelPriceEurPerL)) {
    add('fuelPriceEurPerL', 'Fuel price is required.');
  } else if (input.fuelPriceEurPerL <= 0) {
    add('fuelPriceEurPerL', 'Fuel price must be greater than 0 EUR/l.');
  }

  const cargo = input?.cargo ?? {};
  if (!isFiniteNumber(cargo.quantityT) || cargo.quantityT <= 0) {
    add('cargo.quantityT', 'Cargo quantity must be greater than 0 t.');
  } else if (isFiniteNumber(truck.capacityT) && cargo.quantityT > truck.capacityT) {
    add('cargo.quantityT', `Cargo quantity (${cargo.quantityT} t) exceeds the truck capacity (${truck.capacityT} t).`);
  }
  // Bulk density is OPTIONAL and 0 is allowed (meaning "not provided for the volume estimate").
  // Only a negative or non-finite value is rejected; a positive value is used for the volume check.
  if (
    cargo.densityTPerM3 !== undefined &&
    cargo.densityTPerM3 !== null &&
    (!isFiniteNumber(cargo.densityTPerM3) || cargo.densityTPerM3 < 0)
  ) {
    add('cargo.densityTPerM3', 'Bulk density must be 0 or greater (t/m³), or left empty.');
  }

  const mode = input?.returnTrip?.mode ?? 'none';
  if (!RETURN_MODES.includes(mode)) {
    add('returnTrip.mode', `Return trip mode must be one of: ${RETURN_MODES.join(', ')}.`);
  } else if (mode !== 'none') {
    const ret = route?.return;
    if (!ret || !isFiniteNumber(ret.distanceKm)) {
      add('route.return.distanceKm', 'Return route is missing. Recalculate the route with the return trip enabled.');
    } else if (ret.distanceKm <= 0) {
      add('route.return.distanceKm', 'Return route distance must be greater than 0 km.');
    }
    if (mode === 'loaded') {
      const q = input.returnTrip.cargoQuantityT;
      if (!isFiniteNumber(q) || q <= 0) {
        add('returnTrip.cargoQuantityT', 'Return cargo quantity must be greater than 0 t for a loaded return.');
      } else if (isFiniteNumber(truck.capacityT) && q > truck.capacityT) {
        add('returnTrip.cargoQuantityT', `Return cargo (${q} t) exceeds the truck capacity (${truck.capacityT} t).`);
      }
    }
  }

  const costs = input?.costs ?? {};
  for (const key of ['tollsEur', 'returnTollsEur', 'loadingUnloadingEur', 'otherEur']) {
    const v = costs[key];
    if (v === undefined || v === null) continue;
    if (!isFiniteNumber(v) || v < 0) add(`costs.${key}`, `${key} must be 0 or greater.`);
  }

  return problems;
}

function computeLeg({ name, distanceKm, durationS, consumption, consumptionSource, fuelPrice, cargoT }) {
  // Shared formulas from the logistics module (Formula A and B).
  const fuelLitres = calculateFuelLiters({ distanceKm, consumptionLPer100Km: consumption });
  return {
    leg: name,
    distanceKm,
    durationS: isFiniteNumber(durationS) ? durationS : null,
    loaded: cargoT > 0,
    cargoT,
    fuelConsumptionLPer100Km: consumption,
    fuelConsumptionSource: consumptionSource,
    fuelLitres,
    fuelCostEur: calculateFuelCostEur({ fuelLiters: fuelLitres, fuelPriceEurPerLiter: fuelPrice }),
    tonneKm: cargoT * distanceKm,
  };
}

/**
 * Calculate estimated transport costs. Throws CalculationError on invalid input.
 * Returns unrounded values in `exact` and presentation values in `rounded`.
 */
export function calculateTransportCost(input) {
  const problems = validate(input);
  if (problems.length > 0) throw new CalculationError(problems);

  const { route, truck, cargo, fuelPriceEurPerL: fuelPrice } = input;
  const mode = input.returnTrip?.mode ?? 'none';
  const costsIn = input.costs ?? {};
  const assumptions = [];
  const warnings = [];

  const legs = [
    computeLeg({
      name: 'outbound',
      distanceKm: route.outbound.distanceKm,
      durationS: route.outbound.durationS,
      consumption: truck.fuelConsumptionLPer100Km,
      consumptionSource: SOURCE.USER,
      fuelPrice,
      cargoT: cargo.quantityT,
    }),
  ];

  if (mode !== 'none') {
    const loaded = mode === 'loaded';
    let consumption = truck.fuelConsumptionLPer100Km;
    let consumptionSource = SOURCE.USER;
    if (!loaded) {
      if (isFiniteNumber(truck.emptyFuelConsumptionLPer100Km)) {
        consumption = truck.emptyFuelConsumptionLPer100Km;
      } else {
        consumptionSource = SOURCE.ASSUMPTION;
        assumptions.push(
          'No empty-run fuel consumption was given, so the loaded consumption was used for the empty return (conservative).',
        );
      }
    }
    legs.push(
      computeLeg({
        name: 'return',
        distanceKm: route.return.distanceKm,
        durationS: route.return.durationS,
        consumption,
        consumptionSource,
        fuelPrice,
        cargoT: loaded ? input.returnTrip.cargoQuantityT : 0,
      }),
    );
  }

  const fuelLitres = legs.reduce((s, l) => s + l.fuelLitres, 0);
  const fuelCostEur = legs.reduce((s, l) => s + l.fuelCostEur, 0);
  const distanceKm = legs.reduce((s, l) => s + l.distanceKm, 0);
  const durationS = legs.every((l) => l.durationS !== null) ? legs.reduce((s, l) => s + l.durationS, 0) : null;
  const tonneKm = legs.reduce((s, l) => s + l.tonneKm, 0);
  const tonnesDelivered = legs.reduce((s, l) => s + l.cargoT, 0);

  const userCost = (key) => (isFiniteNumber(costsIn[key]) ? costsIn[key] : 0);
  const costLines = [
    { key: 'fuel', label: 'Fuel', amountEur: fuelCostEur, source: SOURCE.CALCULATED },
    { key: 'tolls', label: 'Tolls / road charges (outbound)', amountEur: userCost('tollsEur'), source: SOURCE.USER },
  ];
  if (mode !== 'none') {
    costLines.push({
      key: 'returnTolls',
      label: 'Tolls / road charges (return)',
      amountEur: userCost('returnTollsEur'),
      source: SOURCE.USER,
    });
  } else if (userCost('returnTollsEur') > 0) {
    warnings.push('Return tolls were entered but no return trip is selected; they were ignored.');
  }
  costLines.push(
    { key: 'loadingUnloading', label: 'Loading / unloading', amountEur: userCost('loadingUnloadingEur'), source: SOURCE.USER },
    { key: 'other', label: 'Other operating costs', amountEur: userCost('otherEur'), source: SOURCE.USER },
  );

  const totalCostEur = costLines.reduce((s, c) => s + c.amountEur, 0);

  // Denominators are guaranteed > 0 by validation; the guards make that explicit.
  if (!(tonnesDelivered > 0) || !(tonneKm > 0)) {
    throw new CalculationError([{ field: 'cargo.quantityT', message: 'Cannot divide by zero cargo or distance.' }]);
  }
  const costPerTonneEur = totalCostEur / tonnesDelivered;
  const costPerTonneKmEur = totalCostEur / tonneKm;

  const capacityUtilizationPct = (cargo.quantityT / truck.capacityT) * 100;
  const returnCapacityUtilizationPct = mode === 'loaded' ? (input.returnTrip.cargoQuantityT / truck.capacityT) * 100 : null;

  // Volume is only estimated with a POSITIVE density. With null or 0 density the
  // volume metric is left unknown ("—") — never divided by zero, never faked as 0 %.
  let volume = null;
  if (isFiniteNumber(cargo.densityTPerM3) && cargo.densityTPerM3 > 0 && isFiniteNumber(truck.cargoVolumeM3)) {
    const requiredM3 = cargo.quantityT / cargo.densityTPerM3;
    const utilizationPct = (requiredM3 / truck.cargoVolumeM3) * 100;
    volume = { requiredM3, availableM3: truck.cargoVolumeM3, utilizationPct };
    if (utilizationPct > 100) {
      warnings.push(
        `At ${cargo.densityTPerM3} t/m³ the cargo needs about ${round(requiredM3, 1)} m³, more than the ${truck.cargoVolumeM3} m³ body volume. The load is likely volume-limited.`,
      );
    }
  }

  const exact = {
    distanceKm,
    durationS,
    fuelLitres,
    fuelCostEur,
    totalCostEur,
    costPerTonneEur,
    costPerTonneKmEur,
    tonneKm,
    tonnesDelivered,
    capacityUtilizationPct,
    returnCapacityUtilizationPct,
  };

  return {
    calculationVersion: CALCULATION_VERSION,
    currency: 'EUR',
    returnMode: mode,
    legs,
    costLines,
    exact,
    volume,
    rounded: {
      distanceKm: round(distanceKm, 1),
      durationS: durationS === null ? null : Math.round(durationS),
      fuelLitres: round(fuelLitres, 1),
      fuelCostEur: round(fuelCostEur, 2),
      totalCostEur: round(totalCostEur, 2),
      costPerTonneEur: round(costPerTonneEur, 2),
      costPerTonneKmEur: round(costPerTonneKmEur, 4),
      tonneKm: round(tonneKm, 1),
      tonnesDelivered: round(tonnesDelivered, 3),
      capacityUtilizationPct: round(capacityUtilizationPct, 1),
      returnCapacityUtilizationPct: round(returnCapacityUtilizationPct, 1),
      volumeUtilizationPct: volume ? round(volume.utilizationPct, 1) : null,
      costLines: costLines.map((c) => ({ ...c, amountEur: round(c.amountEur, 2) })),
    },
    assumptions,
    warnings,
  };
}
