/**
 * Deterministic haul pricing. No language model is involved in any arithmetic;
 * the only external input is the diesel price (EUR/l) from the diesel price service.
 *
 * Per truck:
 *   loadedKm   = route distance
 *   emptyKm    = route distance × emptyReturnFactor
 *   fuelL      = loadedKm × lPer100(load)/100 + emptyKm × lPer100(empty)/100
 *                where lPer100(load) interpolates linearly between empty and full by load fraction
 *   fuel       = fuelL × dieselEurPerL
 *   distance   = (loadedKm + emptyKm) × vehicleCostEurPerKm
 *   time       = (loadedHours + emptyHours + handlingHours) × vehicleTimeCostEurPerHour
 *   tolls      = (loadedKm + emptyKm) × tollEurPerKm
 *   truckTotal = max(minimumCharge, (fuel + distance + time + tolls) × (1 + margin))
 * Total = Σ truckTotal, rounded UP to whole euros.
 *
 * Driver expenses (wages, per diem, accommodation, any other driver cost) are
 * excluded by design and have no input here.
 */

const round2 = (n) => Math.round(n * 100) / 100;

export function fuelLitresPer100(profile, loadFraction) {
  const f = Math.min(1, Math.max(0, loadFraction));
  return profile.fuelLPer100Km.empty + (profile.fuelLPer100Km.full - profile.fuelLPer100Km.empty) * f;
}

/**
 * @param {object} args
 * @param {{ trucks: Array<{ profileId, loadT, loadFraction }> }} args.plan
 * @param {{ distanceKm: number, durationS: number }} args.route  loaded leg
 * @param {number} args.dieselEurPerL
 * @param {object} args.pricing  backend pricing config
 * @param {(id: string) => object} args.getProfile
 * @param {{ includeVehicleCosts?: boolean, includeMargin?: boolean, applyMinimum?: boolean }} [args.options]
 */
export function priceHaul({ plan, route, dieselEurPerL, pricing, getProfile, options = {} }) {
  const { includeVehicleCosts = true, includeMargin = true, applyMinimum = true } = options;
  if (!(route.distanceKm > 0)) throw new RangeError('route.distanceKm must be positive');
  if (!(dieselEurPerL > 0)) throw new RangeError('dieselEurPerL must be positive');

  const loadedKm = route.distanceKm;
  const emptyKm = route.distanceKm * pricing.emptyReturnFactor;
  const loadedH = (route.durationS ?? 0) / 3600;
  const emptyH = loadedH * pricing.emptyReturnFactor;
  const marginFactor = includeMargin ? 1 + pricing.marginPct / 100 : 1;

  const trucks = plan.trucks.map((t) => {
    const p = getProfile(t.profileId);
    const fuelL = (loadedKm * fuelLitresPer100(p, t.loadFraction)) / 100 + (emptyKm * p.fuelLPer100Km.empty) / 100;
    const fuelEur = fuelL * dieselEurPerL;
    const distanceEur = includeVehicleCosts ? (loadedKm + emptyKm) * p.vehicleCostEurPerKm : 0;
    const timeEur = includeVehicleCosts ? (loadedH + emptyH + pricing.handlingHoursPerTruck) * p.vehicleTimeCostEurPerHour : 0;
    const tollsEur = (loadedKm + emptyKm) * p.tollEurPerKm;
    const costEur = fuelEur + distanceEur + timeEur + tollsEur;
    const withMargin = costEur * marginFactor;
    const totalEur = applyMinimum ? Math.max(pricing.minimumChargeEurPerTruck, withMargin) : withMargin;
    return {
      profileId: t.profileId,
      fuelL: round2(fuelL),
      fuelEur: round2(fuelEur),
      distanceEur: round2(distanceEur),
      timeEur: round2(timeEur),
      tollsEur: round2(tollsEur),
      marginEur: round2(withMargin - costEur),
      totalEur: round2(totalEur),
    };
  });

  const exact = trucks.reduce((s, t) => s + t.totalEur, 0);
  return {
    totalEur: Math.ceil(exact - 1e-9),
    // Internal breakdown — for logs/tests/admin only; never sent to the booking UI.
    breakdown: { loadedKm: round2(loadedKm), emptyKm: round2(emptyKm), dieselEurPerL, marginPct: includeMargin ? pricing.marginPct : 0, trucks },
  };
}
