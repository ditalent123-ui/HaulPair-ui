import { ValidationError } from '../../utils/errors.js';
import { haversineKm } from '../routing/providers/demoTruck.js';
import { priceHaul } from './pricing.js';
import { routingVehicleFor, selectTrucks } from './truckSelection.js';

const MAX_CANDIDATES = 8;

/**
 * Price tracker route planner (carrier tab). For a load, pickup and cargo type it
 * compares candidate drop-off points:
 *   revenue        = grain price at the point (EUR/t) × tonnes
 *   transport cost = fuel (tracked diesel price, loaded + empty share) + tolls
 *                    — no driver expenses, no margin
 *   net per trip   = revenue − transport cost;  net per tonne = net / tonnes
 * and ranks by net per trip. Deterministic code; the AI only supplies the diesel price.
 */
export function createPlannerService({ catalog, truckRouter, dieselPrice, marketPrices }) {
  async function compare({ pickup, cargoType, amountT }) {
    const cargo = catalog.getCargo(cargoType);
    if (!cargo) throw new ValidationError('Unknown cargo type.', [{ field: 'cargoType', message: 'unknown cargo type' }]);

    const priced = marketPrices.pricesFor(cargoType);
    if (priced.length === 0) {
      return { options: [], best: null, runnerUp: null, reason: 'NO_PRICES_FOR_CARGO' };
    }
    const plan = selectTrucks({ fleet: catalog.fleet, cargo, amountT });
    const vehicle = routingVehicleFor(plan, catalog.getProfile);
    const diesel = await dieselPrice.getCurrent();

    // Pre-rank every priced point by an ESTIMATED net (straight line × road factor), then
    // route only the best few — keeps provider calls bounded without dropping far,
    // better-paying points such as port terminals.
    const { roadFactor, averageSpeedKmh } = catalog.pricing.demoRoute;
    const estimate = (km) =>
      priceHaul({
        plan,
        route: { distanceKm: Math.max(1, km * roadFactor), durationS: ((km * roadFactor) / averageSpeedKmh) * 3600 },
        dieselEurPerL: diesel.eurPerL,
        pricing: catalog.pricing,
        getProfile: catalog.getProfile,
        options: { includeVehicleCosts: false, includeMargin: false, applyMinimum: false },
      }).breakdown.trucks.reduce((s, t) => s + t.fuelEur + t.tollsEur, 0);
    const candidates = priced
      .map((c) => {
        const straightKm = haversineKm(pickup, c.point);
        return { ...c, straightKm, estNet: c.eurPerT * amountT - estimate(straightKm) };
      })
      .sort((a, b) => b.estNet - a.estNet)
      .slice(0, MAX_CANDIDATES);

    const options = [];
    for (const c of candidates) {
      const route = await truckRouter.route({ origin: pickup, destination: { lat: c.point.lat, lon: c.point.lon }, vehicle });
      const cost = priceHaul({
        plan,
        route,
        dieselEurPerL: diesel.eurPerL,
        pricing: catalog.pricing,
        getProfile: catalog.getProfile,
        options: { includeVehicleCosts: false, includeMargin: false, applyMinimum: false },
      });
      const transportCostEur = Math.round(cost.breakdown.trucks.reduce((s, t) => s + t.fuelEur + t.tollsEur, 0) * 100) / 100;
      const revenueEur = Math.round(c.eurPerT * amountT * 100) / 100;
      const netEur = Math.round((revenueEur - transportCostEur) * 100) / 100;
      options.push({
        dropoffId: c.point.id,
        name: c.point.name,
        type: c.point.type,
        region: c.point.region,
        lat: c.point.lat,
        lon: c.point.lon,
        distanceKm: route.distanceKm,
        routeDemo: route.demo,
        grainPriceEurPerT: c.eurPerT,
        priceSource: c.sourceName,
        priceUpdatedAt: c.updatedAt,
        priceDemo: c.demo,
        revenueEur,
        transportCostEur,
        netEur,
        netPerTonneEur: Math.round((netEur / amountT) * 100) / 100,
      });
    }
    options.sort((a, b) => b.netEur - a.netEur);
    options.forEach((o, i) => {
      o.rank = i + 1;
    });
    return {
      cargoType,
      amountT,
      diesel: { eurPerL: diesel.eurPerL, sourceName: diesel.sourceName, updatedAt: diesel.updatedAt, demo: diesel.demo },
      trucks: plan.truckCount,
      options,
      best: options[0] ?? null,
      runnerUp: options[1] ?? null,
    };
  }

  return { compare };
}
