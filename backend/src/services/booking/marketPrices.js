/**
 * Grain purchase prices at drop-off points, behind one adapter with a fallback.
 *
 * No free, legitimate machine-readable source of per-site Lithuanian grain
 * purchase prices was identified, so the only adapter today serves the seeded
 * DEMO data (labelled demo, with its timestamp). A real adapter (e.g. a buyer's
 * price feed under contract) can be added to `adapters` ahead of the demo one;
 * the first adapter that returns a price wins, the demo seed is the fallback.
 */
export function createMarketPrices({ catalog, adapters = [] }) {
  const seed = catalog.market.grain;
  const demoAdapter = {
    name: 'demo_seed',
    pricesFor(cargoType) {
      const out = [];
      for (const entry of seed.points) {
        const point = catalog.getDropoff(entry.dropoffId);
        const p = entry.prices.find((x) => x.cargoType === cargoType);
        if (point && p) out.push({ point, eurPerT: p.eurPerT, history: p.history, sourceName: seed.sourceName, updatedAt: seed.updatedAt, demo: true });
      }
      return out;
    },
  };
  const chain = [...adapters, demoAdapter];

  return {
    pricesFor(cargoType) {
      for (const a of chain) {
        const r = a.pricesFor(cargoType);
        if (r.length) return r;
      }
      return [];
    },
    /** All points with all their prices (for the tracker table). */
    all() {
      return seed.points.map((entry) => {
        const point = catalog.getDropoff(entry.dropoffId);
        return {
          dropoffId: entry.dropoffId,
          name: point?.name ?? entry.dropoffId,
          type: point?.type,
          region: point?.region,
          prices: entry.prices.map((p) => ({
            cargoType: p.cargoType,
            label: catalog.getCargo(p.cargoType)?.label.lt ?? p.cargoType,
            eurPerT: p.eurPerT,
            history: p.history,
            sourceName: seed.sourceName,
            updatedAt: seed.updatedAt,
            demo: true,
          })),
        };
      });
    },
  };
}
