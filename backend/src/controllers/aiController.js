import { ValidationError } from '../utils/errors.js';

/**
 * AI "describe shipment" endpoint. Returns a structured SUGGESTION only; the
 * browser shows it for review and the user explicitly applies it to the form.
 * Nothing is calculated or saved here. Provider failures are normalised to
 * stable app error codes by the service/client — no raw provider output leaks.
 */
export function createAiController({ shipmentAiService, activityService, maxInputChars }) {
  return {
    async parseShipment(req, res) {
      const { text } = req.validated.body;
      if (text.length > maxInputChars) {
        throw new ValidationError('The description is too long.', [
          { field: 'text', message: `Keep the description under ${maxInputChars} characters.` },
        ]);
      }
      const result = await shipmentAiService.parse({ text });
      // Log only minimal usage counters — never the shipment text or any secret.
      await activityService.record({
        eventType: 'ai.parse_shipment',
        entityType: 'ai',
        requestId: req.id,
        details: { missingCount: result.missing.length, inputChars: text.length },
      });
      res.json({ data: result });
    },
  };
}
