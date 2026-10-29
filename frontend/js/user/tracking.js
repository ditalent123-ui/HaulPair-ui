/**
 * Live truck tracking.
 *
 * PositionProvider interface (what the order page depends on):
 *   subscribe(listener) -> unsubscribe     listener(state) is called every tick
 *   start() / stop()
 *   setSpeed(multiplier)                   demo-only control; a real feed ignores it
 *   state: { phase, lat, lon, etaS, legKmLeft, simNow }
 *   phase: 'ordered' | 'scheduled' | 'assigned' | 'en_route' | 'arrived' | 'loaded' | 'delivered'
 *
 * createSimulatedPositionProvider() is the DEMO implementation: it interpolates
 * the truck along the real route polylines (approach → pickup, then pickup →
 * destination) at the speed implied by each leg's routed duration, i.e. a
 * realistic truck speed. A telematics feed can replace it by implementing the
 * same interface (e.g. polling a GPS endpoint) without touching the UI.
 */

const R_KM = 6371.0088;
const toRad = (d) => (d * Math.PI) / 180;
function distKm(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Precompute cumulative lengths so a fraction of the leg maps to a point. */
export function preparePolyline(geometry) {
  const cum = [0];
  for (let i = 1; i < geometry.length; i += 1) cum.push(cum[i - 1] + distKm(geometry[i - 1], geometry[i]));
  return { geometry, cum, length: cum[cum.length - 1] || 1e-9 };
}

export function pointAt(poly, fraction) {
  const f = Math.min(1, Math.max(0, fraction));
  const target = f * poly.length;
  let i = 1;
  while (i < poly.cum.length - 1 && poly.cum[i] < target) i += 1;
  const segLen = poly.cum[i] - poly.cum[i - 1] || 1e-9;
  const t = Math.min(1, Math.max(0, (target - poly.cum[i - 1]) / segLen));
  const [aLat, aLon] = poly.geometry[i - 1];
  const [bLat, bLon] = poly.geometry[i];
  return [aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t];
}

const ASSIGN_AFTER_MS = 4000;
const SCHEDULED_THRESHOLD_MS = 2 * 60_000;

/**
 * Pure state function (tested in Node). `sim` holds the demo clock anchor:
 * simNow = anchorSim + (realNow - anchorReal) × multiplier.
 */
export function computeState(order, realNow, polys) {
  const sim = order.sim ?? { anchorReal: Date.parse(order.createdAt), anchorSim: Date.parse(order.createdAt), multiplier: 1 };
  const m = sim.multiplier || 1;
  const simNow = sim.anchorSim + (realNow - sim.anchorReal) * m;
  const created = Date.parse(order.createdAt);
  const dispatch = Date.parse(order.dispatchAt);
  const approachMs = order.legs.approach.durationS * 1000;
  const deliveryMs = order.legs.delivery.durationS * 1000;
  const arriveAt = dispatch + approachMs;
  const [pLat, pLon] = [order.from.lat, order.from.lon];
  const toReal = (simMs) => simMs / m / 1000; // remaining sim ms → real seconds

  if (simNow < dispatch) {
    const scheduled = dispatch - created > SCHEDULED_THRESHOLD_MS;
    const start = order.legs.approach.geometry[0];
    return {
      phase: scheduled ? 'scheduled' : simNow - created < ASSIGN_AFTER_MS ? 'ordered' : 'assigned',
      lat: start[0], lon: start[1], simNow,
      // Countdown to the truck reaching the pickup point.
      etaS: (arriveAt - simNow) / 1000,
      legKmLeft: order.legs.approach.distanceKm,
    };
  }
  if (simNow < arriveAt) {
    const f = (simNow - dispatch) / approachMs;
    const [lat, lon] = pointAt(polys.approach, f);
    return { phase: 'en_route', lat, lon, simNow, etaS: toReal(arriveAt - simNow), legKmLeft: order.legs.approach.distanceKm * (1 - f) };
  }
  if (!order.loadedAt) {
    return { phase: 'arrived', lat: pLat, lon: pLon, simNow, etaS: 0, legKmLeft: 0 };
  }
  const loaded = Date.parse(order.loadedAt);
  const deliveredAt = loaded + deliveryMs;
  if (simNow < deliveredAt) {
    const f = (simNow - loaded) / deliveryMs;
    const [lat, lon] = pointAt(polys.delivery, f);
    return { phase: 'loaded', lat, lon, simNow, etaS: toReal(deliveredAt - simNow), legKmLeft: order.legs.delivery.distanceKm * (1 - f) };
  }
  return { phase: 'delivered', lat: order.to.lat, lon: order.to.lon, simNow, etaS: 0, legKmLeft: 0 };
}

export function createSimulatedPositionProvider(order, { tickMs = 1500, now = () => Date.now(), onOrderChange = () => {} } = {}) {
  const polys = { approach: preparePolyline(order.legs.approach.geometry), delivery: preparePolyline(order.legs.delivery.geometry) };
  const listeners = new Set();
  let timer = null;
  let current = null;

  function tick() {
    current = computeState(order, now(), polys);
    for (const l of listeners) l(current);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (current) listener(current);
      return () => listeners.delete(listener);
    },
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, tickMs);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    /** Demo time acceleration: re-anchors the simulated clock so the truck does not jump. */
    setSpeed(multiplier) {
      const s = computeState(order, now(), polys);
      order.sim = { anchorReal: now(), anchorSim: s.simNow, multiplier };
      onOrderChange(order);
      tick();
    },
    /** Called when the user confirms loading (the truck then leaves for the destination). */
    confirmLoaded() {
      const s = computeState(order, now(), polys);
      if (s.phase !== 'arrived') return;
      order.loadedAt = new Date(s.simNow).toISOString();
      onOrderChange(order);
      tick();
    },
    get state() {
      return current;
    },
  };
}
