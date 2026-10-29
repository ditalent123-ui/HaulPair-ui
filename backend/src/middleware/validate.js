import { ValidationError } from '../utils/errors.js';
import { formatIssues } from '../validation/schemas.js';

/**
 * Validate req[part] against a zod schema. The parsed (coerced, defaulted)
 * value is stored on req.validated[part]; handlers read only from there.
 */
export function validate(schema, part = 'body') {
  return (req, _res, next) => {
    const source = part === 'body' ? req.body ?? {} : req[part];
    const result = schema.safeParse(source);
    if (!result.success) {
      return next(new ValidationError('Request validation failed.', formatIssues(result.error.issues)));
    }
    req.validated = { ...(req.validated ?? {}), [part]: result.data };
    return next();
  };
}
