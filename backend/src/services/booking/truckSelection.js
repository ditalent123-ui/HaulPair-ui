/**
 * Automatic truck selection.
 *
 * A truck's usable capacity for a cargo is limited by BOTH weight and volume:
 *   capacityT = min(payloadT, cargoVolumeM3 × planningDensityTPerM3)
 * The smallest profile (fleet is ordered small → large) whose capacity fits the
 * whole load is chosen. If no single truck fits, the load is split into the
 * fewest trucks possible (n = ceil(load / largest capacity)), shared equally, and
 * each share gets the smallest profile that fits it.
 */

const EPS = 1e-9;

export function capacityFor(profile, cargo) {
  const byVolume = profile.cargoVolumeM3 * cargo.planningDensityTPerM3;
  const capacityT = Math.min(profile.payloadT, byVolume);
  return { capacityT, limitedBy: byVolume < profile.payloadT ? 'volume' : 'weight' };
}

function smallestFitting(fleet, cargo, loadT) {
  return fleet.find((p) => capacityFor(p, cargo).capacityT + EPS >= loadT) ?? null;
}

/**
 * @returns {{ trucks: Array<{ profileId, loadT, capacityT, loadFraction, limitedBy }>, truckCount, totalLoadT }}
 */
export function selectTrucks({ fleet, cargo, amountT, maxTrucks = 30 }) {
  if (!(amountT > 0) || !Number.isFinite(amountT)) throw new RangeError('amountT must be a positive number');
  const largest = fleet[fleet.length - 1];
  const largestCap = capacityFor(largest, cargo).capacityT;

  const truckCount = Math.max(1, Math.ceil(amountT / largestCap - EPS));
  if (truckCount > maxTrucks) {
    const err = new RangeError(`The load needs ${truckCount} trucks; the maximum per order is ${maxTrucks}.`);
    err.code = 'TOO_MANY_TRUCKS';
    throw err;
  }
  const share = amountT / truckCount;
  const profile = smallestFitting(fleet, cargo, share) ?? largest;
  const { capacityT, limitedBy } = capacityFor(profile, cargo);
  const trucks = Array.from({ length: truckCount }, () => ({
    profileId: profile.id,
    loadT: Math.round(share * 1000) / 1000,
    capacityT: Math.round(capacityT * 1000) / 1000,
    loadFraction: Math.min(1, share / capacityT),
    limitedBy,
  }));
  return { trucks, truckCount, totalLoadT: amountT };
}

/** The most restrictive vehicle in a plan drives the routing restrictions (all trucks share one route). */
export function routingVehicleFor(plan, getProfile) {
  const profiles = plan.trucks.map((t) => getProfile(t.profileId));
  const pick = (k) => Math.max(...profiles.map((p) => p[k]));
  return { grossWeightT: pick('grossWeightT'), heightM: pick('heightM'), widthM: pick('widthM'), lengthM: pick('lengthM'), axleLoadT: pick('axleLoadT') };
}
