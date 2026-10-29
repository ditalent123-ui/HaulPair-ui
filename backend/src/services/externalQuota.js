import { AppError } from '../utils/errors.js';

/**
 * Shared ceiling for outbound calls to paid/limited providers (routing,
 * geocoding, AI), applied on top of the per-IP rate limits. It bounds total
 * daily cost and concurrent load regardless of how many clients call.
 *
 * LIMITATION: this is an in-process counter. With several processes/instances
 * each has its own counter, so the effective cap is (processes × limit), and a
 * restart clears it. For a single Render instance this is adequate; a
 * multi-instance deployment needs a shared store (e.g. Redis) or a provider-side
 * cap. This limitation is documented for the owner rather than hidden.
 */
export class ExternalLimitError extends AppError {
  constructor(message) {
    super(message, { status: 503, code: 'EXTERNAL_LIMIT' });
    this.expose = true;
  }
}

export function createExternalQuota({ dailyMax, maxConcurrent, now = () => Date.now() } = {}) {
  let day = utcDay(now());
  let used = 0;
  let inFlight = 0;

  function utcDay(ts) {
    return new Date(ts).toISOString().slice(0, 10);
  }
  function rollover() {
    const d = utcDay(now());
    if (d !== day) {
      day = d;
      used = 0;
    }
  }

  /**
   * Reserve one slot. Returns a release() function. Throws ExternalLimitError
   * when the daily cap is reached or too many calls are in flight. The daily
   * counter is incremented on reservation (not on success) so failures still
   * count toward the cost ceiling.
   */
  function reserve(label = 'provider') {
    rollover();
    if (used >= dailyMax) {
      throw new ExternalLimitError(
        `The shared daily limit for external ${label} requests has been reached. Try again tomorrow or raise EXTERNAL_DAILY_MAX.`,
      );
    }
    if (inFlight >= maxConcurrent) {
      throw new ExternalLimitError('The service is busy with other external requests. Please retry in a moment.');
    }
    used += 1;
    inFlight += 1;
    let released = false;
    return function release() {
      if (released) return;
      released = true;
      inFlight = Math.max(0, inFlight - 1);
    };
  }

  /** Express middleware: reserve before an expensive handler, release when the response finishes. */
  function middleware(label) {
    return (req, res, next) => {
      let release;
      try {
        release = reserve(label);
      } catch (err) {
        return next(err);
      }
      res.on('finish', release);
      res.on('close', release);
      next();
    };
  }

  function snapshot() {
    rollover();
    return { day, used, dailyMax, inFlight, maxConcurrent };
  }

  return { reserve, middleware, snapshot };
}
