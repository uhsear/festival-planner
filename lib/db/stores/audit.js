'use strict';

function createAuditStore(pool, _utils) {
  const auditLog = {
    async insert(entry) {
      const id = entry.id || require('crypto').randomUUID();
      const actorType = entry.actor_type || entry.actorType || 'unknown';
      const actorId = entry.actor_id || entry.actorId || null;
      const targetType = entry.target_type || entry.targetType || 'unknown';
      const targetId = entry.target_id || entry.targetId || null;
      let detailsJson = null;
      if (entry.details_json || entry.detailsJson) {
        detailsJson = typeof entry.details_json === 'string' ? entry.details_json : JSON.stringify(entry.details_json || entry.detailsJson);
      }

      const userAgent = entry.user_agent || entry.userAgent || null;
      const requestId = entry.request_id || entry.requestId || null;
      const status = entry.status || 'success';

      await pool.query(`
        INSERT INTO audit_log (id, actor_type, actor_id, action, target_type, target_id, details_json, ip, user_agent, request_id, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      `, [id, actorType, actorId, entry.action, targetType, targetId, detailsJson, entry.ip || null, userAgent, requestId, status]);

      return id;
    },

    async query({ actorId, action, resourceType, from, to, limit = 50, cursor = null } = {}) {
      const maxLimit = 200;
      const finalLimit = Math.min(Math.max(1, limit || 50), maxLimit);

      const params = [
        actorId || null,
        action || null,
        resourceType || null,
        from || null,
        to || null,
        cursor || null,
        finalLimit,
      ];

      const result = await pool.query(`
        SELECT
          id,
          actor_type AS "actorType",
          actor_id AS "actorId",
          action,
          target_type AS "targetType",
          target_id AS "targetId",
          details_json AS "detailsJson",
          ip,
          user_agent AS "userAgent",
          request_id AS "requestId",
          status,
          created_at AS "createdAt"
        FROM audit_log
        WHERE ($1::TEXT IS NULL OR actor_id = $1::TEXT)
          AND ($2::TEXT IS NULL OR action = $2::TEXT)
          AND ($3::TEXT IS NULL OR target_type = $3::TEXT)
          AND ($4::TIMESTAMPTZ IS NULL OR created_at >= $4::TIMESTAMPTZ)
          AND ($5::TIMESTAMPTZ IS NULL OR created_at <= $5::TIMESTAMPTZ)
          AND ($6::TEXT IS NULL OR id < $6::TEXT)
        ORDER BY id DESC
        LIMIT $7
      `, params);

      const rows = result.rows.map((row) => {
        let details = null;
        if (row.detailsJson) {
          if (typeof row.detailsJson === 'object') {
            details = row.detailsJson;
          } else {
            try { details = JSON.parse(row.detailsJson); } catch { details = null; }
          }
        }
        return { ...row, details };
      });

      const nextCursor = rows.length === finalLimit ? rows[rows.length - 1].id : null;

      return { rows, nextCursor };
    },

    async count({ actorId, action, resourceType, from, to } = {}) {
      const params = [
        actorId || null,
        action || null,
        resourceType || null,
        from || null,
        to || null,
      ];

      const result = await pool.query(`
        SELECT COUNT(*) AS total
        FROM audit_log
        WHERE ($1::TEXT IS NULL OR actor_id = $1::TEXT)
          AND ($2::TEXT IS NULL OR action = $2::TEXT)
          AND ($3::TEXT IS NULL OR target_type = $3::TEXT)
          AND ($4::TIMESTAMPTZ IS NULL OR created_at >= $4::TIMESTAMPTZ)
          AND ($5::TIMESTAMPTZ IS NULL OR created_at <= $5::TIMESTAMPTZ)
      `, params);

      return parseInt(result.rows[0]?.total || 0, 10);
    },

    async cleanup(retentionDays = 90) {
      const days = Math.max(1, Math.min(3650, Number.parseInt(retentionDays, 10) || 90));
      const result = await pool.query(
        `DELETE FROM audit_log WHERE created_at < NOW() - make_interval(days => $1)`,
        [days],
      );
      return result.rowCount;
    },
  };

  return auditLog;
}

module.exports = createAuditStore;
