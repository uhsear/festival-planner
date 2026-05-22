// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
/**
 * Admin audit-log query routes
 * Extracted from routes/admin.js during the 2026-04-14 file-size split.
 * Mounts: /audit
 */
export default function mountAdminAuditRoutes({ router, deps }: any): void {
  const {
    log,
    setNoStore,
    sendSuccess, sendError, ErrorCodes,
    adminAuth,
    stores,
    schemas, validateQuery,
  } = deps;

  // ── GET /audit — query audit log with filters ────────────
  router.get('/audit', adminAuth, validateQuery(schemas.adminAuditQuery), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const { actor_id: actorId, action, resource_type: resourceType, cursor, limit } = req.validatedQuery;
      const from = req.validatedQuery.from ? new Date(req.validatedQuery.from).toISOString() : null;
      const to = req.validatedQuery.to ? new Date(req.validatedQuery.to).toISOString() : null;

      const [{ rows: entries, nextCursor }, total] = await Promise.all([
        stores.auditLog.query({ actorId: actorId || null, action: action || null, resourceType: resourceType || null, from, to, limit, cursor: cursor || null }),
        stores.auditLog.count({ actorId: actorId || null, action: action || null, resourceType: resourceType || null, from, to }),
      ]);

      return sendSuccess(res, entries, {
        meta: {
          total,
          limit,
          nextCursor,
        },
      });
    } catch (error: any) {
      log.error('admin audit query failed', { error: error.message });
      return sendError(res, 500, 'Failed to query audit log', ErrorCodes.INTERNAL_ERROR);
    }
  });
}
