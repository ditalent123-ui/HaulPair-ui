/**
 * Application error hierarchy. The central error handler converts these into
 * consistent JSON responses: { error: { code, message, details, requestId } }.
 */
export class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details = undefined, cause = undefined } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status < 500;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed.', details = []) {
    super(message, { status: 400, code: 'VALIDATION_ERROR', details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.') {
    super(message, { status: 404, code: 'NOT_FOUND' });
  }
}

/** A dependency outside our control (routing, geocoding) failed or returned something unusable. */
export class UpstreamError extends AppError {
  constructor(message, { status = 502, code = 'UPSTREAM_ERROR', details, cause } = {}) {
    super(message, { status, code, details, cause });
    // Upstream messages are written by us and safe to show to users.
    this.expose = true;
  }
}

/** The routing provider answered, but no route exists between the points. */
export class NoRouteError extends AppError {
  constructor(message = 'No drivable route was found between the selected locations.') {
    super(message, { status: 422, code: 'NO_ROUTE' });
  }
}

export class DatabaseError extends AppError {
  constructor(message = 'The database is unavailable or rejected the operation.', { cause } = {}) {
    super(message, { status: 503, code: 'DATABASE_ERROR', cause });
    this.expose = true;
  }
}
