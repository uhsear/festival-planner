// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
/**
 * Admin bulk operations + crew moderation routes
 * Extracted from routes/admin.js during the 2026-04-14 file-size split.
 * Mounts: /bulk/deactivate, /bulk/archive-festivals,
 *         /crews, /crews/:id/members, /crews/:id/members/:userId, /crews/:id
 */
export default function mountAdminBulkRoutes({ router, deps, ctx }: any): void {
  const {
    log,
    setNoStore,
    sendSuccess,
    sendError,
    ErrorCodes,
    adminAuth,
    getRequestIp,
    stores,
    schemas,
    validate,
    validateParams,
  } = deps;
  const { adminWriteLimit } = ctx;

  // ── POST /bulk/deactivate — force-logout multiple users ──────────
  // NOTE (M1, security-review-2026-06-06): this endpoint's only effect is
  // clearing the targeted users' sessions (a force-logout). It does NOT
  // deactivate/disable the account — there is no is_active/deactivated_at
  // column and login has no disabled-account gate, so a "deactivated" user
  // can log straight back in with unchanged credentials. A real deactivation
  // would require a DB migration (new column + login + session-validation
  // gates), which is intentionally out of scope here (migration-free deploy).
  // We therefore rename the semantics to `force_logout` so the response/audit
  // match the actual behavior; the route path is kept for API compatibility.
  router.post(
    '/bulk/deactivate',
    adminAuth,
    adminWriteLimit,
    validate(schemas.adminBulkDeactivate),
    async (req: any, res: any) => {
      try {
        const { userIds } = req.validatedBody;
        if (userIds.length > 50) {
          return sendError(res, 400, 'Provide 1-50 user IDs', ErrorCodes.INVALID_INPUT);
        }
        const settled = await Promise.allSettled(
          userIds.map((userId: string) => stores.sessions.deleteUserSessions(userId).then(() => userId)),
        );
        const results = settled.map((r: any, i: number) =>
          r.status === 'fulfilled'
            ? { userId: userIds[i], status: 'logged_out' }
            : { userId: userIds[i], status: 'error', message: r.reason?.message || 'unknown' },
        );
        for (const r of results) {
          if (r.status === 'logged_out') {
            log.info('admin:force-logout', { userId: r.userId, actor: 'admin' });
          }
        }
        if (stores.auditLog) {
          await stores.auditLog.insert({
            actorType: 'admin',
            actorId: req.user?.userId || 'admin',
            action: 'force_logout',
            targetType: 'users',
            targetId: userIds.join(','),
            detailsJson: JSON.stringify({ count: userIds.length }),
            ip: getRequestIp(req),
          });
        }
        return sendSuccess(res, { results });
      } catch (error: any) {
        log.error('bulk force-logout failed', { error: error.message });
        return sendError(res, 500, 'Bulk force-logout failed', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /bulk/archive-festivals — archive old festivals ─────────
  router.post(
    '/bulk/archive-festivals',
    adminAuth,
    adminWriteLimit,
    validate(schemas.adminBulkArchive),
    async (req: any, res: any) => {
      try {
        const { festivalIds } = req.validatedBody;
        if (festivalIds.length > 50) {
          return sendError(res, 400, 'Provide 1-50 festival IDs', ErrorCodes.INVALID_INPUT);
        }
        const results: any[] = [];
        for (const festivalId of festivalIds) {
          try {
            await stores.festivals.softDelete(festivalId);
            results.push({ festivalId, status: 'archived' });
          } catch (err: any) {
            results.push({ festivalId, status: 'error', message: err.message });
          }
        }
        if (deps.invalidateFestivalListCache) deps.invalidateFestivalListCache();
        if (stores.auditLog) {
          await stores.auditLog.insert({
            actorType: 'admin',
            actorId: req.user?.userId || 'admin',
            action: 'bulk_archive',
            targetType: 'festivals',
            targetId: festivalIds.join(','),
            detailsJson: JSON.stringify({ count: festivalIds.length }),
            ip: getRequestIp(req),
          });
        }
        return sendSuccess(res, { results });
      } catch (error: any) {
        log.error('bulk archive failed', { error: error.message });
        return sendError(res, 500, 'Bulk archive failed', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── GET /crews — list all crews with members for admin ────────────
  router.get('/crews', adminAuth, async (req: any, res: any) => {
    try {
      setNoStore(res);
      const pool = stores.pool;

      // Get all crews with member counts and festival names
      const { rows: crewRows } = await pool.query(`
        SELECT
          c.id,
          c.name,
          c.festival_id AS "festivalId",
          c.created_by AS "createdBy",
          c.invite_code AS "inviteCode",
          c.max_members AS "maxMembers",
          c.home_base_location AS "homeBaseLocation",
          c.home_base_time AS "homeBaseTime",
          c.created_at AS "createdAt",
          f.name AS "festivalName",
          u.username AS "creatorUsername",
          COUNT(cm.user_id) AS "memberCount"
        FROM
          crews c
          LEFT JOIN festivals f ON f.id = c.festival_id
          AND f.deleted_at IS NULL
          LEFT JOIN users u ON u.id = c.created_by
          AND u.deleted_at IS NULL
          LEFT JOIN crew_members cm ON cm.crew_id = c.id
        GROUP BY
          c.id,
          c.name,
          c.festival_id,
          c.created_by,
          c.invite_code,
          c.max_members,
          c.home_base_location,
          c.home_base_time,
          c.created_at,
          f.name,
          u.username
        ORDER BY
          c.created_at DESC
      `);

      return sendSuccess(res, crewRows);
    } catch (error: any) {
      log.error('admin crews list failed', { error: error.message });
      return sendError(res, 500, 'Failed to load crews', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET /crews/:id/members — list members of a crew ────────────
  router.get('/crews/:id/members', adminAuth, validateParams(schemas.genericIdParams), async (req: any, res: any) => {
    try {
      setNoStore(res);
      const crewId = deps.sanitizeIdentifier(req.validatedParams.id, 100);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

      const members = await stores.crews.getMembers(crewId);
      return sendSuccess(res, members);
    } catch (error: any) {
      log.error('admin crew members failed', { error: error.message });
      return sendError(res, 500, 'Failed to load crew members', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── DELETE /crews/:id/members/:userId — remove a member from a crew ────────────
  router.delete(
    '/crews/:id/members/:userId',
    adminAuth,
    adminWriteLimit,
    validateParams(schemas.genericIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = deps.sanitizeIdentifier(req.validatedParams.id, 100);
        const targetUserId = deps.sanitizeIdentifier(req.params.userId, 100);
        if (!crewId || !targetUserId) return sendError(res, 400, 'Invalid IDs', ErrorCodes.INVALID_INPUT);

        const member = await stores.crews.getMember(crewId, targetUserId);
        if (!member) return sendError(res, 404, 'Member not found', ErrorCodes.NOT_FOUND);

        await stores.crews.removeMember(crewId, targetUserId);

        if (stores.auditLog) {
          await stores.auditLog.insert({
            actorType: 'admin',
            actorId: req.user?.userId || 'admin',
            action: 'crew_remove_member',
            targetType: 'crew_member',
            targetId: `${crewId}:${targetUserId}`,
            detailsJson: JSON.stringify({ crewId, userId: targetUserId }),
            ip: getRequestIp(req),
          });
        }

        log.info('admin:crew-remove-member', { crewId, userId: targetUserId });
        return sendSuccess(res, { success: true });
      } catch (error: any) {
        log.error('admin crew remove member failed', { error: error.message });
        return sendError(res, 500, 'Failed to remove member', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── DELETE /crews/:id — delete a crew entirely ────────────
  router.delete(
    '/crews/:id',
    adminAuth,
    adminWriteLimit,
    validateParams(schemas.genericIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = deps.sanitizeIdentifier(req.validatedParams.id, 100);
        if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

        const crew = await stores.crews.getById(crewId);
        if (!crew) return sendError(res, 404, 'Crew not found', ErrorCodes.NOT_FOUND);

        await stores.crews.delete(crewId);

        if (stores.auditLog) {
          await stores.auditLog.insert({
            actorType: 'admin',
            actorId: req.user?.userId || 'admin',
            action: 'crew_delete',
            targetType: 'crew',
            targetId: crewId,
            detailsJson: JSON.stringify({ crewName: crew.name, festivalId: crew.festivalId }),
            ip: getRequestIp(req),
          });
        }

        log.warn('admin:crew-delete', { crewId, crewName: crew.name });
        return sendSuccess(res, { success: true });
      } catch (error: any) {
        log.error('admin crew delete failed', { error: error.message });
        return sendError(res, 500, 'Failed to delete crew', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );
}
