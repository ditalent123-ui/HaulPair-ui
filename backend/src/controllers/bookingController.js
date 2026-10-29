import { TIME_WINDOWS } from '../services/booking/timeWindows.js';

/**
 * End-user booking API: options, place search, quote, demo order, price
 * tracker, route planner and the demo freight exchange.
 */
export function createBookingController({ catalog, quoteService, plannerService, placeSearch, dieselPrice, marketPrices, truckRouter, activityService }) {
  const record = (req, eventType, details) =>
    activityService.record({ eventType, entityType: 'booking', requestId: req.id, details }).catch(() => {});

  return {
    options(_req, res) {
      res.json({
        data: {
          cargoTypes: catalog.cargoTypes.map((c) => ({ id: c.id, label: c.label.lt })),
          dropoffTypes: Object.fromEntries(Object.entries(catalog.dropoffTypes).map(([k, v]) => [k, v.lt])),
          dropoffs: catalog.dropoffs.map((d) => ({
            id: d.id,
            name: d.name,
            address: d.address,
            type: d.type,
            region: d.region,
            lat: d.lat,
            lon: d.lon,
            demo: d.demo,
          })),
          timeWindows: TIME_WINDOWS.map(({ id, label, todayOnly = false }) => ({ id, label, todayOnly })),
          amount: { minT: 0.1, maxT: 500 },
          routingDemo: truckRouter.describe().demo,
        },
      });
    },

    async places(req, res) {
      const { q, limit } = req.validated.query;
      res.json({ data: await placeSearch.search({ query: q, limit }) });
    },

    async quote(req, res) {
      const input = req.validated.body;
      const data = await quoteService.quote(input);
      await record(req, 'booking.quoted', { cargoType: input.cargoType, amountT: input.amountT, distanceKm: data.route.distanceKm, totalEur: data.totalEur, demoRoute: data.route.demo });
      res.json({ data });
    },

    async createOrder(req, res) {
      const order = await quoteService.createOrder(req.validated.body);
      await record(req, 'booking.ordered', { orderId: order.id, pickupDate: order.pickupDate, window: order.timeWindow.id, totalEur: order.totalEur });
      res.status(201).json({ data: order });
    },

    async prices(_req, res) {
      const diesel = await dieselPrice.getCurrent();
      const history = await dieselPrice.getHistory(diesel);
      res.json({
        data: {
          diesel: { ...diesel, history },
          grain: marketPrices.all(),
          aiManaged: dieselPrice.status().aiManaged,
        },
      });
    },

    async planner(req, res) {
      res.json({ data: await plannerService.compare(req.validated.body) });
    },

    exchange(_req, res) {
      const ex = catalog.exchange;
      res.json({
        data: {
          demo: true,
          updatedAt: ex.updatedAt,
          cargoOffers: ex.cargoOffers.map((o) => ({ ...o, cargoLabel: catalog.getCargo(o.cargoType)?.label.lt ?? o.cargoType })),
          trucks: ex.trucks.map((t) => {
            const p = catalog.getProfile(t.truckType);
            return { ...t, truckLabel: p ? `${p.label.lt} (${p.classLabel.lt})` : t.truckType };
          }),
        },
      });
    },
  };
}
