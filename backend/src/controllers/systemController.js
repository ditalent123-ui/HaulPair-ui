export function createSystemController({ config, healthRepository, routingService, geocodingService, version, startedAt }) {
  return {
    /**
     * Public health check. Deliberately minimal — no version, uptime, data or
     * configuration — because it is the one endpoint reachable without auth.
     */
    async health(req, res) {
      let ok = true;
      try {
        await healthRepository.ping();
      } catch (err) {
        ok = false;
        req.log.warn({ err: { message: err.message } }, 'Health check: database unavailable');
      }
      res.status(ok ? 200 : 503).json({ data: { status: ok ? 'ok' : 'degraded' } });
    },

    /**
     * Non-secret configuration for the browser. Behind access protection.
     * Never include API keys, credit balances or billing details here.
     */
    publicConfig(_req, res) {
      res.json({
        data: {
          appName: 'HaulPair',
          version,
          environment: config.env,
          uptimeS: Math.round((Date.now() - startedAt) / 1000),
          accessProtection: config.auth.enabled,
          currency: 'EUR',
          map: {
            tileUrl: config.map.tileUrl,
            attribution: config.map.tileAttribution,
            maxZoom: config.map.maxZoom,
            defaultCenter: [55.17, 23.88],
            defaultZoom: 7,
          },
          routing: routingService.describe(),
          geocoding: geocodingService.describe(),
          ai: {
            available: config.ai.ready,
            disabledReason: config.ai.ready ? null : config.ai.disabledReason,
            maxInputChars: config.ai.maxInputChars,
          },
          fuelPrice: {
            // Suggestion source is not yet connected; manual entry is always available.
            suggestionAvailable: false,
          },
        },
      });
    },
  };
}
