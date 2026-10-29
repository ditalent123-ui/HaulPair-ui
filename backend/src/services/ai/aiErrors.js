import { AppError } from '../../utils/errors.js';

/**
 * Raised when the AI provider is unavailable (auth/quota/upstream/timeout/parse).
 * Provider internals are never surfaced to the client; the message is one we write.
 */
export class AiUnavailableError extends AppError {
  constructor(message = 'AI is currently unavailable.', { code = 'AI_UNAVAILABLE', status = 502, cause } = {}) {
    super(message, { status, code, cause });
    this.expose = true;
  }
}
