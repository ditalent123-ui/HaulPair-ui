import { DIESEL_SANITY_EUR_PER_L } from '../ai/dieselPriceAi.js';

/**
 * Current Lithuanian diesel price for pricing and the price tracker.
 *
 * Source chain (each behind this one adapter, with cache and fallback):
 *   1. Shared store (fuel_prices) — the last known GOOD value: an admin LEA
 *      import or a validated AI result. Shared by all visitors.
 *   2. AI refresh (Gemini + Google Search) when AI is ready and the stored
 *      value is older than refreshHours. Validated, then written to the store
 *      with a timestamp and to history. A failed refresh never replaces the
 *      last known good value.
 *   3. Seeded DEMO value (labelled demo) when nothing is stored yet or the
 *      database cannot be read.
 */
export function createDieselPriceService({
  fuelPriceRepository,
  dieselAi = null,
  demoSeed,
  refreshHours = 12,
  retryCooldownMinutes = 30,
  cacheTtlMs = 60_000,
  logger,
  now = () => Date.now(),
}) {
  let cached = null;
  let cachedAt = 0;
  let inflight = null;
  let lastAttemptAt = 0;
  let lastError = null;

  const demoValue = () => ({
    eurPerL: demoSeed.eurPerL,
    sourceName: demoSeed.sourceName,
    sourceUrl: null,
    priceDate: demoSeed.updatedAt.slice(0, 10),
    updatedAt: new Date(demoSeed.updatedAt).toISOString(),
    method: 'demo_seed',
    demo: true,
  });

  const fromRecord = (r) => ({
    eurPerL: Number(r.priceEurPerL),
    sourceName: r.sourceName,
    sourceUrl: r.sourceUrl,
    priceDate: r.priceDate,
    updatedAt: r.updatedAt,
    method: r.method,
    demo: false,
  });

  async function readStore() {
    try {
      const rec = await fuelPriceRepository.get('diesel');
      if (!rec) return null;
      const v = fromRecord(rec);
      const { min, max } = DIESEL_SANITY_EUR_PER_L;
      return v.eurPerL >= min && v.eurPerL <= max ? v : null;
    } catch (err) {
      logger?.warn({ err: { message: err.message } }, 'Diesel price store unavailable; using fallback');
      return null;
    }
  }

  async function refreshWithAi() {
    lastAttemptAt = now();
    try {
      const r = await dieselAi.fetchCurrent();
      const saved = await fuelPriceRepository.upsert({
        fuelType: 'diesel',
        priceEurPerL: r.eurPerL,
        priceDate: r.priceDate,
        geography: 'LT',
        priceBasis: r.kind === 'estimate' ? 'AI estimate, Lithuania retail average, VAT incl.' : 'Lithuania retail average, VAT incl. (AI-sourced)',
        sourceName: r.sourceName,
        sourceUrl: r.sourceUrl,
        method: 'ai_assisted',
      });
      lastError = null;
      return fromRecord(saved);
    } catch (err) {
      lastError = err.code ?? 'AI_ERROR';
      logger?.warn({ err: { code: err.code, message: err.message } }, 'AI diesel refresh failed; keeping last known good value');
      return null;
    }
  }

  async function compute() {
    const stored = await readStore();
    const ageH = stored ? (now() - Date.parse(stored.updatedAt)) / 3_600_000 : Infinity;
    const due = ageH > refreshHours && now() - lastAttemptAt > retryCooldownMinutes * 60_000;
    if (dieselAi && due) {
      const fresh = await refreshWithAi();
      if (fresh) return fresh;
    }
    return stored ?? demoValue();
  }

  return {
    /** { eurPerL, sourceName, sourceUrl, priceDate, updatedAt, method, demo } */
    async getCurrent() {
      if (cached && now() - cachedAt < cacheTtlMs) return cached;
      inflight ??= compute().finally(() => {
        inflight = null;
      });
      cached = await inflight;
      cachedAt = now();
      return cached;
    },

    /** Weekly/recorded history for the trend chart. Demo seed history when the value is demo. */
    async getHistory(current) {
      if (current.demo) return demoSeed.history.map((h) => ({ date: h.date, eurPerL: h.value }));
      try {
        const rows = (await fuelPriceRepository.listHistory?.('diesel', 30)) ?? [];
        return rows.map((r) => ({ date: r.priceDate, eurPerL: Number(r.priceEurPerL) }));
      } catch {
        return [];
      }
    },

    status: () => ({ aiManaged: Boolean(dieselAi), lastError, refreshHours }),
    invalidate() {
      cached = null;
    },
  };
}
