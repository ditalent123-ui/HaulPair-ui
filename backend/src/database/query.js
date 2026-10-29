import { DatabaseError } from '../utils/errors.js';

/**
 * Run a parameterised query and translate driver failures into DatabaseError,
 * so callers never leak driver internals to API clients.
 * Always use $1..$n placeholders; never interpolate values into SQL text.
 */
export async function query(db, text, params = []) {
  try {
    return await db.query(text, params);
  } catch (err) {
    throw new DatabaseError(undefined, { cause: err });
  }
}
