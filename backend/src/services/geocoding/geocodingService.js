import { TtlCache } from '../../utils/ttlCache.js';
import { createPhotonProvider } from './providers/photon.js';
import { createOrsGeocodingProvider } from './providers/openrouteservice.js';

// Geographic centre of Lithuania, used to bias results towards Lithuanian places.
export const LITHUANIA_BIAS = Object.freeze({ lat: 55.17, lon: 23.88 });

export function createGeocodingProvider(geocodingConfig, requestJson) {
  switch (geocodingConfig.provider) {
    case 'photon':
      return createPhotonProvider({ baseUrl: geocodingConfig.photonBaseUrl, requestJson });
    case 'openrouteservice':
      return createOrsGeocodingProvider({
        baseUrl: geocodingConfig.orsBaseUrl,
        apiKey: geocodingConfig.orsApiKey,
        requestJson,
      });
    default:
      throw new Error(`Unknown geocoding provider: ${geocodingConfig.provider}`);
  }
}

/**
 * Provider-agnostic geocoding with a short-lived cache, so that repeated
 * keystrokes and popular queries ("Klaipėda") do not hit the provider each time.
 */
export function createGeocodingService({ provider, cacheTtlMs = 10 * 60_000 }) {
  const cache = new TtlCache({ ttlMs: cacheTtlMs, maxEntries: 1000 });

  async function search({ query, limit = 6 }) {
    const normalized = query.trim().replace(/\s+/g, ' ');
    const key = `${provider.name}|${limit}|${normalized.toLocaleLowerCase('lt')}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const results = await provider.search({ query: normalized, limit, bias: LITHUANIA_BIAS });
    cache.set(key, results);
    return results;
  }

  return {
    search,
    describe: () => ({
      name: provider.name,
      supportsAutocomplete: provider.supportsAutocomplete,
      attribution: provider.attribution,
    }),
  };
}
