import { LogisticsValidationError } from '../lib/logistics/types.js';
import { AppError } from '../utils/errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No API endpoint ${req.method} ${req.path}.`, requestId: req.id },
  });
}

/** Central error handler: every error leaves the API in the same JSON shape. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred.';
  let details;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    if (err.expose) message = err.message;
    details = err.details;
  } else if (err instanceof LogisticsValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed.';
    details = err.problems.map((p) => ({ field: p.field, message: p.message, code: p.code }));
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'The request body is not valid JSON.';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'The request body is too large.';
  } else if (err?.type === 'encoding.unsupported' || err?.status === 415) {
    status = 415;
    code = 'UNSUPPORTED_MEDIA_TYPE';
    message = 'Unsupported request encoding.';
  }

  const logPayload = {
    err: {
      type: err?.name,
      code,
      message: err?.message,
      cause: err?.cause ? { message: err.cause.message, code: err.cause.code } : undefined,
      stack: status >= 500 ? err?.stack : undefined,
    },
    status,
  };
  if (status >= 500) req.log?.error(logPayload, 'Request failed');
  else req.log?.info(logPayload, 'Request rejected');

  res.status(status).json({ error: { code, message, details, requestId: req.id } });
}
