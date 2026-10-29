import { AppError, NotFoundError, ValidationError } from '../utils/errors.js';
import { RouteTokenError, verifyRouteToken } from '../utils/routeToken.js';
import { calculateTransportCost, CalculationError, SOURCE } from './calculation/transportCost.js';

export class CalculationRejectedError extends AppError {
  constructor(problems) {
    super('The transport calculation was rejected.', { status: 422, code: 'CALCULATION_REJECTED', details: problems });
  }
}

/**
 * Orchestrates a calculation request:
 *   verify the signed route → resolve reference data → run the pure engine → (optionally) persist.
 */
export function createCalculationService({
  calculationRepository,
  referenceDataRepository,
  activityService,
  routeTokenSecret,
}) {
  function readRoute(routeToken) {
    try {
      return verifyRouteToken(routeToken, routeTokenSecret);
    } catch (err) {
      if (err instanceof RouteTokenError) {
        throw new ValidationError(err.message, [{ field: 'routeToken', message: err.message }]);
      }
      throw err;
    }
  }

  async function prepare(request) {
    const route = readRoute(request.routeToken);

    const cargoType = await referenceDataRepository.getCargoTypeByCode(request.cargo.typeCode);
    if (!cargoType) {
      throw new ValidationError('Unknown cargo type.', [
        { field: 'cargo.typeCode', message: `Cargo type "${request.cargo.typeCode}" is not supported.` },
      ]);
    }

    let truckPreset = null;
    if (request.truckConfigurationId) {
      truckPreset = await referenceDataRepository.getTruckById(request.truckConfigurationId);
      if (!truckPreset) {
        throw new ValidationError('Unknown truck configuration.', [
          { field: 'truckConfigurationId', message: 'The selected truck configuration does not exist.' },
        ]);
      }
    }

    // Density is taken ONLY from the user (an explicit 0 is kept as 0). We never
    // silently substitute a typical density by grain type; a suggestion must be
    // an explicit user choice made in the UI before it reaches here.
    const densityFromUser = typeof request.cargo.densityTPerM3 === 'number';
    const density = densityFromUser ? request.cargo.densityTPerM3 : null;

    const engineInput = {
      route: { outbound: route.outbound, return: route.return },
      truck: request.truck,
      cargo: { typeCode: cargoType.code, quantityT: request.cargo.quantityT, densityTPerM3: density },
      fuelPriceEurPerL: request.fuelPriceEurPerL,
      returnTrip: request.returnTrip,
      costs: request.costs,
    };

    let result;
    try {
      result = calculateTransportCost(engineInput);
    } catch (err) {
      if (err instanceof CalculationError) throw new CalculationRejectedError(err.problems);
      throw err;
    }

    const sources = {
      distance: SOURCE.ROUTING,
      duration: SOURCE.ROUTING,
      fuelPrice: SOURCE.USER,
      fuelConsumption: SOURCE.USER,
      cargoQuantity: SOURCE.USER,
      cargoDensity: densityFromUser ? SOURCE.USER : null,
    };

    return { route, cargoType, truckPreset, engineInput, result, sources };
  }

  function presentEstimate({ route, cargoType, truckPreset, engineInput, result, sources }) {
    return {
      route: {
        provider: route.provider,
        profile: route.profile,
        truckRestrictionsApplied: route.truckRestrictionsApplied,
        vehicleRestrictions: route.vehicle,
        origin: route.origin,
        destination: route.destination,
        outbound: route.outbound,
        return: route.return,
      },
      cargoType: { code: cargoType.code, name: cargoType.name },
      truckConfiguration: truckPreset ? { id: truckPreset.id, name: truckPreset.name } : null,
      inputs: engineInput,
      sources,
      calculation: result,
    };
  }

  return {
    async estimate(request) {
      return presentEstimate(await prepare(request));
    },

    async save(request, { requestId } = {}) {
      const prepared = await prepare(request);
      const { route, cargoType, truckPreset, engineInput, result } = prepared;
      const exact = result.exact;
      const line = (key) => result.costLines.find((c) => c.key === key)?.amountEur ?? 0;
      const returnLeg = result.legs.find((l) => l.leg === 'return');

      const row = {
        label: request.label || null,
        calculation_version: result.calculationVersion,
        currency: result.currency,
        origin_label: route.origin.label,
        origin_lat: route.origin.lat,
        origin_lon: route.origin.lon,
        destination_label: route.destination.label,
        destination_lat: route.destination.lat,
        destination_lon: route.destination.lon,
        routing_provider: route.provider,
        routing_profile: route.profile,
        truck_restrictions_applied: route.truckRestrictionsApplied,
        outbound_distance_km: route.outbound.distanceKm,
        outbound_duration_s: route.outbound.durationS === null ? null : Math.round(route.outbound.durationS),
        return_mode: result.returnMode,
        return_distance_km: returnLeg ? returnLeg.distanceKm : null,
        return_duration_s: returnLeg?.durationS == null ? null : Math.round(returnLeg.durationS),
        route_metadata: {
          vehicleRestrictions: route.vehicle,
          routeIssuedAt: new Date(route.iat * 1000).toISOString(),
          geometryStored: false,
        },
        truck_configuration_id: truckPreset ? truckPreset.id : null,
        truck_snapshot: { ...request.truck, name: request.truck.name ?? truckPreset?.name ?? 'Custom truck' },
        truck_capacity_t: request.truck.capacityT,
        fuel_type: request.truck.fuelType,
        fuel_consumption_l_100km: request.truck.fuelConsumptionLPer100Km,
        empty_fuel_consumption_l_100km: request.truck.emptyFuelConsumptionLPer100Km ?? null,
        fuel_price_eur_l: request.fuelPriceEurPerL,
        fuel_price_origin: request.fuelPriceMeta?.origin ?? 'manual',
        fuel_price_date: request.fuelPriceMeta?.priceDate ?? null,
        fuel_price_source: request.fuelPriceMeta?.source ?? null,
        cargo_type_id: cargoType.id,
        cargo_type_code: cargoType.code,
        cargo_quantity_t: request.cargo.quantityT,
        return_cargo_quantity_t: result.returnMode === 'loaded' ? request.returnTrip.cargoQuantityT : null,
        cargo_density_t_m3: engineInput.cargo.densityTPerM3,
        fuel_litres: exact.fuelLitres,
        fuel_cost_eur: exact.fuelCostEur,
        tolls_eur: line('tolls'),
        return_tolls_eur: line('returnTolls'),
        loading_unloading_eur: line('loadingUnloading'),
        other_cost_eur: line('other'),
        total_cost_eur: exact.totalCostEur,
        cost_per_tonne_eur: exact.costPerTonneEur,
        cost_per_tonne_km_eur: exact.costPerTonneKmEur,
        capacity_utilization_pct: exact.capacityUtilizationPct,
        inputs: { ...engineInput, truckConfigurationId: truckPreset?.id ?? null, label: request.label ?? null },
        results: presentEstimate(prepared),
      };

      const saved = await calculationRepository.create(row);
      await activityService.record({
        eventType: 'calculation.created',
        entityType: 'transport_calculation',
        entityId: saved.id,
        requestId,
        details: {
          origin: saved.originLabel,
          destination: saved.destinationLabel,
          distanceKm: saved.outboundDistanceKm,
          totalCostEur: saved.totalCostEur,
          routingProvider: saved.routingProvider,
        },
      });
      return saved;
    },

    list: (opts) => calculationRepository.list(opts),

    async get(id) {
      const record = await calculationRepository.getById(id);
      if (!record) throw new NotFoundError('Saved calculation not found.');
      return record;
    },

    async remove(id, { requestId } = {}) {
      const deleted = await calculationRepository.deleteById(id);
      if (!deleted) throw new NotFoundError('Saved calculation not found.');
      await activityService.record({
        eventType: 'calculation.deleted',
        entityType: 'transport_calculation',
        entityId: id,
        requestId,
      });
      return { id, deleted: true };
    },
  };
}
