/**
 * DEMO route provider — used when no truck-routing API key is configured (or the
 * truck router cannot be reached). It does NOT follow real roads: it draws a
 * gently curved line between the two points, and estimates the road distance as
 * straight-line distance × roadFactor and the duration from an average truck
 * speed. Every result is flagged demo=true and labelled in the UI.
 */

const R_KM = 6371.0088;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function createDemoTruckProvider({ roadFactor = 1.25, averageSpeedKmh = 62, samples = 48 } = {}) {
  return {
    name: 'demo',
    displayName: 'DEMO maršrutas',
    profile: 'demo-truck',
    profileDescription: 'demo line, not real roads',
    supportsTruckRestrictions: false,
    demo: true,
    attribution: 'DEMO maršrutas — ne tikri keliai',

    async route({ origin, destination }) {
      const chordKm = haversineKm(origin, destination);
      const distanceKm = Math.max(0.2, chordKm * roadFactor);
      // Quadratic Bézier with the control point offset perpendicular to the chord (~6 % of its length).
      const midLat = (origin.lat + destination.lat) / 2;
      const midLon = (origin.lon + destination.lon) / 2;
      const kx = Math.cos(toRad(midLat)); // lon degrees are shorter by cos(lat)
      const dx = (destination.lon - origin.lon) * kx;
      const dy = destination.lat - origin.lat;
      const ctrl = { lat: midLat + dx * 0.12, lon: midLon - (dy * 0.12) / kx };
      const coordinates = [];
      for (let i = 0; i <= samples; i += 1) {
        const t = i / samples;
        const lat = (1 - t) ** 2 * origin.lat + 2 * (1 - t) * t * ctrl.lat + t ** 2 * destination.lat;
        const lon = (1 - t) ** 2 * origin.lon + 2 * (1 - t) * t * ctrl.lon + t ** 2 * destination.lon;
        coordinates.push([lon, lat]);
      }
      return { distanceM: distanceKm * 1000, durationS: (distanceKm / averageSpeedKmh) * 3600, coordinates };
    },
  };
}
