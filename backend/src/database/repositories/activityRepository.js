import { query } from '../query.js';

export function createActivityRepository(db) {
  return {
    async record({ eventType, entityType = null, entityId = null, requestId = null, details = {} }) {
      await query(
        db,
        `INSERT INTO activity_logs (event_type, entity_type, entity_id, request_id, details)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [eventType, entityType, entityId, requestId, JSON.stringify(details)],
      );
    },

    async list({ limit }) {
      const { rows } = await query(
        db,
        `SELECT id, created_at, event_type, entity_type, entity_id, details
           FROM activity_logs ORDER BY created_at DESC, id DESC LIMIT $1`,
        [limit],
      );
      return rows.map((r) => ({
        id: String(r.id),
        createdAt: r.created_at.toISOString(),
        eventType: r.event_type,
        entityType: r.entity_type,
        entityId: r.entity_id,
        details: r.details,
      }));
    },
  };
}

export function createHealthRepository(db) {
  return {
    async ping() {
      await query(db, 'SELECT 1');
    },
  };
}
