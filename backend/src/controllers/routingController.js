export function createRoutingController({ routingService, geocodingService, activityService }) {
  return {
    async route(req, res) {
      const input = req.validated.body;
      try {
        const route = await routingService.getRoute(input);
        await activityService.record({
          eventType: 'route.requested',
          entityType: 'route',
          requestId: req.id,
          details: {
            provider: route.provider.name,
            profile: route.provider.profile,
            includeReturn: input.includeReturn,
            origin: input.origin.label,
            destination: input.destination.label,
            distanceKm: Math.round(route.outbound.distanceKm * 10) / 10,
            cached: route.cached,
            success: true,
          },
        });
        res.json({ data: route });
      } catch (err) {
        await activityService.record({
          eventType: 'route.failed',
          entityType: 'route',
          requestId: req.id,
          details: {
            provider: routingService.describe().name,
            origin: input.origin.label,
            destination: input.destination.label,
            errorCode: err.code ?? 'UNKNOWN',
          },
        });
        throw err;
      }
    },

    async geocode(req, res) {
      const { q, limit } = req.validated.query;
      const results = await geocodingService.search({ query: q, limit });
      res.json({ data: results, meta: { provider: geocodingService.describe().name } });
    },
  };
}
