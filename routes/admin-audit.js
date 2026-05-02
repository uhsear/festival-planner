// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
/**
 * Admin audit-log query routes
 * Extracted from routes/admin.js during the 2026-04-14 file-size split.
 * Mounts: /audit
 */
module.exports = function mountAdminAuditRoutes({ router, deps }) {
  const {
    log,
    setNoStore,
    sendSuccess, sendError, ErrorCodes,
    adminAuth,
    stores,
  } = deps;

  // ── GET /audit — query audit log with filters ────────────
  router.get('/audit', adminAuth, async (req, res) => {
    try {
      setNoStore(res);
      const actorId = req.query.actor_id ? String(req.query.actor_id).trim() : null;
      const action = req.query.action ? String(req.query.action).trim() : null;
      const resourceType = req.query.resource_type ? String(req.query.resource_type).trim() : null;
      const cursor = req.query.cursor ? String(req.query.cursor).trim() : null;
      let limit = 50;

      if (req.query.limit) {
        limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
      }

      let from = null;
      let to = null;

      if (req.query.from) {
        const fromDate = new Date(req.query.from);
        if (!isNaN(fromDate.getTime())) {
          from = fromDate.toISOString();
        }
      }

      if (req.query.to) {
        const toDate = new Date(req.query.to);
        if (!isNaN(toDate.getTime())) {
          to = toDate.toISOString();
        }
      }

      const [{ rows: entries, nextCursor }, total] = await Promise.all([
        stores.auditLog.query({ actorId, action, resourceType, from, to, limit, cursor }),
        stores.auditLog.count({ actorId, action, resourceType, from, to }),
      ]);

      return sendSuccess(res, entries, {
        meta: {
          total,
          limit,
          nextCursor,
        },
      });
    } catch (error) {
      log.error('admin audit query failed', { error: error.message });
      return sendError(res, 500, 'Failed to query audit log', ErrorCodes.INTERNAL_ERROR);
    }
  });
};
