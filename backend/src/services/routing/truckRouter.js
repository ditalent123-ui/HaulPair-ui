import { NoRouteError, UpstreamError } from '../../utils/errors.js';
import { TtlCache } from '../../utils/ttlCache.js';
import { createDemoTruckProvider } from './providers/demoTruck.js';
import { createOpenRouteServiceProvider } from './providers/openrouteservice.js';

/**
 * Truck router for the booking flow and the price planner.
 *
 * - With ORS_API_KEY: openrouteservice "driving-hgv" with the selected truck's
 *   weight, height, width, length and axle-load restrictions.
 * - Without a key: the clearly labelled DEMO route (demo=true).
 * - If the real truck router is unreachable or over quota, it falls back to the
 *   DEMO route (labelled, with fallbackReason) so the app keeps working. A
 *   genuine "no truck route exists" answer is NOT masked: it is reported.
 */
export function createTruckRouter({ mode = 'auto', orsBaseUrl, orsApiKey, requestJson, demoOptions, logger, quota, realProvider, cacheTtlMs = 30 * 60_000 }) {
  const demo = createDemoTruckProvider(demoOptions);
  const useOrs = mode === 'openrouteservice' || (mode === 'auto' && Boolean(orsApiKey));
  // realProvider lets tests inject a fake HGV provider without network access.
  const real = realProvider ?? (useOrs && mode !== 'demo' ? createOpenRouteServiceProvider({ baseUrl: orsBaseUrl, apiKey: orsApiKey, requestJson }) : null);
  const cache = new TtlCache({ ttlMs: cacheTtlMs, maxEntries: 500 });

  function toResult(raw, provider, extra = {}) {
    return {
      distanceKm: Math.round((raw.distanceM / 1000) * 10) / 10,
      durationS: Math.round(raw.durationS ?? ((raw.distanceM / 1000) / 62) * 3600),
      geometry: raw.coordinates.map(([lon, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]),
      demo: Boolean(provider.demo),
      provider: provider.name,
      truckRestrictionsApplied: provider.supportsTruckRestrictions,
      attribution: provider.attribution,
      ...extra,
    };
  }

  async function route({ origin, destination, vehicle = {} }) {
    const key = [origin.lat.toFixed(5), origin.lon.toFixed(5), destination.lat.toFixed(5), destination.lon.toFixed(5), JSON.stringify(vehicle)].join('|');
    const hit = cache.get(key);
    if (hit) return hit;
    let result;
    if (real) {
      let release = () => {};
      try {
        // Shared daily/concurrency ceiling for paid/limited provider calls.
        release = quota ? quota.reserve('truck-routing') : release;
        result = toResult(await real.route({ origin, destination, vehicle }), real);
      } catch (err) {
        if (err instanceof NoRouteError) throw err;
        if (!(err instanceof UpstreamError) && err?.code !== 'EXTERNAL_LIMIT') throw err;
        logger?.warn({ err: { code: err.code, message: err.message } }, 'Truck router unavailable; using DEMO route');
        result = toResult(await demo.route({ origin, destination }), demo, { fallbackReason: err.code ?? 'UPSTREAM_ERROR' });
      } finally {
        release();
      }
    } else {
      result = toResult(await demo.route({ origin, destination }), demo);
    }
    cache.set(key, result);
    return result;
  }

  return {
    route,
    describe: () => ({
      provider: real ? real.name : demo.name,
      profile: real ? real.profile : demo.profile,
      demo: !real,
      truckRestrictions: Boolean(real),
    }),
  };
}
