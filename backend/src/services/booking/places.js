/**
 * Location search for the booking flow: the configured geocoder first, and an
 * offline list of Lithuanian towns (approximate centre points, labelled demo)
 * when the geocoder cannot be reached — so the app still runs without network
 * access or keys.
 */
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('lt');

export function createPlaceSearch({ geocodingService, catalog, logger, quota }) {
  function offline(q, limit) {
    const f = fold(q);
    return catalog.places
      .filter((p) => fold(p.name).includes(f))
      .sort((a, b) => fold(a.name).indexOf(f) - fold(b.name).indexOf(f) || a.name.localeCompare(b.name, 'lt'))
      .slice(0, limit)
      .map((p) => ({ label: p.name, sub: 'Apytikslis miesto centras', lat: p.lat, lon: p.lon, demo: true }));
  }

  return {
    async search({ query, limit = 6 }) {
      const q = query.trim();
      if (geocodingService) {
        let release = () => {};
        try {
          release = quota ? quota.reserve('geocoding') : release;
          const results = await geocodingService.search({ query: q, limit });
          const lt = results.filter((r) => !r.countryCode || r.countryCode === 'LT');
          if (lt.length) {
            return { source: 'geocoder', results: lt.slice(0, limit).map((r) => ({ label: r.name ?? r.label, sub: r.label, lat: r.lat, lon: r.lon, demo: false })) };
          }
        } catch (err) {
          logger?.warn({ err: { code: err.code, message: err.message } }, 'Geocoder unavailable; using offline place list');
        } finally {
          release();
        }
      }
      return { source: 'offline_demo', results: offline(q, limit) };
    },
  };
}
