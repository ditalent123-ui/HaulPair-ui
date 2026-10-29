/**
 * Route request helpers. A route only needs to be fetched again when inputs
 * that affect it change (points, return trip, vehicle restrictions); cost-only
 * edits re-use the existing signed route.
 */

export function buildRouteRequest(values, { supportsTruckRestrictions }) {
  const vehicle = {};
  if (supportsTruckRestrictions) {
    for (const [k, v] of Object.entries(values.vehicle)) if (v !== null) vehicle[k] = v;
  }
  return {
    origin: values.origin,
    destination: values.destination,
    includeReturn: values.returnMode !== 'none',
    ...(Object.keys(vehicle).length ? { vehicle } : {}),
  };
}

export function routeKey(routeRequest) {
  const p = (l) => `${l.lat.toFixed(5)},${l.lon.toFixed(5)}`;
  return [p(routeRequest.origin), p(routeRequest.destination), routeRequest.includeReturn ? 'R' : '-', JSON.stringify(routeRequest.vehicle ?? {})].join('|');
}

export function buildCalculationBody(values, { routeToken, truckConfigurationId, truckName, label }) {
  const strip = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
  return {
    routeToken,
    ...(label ? { label } : {}),
    truckConfigurationId: truckConfigurationId ?? null,
    truck: strip({ ...values.truck, name: truckName }),
    cargo: strip(values.cargo),
    fuelPriceEurPerL: values.fuelPriceEurPerL,
    returnTrip: strip({ mode: values.returnMode, cargoQuantityT: values.returnMode === 'loaded' ? values.returnCargoQuantityT : null }),
    costs: values.costs,
  };
}
