import crypto from 'node:crypto';
import { AppError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { openToken, sealToken, SealedTokenError } from '../../utils/sealedToken.js';
import { haversineKm } from '../routing/providers/demoTruck.js';
import { priceHaul } from './pricing.js';
import { resolveWindow } from './timeWindows.js';
import { routingVehicleFor, selectTrucks } from './truckSelection.js';

const DEMO_DRIVERS = ['Tomas (demo)', 'Darius (demo)', 'Rūta (demo)', 'Mindaugas (demo)', 'Aistė (demo)'];
const MIN_ROUTE_KM = 1;

function hashInt(s) {
  return crypto.createHash('sha256').update(s).digest().readUInt32BE(0);
}

/** A point `km` away from `p` at `bearingDeg` (spherical approximation). */
function offsetPoint(p, km, bearingDeg) {
  const R = 6371.0088;
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (p.lat * Math.PI) / 180;
  const lon1 = (p.lon * Math.PI) / 180;
  const d = km / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: Math.round(((lat2 * 180) / Math.PI) * 1e5) / 1e5, lon: Math.round(((lon2 * 180) / Math.PI) * 1e5) / 1e5 };
}

export class QuoteError extends AppError {
  constructor(message, code, status = 400) {
    super(message, { status, code });
    this.expose = true;
  }
}

/**
 * Booking quotes and demo orders.
 *
 * quote(): selects trucks, routes with the truck router, prices deterministically
 * and returns ONLY { total, route for the map, opaque quote token }.
 * createOrder(): opens the quote token, validates the pickup date/window,
 * assigns a demo truck and driver, and returns the order with the approach and
 * delivery route geometry for the live-tracking simulation. Orders are not
 * stored on the server (demo); the browser keeps them.
 */
export function createQuoteService({ catalog, truckRouter, dieselPrice, tokenSecret, logger, now = () => Date.now() }) {
  function resolveDestination(destination) {
    if (destination.dropoffId) {
      const d = catalog.getDropoff(destination.dropoffId);
      if (!d) throw new NotFoundError('The selected drop-off point does not exist.');
      return { lat: d.lat, lon: d.lon, label: d.name, address: d.address, dropoffId: d.id };
    }
    return { lat: destination.lat, lon: destination.lon, label: destination.label, address: null, dropoffId: null };
  }

  async function quote({ pickup, destination, cargoType, amountT }) {
    const cargo = catalog.getCargo(cargoType);
    if (!cargo) throw new ValidationError('Unknown cargo type.', [{ field: 'cargoType', message: 'unknown cargo type' }]);
    const dest = resolveDestination(destination);
    if (haversineKm(pickup, dest) < 0.3) {
      throw new QuoteError('Pickup and destination are the same place.', 'SAME_PLACE', 422);
    }

    let plan;
    try {
      plan = selectTrucks({ fleet: catalog.fleet, cargo, amountT });
    } catch (err) {
      if (err.code === 'TOO_MANY_TRUCKS') throw new QuoteError(err.message, 'TOO_MANY_TRUCKS', 422);
      throw err;
    }
    const vehicle = routingVehicleFor(plan, catalog.getProfile);
    const route = await truckRouter.route({ origin: pickup, destination: dest, vehicle });
    if (route.distanceKm < MIN_ROUTE_KM) throw new QuoteError('The route is too short to price.', 'ROUTE_TOO_SHORT', 422);

    const diesel = await dieselPrice.getCurrent();
    const priced = priceHaul({ plan, route, dieselEurPerL: diesel.eurPerL, pricing: catalog.pricing, getProfile: catalog.getProfile });
    logger?.info({ quote: { cargoType, amountT, trucks: plan.truckCount, profile: plan.trucks[0].profileId, distanceKm: route.distanceKm, totalEur: priced.totalEur, dieselMethod: diesel.method } }, 'Quote priced');

    const { token, expiresAt } = sealToken(
      {
        k: 'quote',
        pickup: { lat: pickup.lat, lon: pickup.lon, label: pickup.label },
        destination: dest,
        cargoType,
        amountT,
        plan: { truckCount: plan.truckCount, profileId: plan.trucks[0].profileId, loadT: plan.trucks[0].loadT },
        vehicle,
        totalEur: priced.totalEur,
        route: { distanceKm: route.distanceKm, durationS: route.durationS, demo: route.demo },
        diesel: { eurPerL: diesel.eurPerL, method: diesel.method, demo: diesel.demo },
      },
      tokenSecret,
      { ttlS: catalog.pricing.quoteTtlMinutes * 60, now: now() },
    );

    // Minimal user-facing response: the final total and what the map needs. Nothing technical.
    return {
      quoteToken: token,
      expiresAt,
      totalEur: priced.totalEur,
      currency: 'EUR',
      route: {
        geometry: route.geometry,
        distanceKm: route.distanceKm,
        durationMin: Math.round(route.durationS / 60),
        demo: route.demo,
        attribution: route.attribution,
      },
      pickup: { lat: pickup.lat, lon: pickup.lon, label: pickup.label },
      destination: { lat: dest.lat, lon: dest.lon, label: dest.label },
    };
  }

  async function createOrder({ quoteToken, pickupDate, timeWindow, asCompany = false }) {
    let q;
    try {
      q = openToken(quoteToken, tokenSecret, { now: now() });
    } catch (err) {
      if (err instanceof SealedTokenError) throw new QuoteError(err.message, err.reason === 'expired' ? 'QUOTE_EXPIRED' : 'QUOTE_INVALID', 400);
      throw err;
    }
    if (q.k !== 'quote') throw new QuoteError('The quote is invalid.', 'QUOTE_INVALID');

    const w = resolveWindow({ date: pickupDate, windowId: timeWindow, now: now() });
    if (w.error) throw new QuoteError('The pickup date or time window cannot be booked.', w.error, 400);

    const id = `HP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const profile = catalog.getProfile(q.plan.profileId);
    const seed = hashInt(id);
    const plate = profile.demoPlates[seed % profile.demoPlates.length];
    const driver = DEMO_DRIVERS[seed % DEMO_DRIVERS.length];

    // The demo truck starts 5–11 km from the pickup and drives there along a truck route.
    const start = offsetPoint(q.pickup, 5 + (seed % 7), seed % 360);
    const [approach, delivery] = await Promise.all([
      truckRouter.route({ origin: start, destination: q.pickup, vehicle: q.vehicle }),
      truckRouter.route({ origin: q.pickup, destination: q.destination, vehicle: q.vehicle }),
    ]);

    // Dispatch so the truck reaches the pickup at the window start (or straight away for ASAP).
    const dispatchAt = w.asap ? now() + 8_000 : Math.max(now() + 8_000, w.startAt - approach.durationS * 1000);
    const cargo = catalog.getCargo(q.cargoType);

    return {
      id,
      demo: true,
      createdAt: new Date(now()).toISOString(),
      pickupDate,
      timeWindow: { id: w.window.id, label: w.window.label, startAt: new Date(w.startAt).toISOString(), endAt: new Date(w.endAt).toISOString(), asap: w.asap },
      dispatchAt: new Date(dispatchAt).toISOString(),
      carrier: 'Linas Agro (demo)',
      truck: { type: profile.label.lt, classLabel: profile.classLabel.lt, plate, count: q.plan.truckCount },
      driver: { name: driver },
      cargo: { type: q.cargoType, label: cargo?.label.lt ?? q.cargoType, amountT: q.amountT },
      from: q.pickup,
      to: { lat: q.destination.lat, lon: q.destination.lon, label: q.destination.label },
      totalEur: q.totalEur,
      invoiceToCompany: Boolean(asCompany),
      legs: {
        approach: { geometry: approach.geometry, distanceKm: approach.distanceKm, durationS: approach.durationS, demo: approach.demo },
        delivery: { geometry: delivery.geometry, distanceKm: delivery.distanceKm, durationS: delivery.durationS, demo: delivery.demo },
      },
    };
  }

  return { quote, createOrder };
}
