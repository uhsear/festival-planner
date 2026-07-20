import type { Crew, CrewMember } from '../lib/types';

import { planReformRoster } from '../lib/crew-reform.js';
import { generateUniqueInviteCode } from './crew-invites.js';
import createInviteRoutes from './crew-invites.js';
import createMeetingPointRoutes from './crew-meeting-points.js';
import createPollRoutes from './crew-polls.js';
import createPackingRoutes from './crew-packing.js';
import createRidesRoutes from './crew-rides.js';
import createStatusRoutes from './crew-status.js';
import createSosRoutes from './crew-sos.js';
import createCrewMemberRoutes from './crew-members.js';

/**
 * The crew shape this route actually serializes: the shared `Crew` minus
 * `members` (added by serializeCrewWithMembers), plus backend-only extras
 * (`createdBy`, `maxMembers`) and the owner-only / membership-conditional
 * fields. Typing the literal against this catches drift such as the historical
 * "Crew serialized without `owner`" bug at compile time.
 */
type SerializedCrew = Omit<Crew, 'members'> & {
  createdBy: string;
  maxMembers?: number;
  role?: string;
  joinedAt?: string;
  inviteExpiresAt?: string | null;
  // Totem (snake on the wire since the Crew domain object is camelCase):
  // the crowd-finding sign/emoji a crew rallies to. Nullable.
  totem_name: string | null;
  totem_emoji: string | null;
};

/**
 * The member shape this route emits. It is a superset of the shared
 * `CrewMember` (carries `avatarKey`/`avatarVersion`/`joinedAt` and uses
 * `username` as the display `name`) — kept explicit so the serializer is honest
 * about what crosses the wire rather than pretending to be a bare CrewMember.
 */
type SerializedCrewMember = Pick<CrewMember, 'userId' | 'username' | 'name' | 'role'> & {
  avatarKey: string | null;
  avatarVersion: string | null;
  joinedAt?: string;
};

export default function createCrewRoutes(deps: any) {
  const {
    express,
    log,
    pool,
    config,
    reengagement,
    userAuth,
    setNoStore,
    sanitizeString,
    sanitizeIdentifier,
    createOpaqueId,
    sendSuccess,
    sendError,
    ErrorCodes,
    rateLimit,
    stores,
    schemas,
    validate,
    validateQuery,
    validateParams,
    io,
  } = deps;

  const router = express.Router();

  // ── Helpers ────────────────────────────────────────────────────────
  const MAX_CREWS_PER_USER_PER_FESTIVAL = 3;

  /**
   * Resolve a crew by ID and verify the requesting user is the owner.
   * Returns { crew, membership } on success, or null if an error response was already sent.
   */
  async function resolveCrewOwnership(res: any, crewId: any, userId: any, actionLabel: any) {
    const crew = await stores.crews.getById(crewId);
    if (!crew) {
      sendError(res, 404, 'Crew not found', ErrorCodes.NOT_FOUND);
      return null;
    }
    const membership = await stores.crews.getMember(crewId, userId);
    if (!membership || membership.role !== 'owner') {
      sendError(res, 403, `Only the crew owner can ${actionLabel}`, ErrorCodes.FORBIDDEN);
      return null;
    }
    return { crew, membership };
  }

  /**
   * H1 (owner whole-crew delete): evict EVERY member's live socket(s) from the
   * crew room before the row + its members cascade away (crew_members.crew_id
   * REFERENCES crews(id) ON DELETE CASCADE — migrations/004_postgresql_baseline.sql:174).
   * Without this, a member who was live-location-sharing when the owner deleted
   * the crew keeps receiving live location/SOS/status broadcasts for a crew that
   * no longer exists, and keeps a stamped sharingCrewId they could inject from,
   * until they happen to disconnect. Mirrors evictAllFromCrewRoom in
   * routes/admin-bulk.ts. The crew:deleted event is already emitted by the delete
   * handler (with festivalId), so it is not re-emitted here.
   *
   * Best-effort: a failure must never fail the HTTP delete (the DB rows are
   * already gone); io may be absent in some test/CLI contexts.
   */
  async function evictAllFromCrewRoom(crewId: string) {
    if (!io || typeof io.in !== 'function') return;
    const room = `crew:${crewId}`;
    try {
      const sockets = await io.in(room).fetchSockets();
      for (const s of sockets) {
        if (s.data?.sharingCrewId === crewId) delete s.data.sharingCrewId;
        delete s.data.crewMembershipCheckedAt;
        delete s.data.crewMembershipUpdateCount;
        s.leave(room);
      }
    } catch (error: any) {
      log.warn('crew room full eviction failed', { error: error?.message, crewId });
    }
  }

  function serializeCrew(crew: any, membership: any): SerializedCrew {
    const result: SerializedCrew = {
      id: crew.id,
      festivalId: crew.festivalId,
      name: crew.name,
      // `owner` is what the shared Crew type and clients read for ownership
      // checks; keep `createdBy` for backward compat.
      owner: crew.createdBy,
      createdBy: crew.createdBy,
      maxMembers: crew.maxMembers,
      // Lineage: which crew this one was reformed from (M3). Nullable; absent on
      // crews created the normal way. Lets the UI show "your crew last year".
      reformedFrom: crew.reformedFrom ?? crew.reformed_from ?? null,
      createdAt: crew.createdAt,
      updatedAt: crew.updatedAt,
      homeBaseLocation: crew.homeBaseLocation || crew.home_base_location || null,
      homeBaseTime: crew.homeBaseTime || crew.home_base_time || null,
      homeBaseUpdatedAt: crew.homeBaseUpdatedAt || crew.home_base_updated_at || null,
      // M6 Crew Photo Wall (Phase 1): shared-album link-out URL.
      photoAlbumUrl: crew.photoAlbumUrl || crew.photo_album_url || null,
      // Crew totem: crowd-finding sign name + emoji. Snake-cased on the wire.
      totem_name: crew.totemName ?? null,
      totem_emoji: crew.totemEmoji ?? null,
    };
    if (membership) {
      result.role = membership.role || crew.role;
      result.joinedAt = membership.joinedAt || crew.joinedAt;
    }
    if (result.role === 'owner') {
      result.inviteCode = crew.inviteCode;
      result.inviteExpiresAt = crew.inviteExpiresAt || null;
    }
    return result;
  }

  function serializeCrewWithMembers(crew: any, members: any, requestingUserId: any) {
    const membership = members.find((m: any) => m.userId === requestingUserId);
    const base = serializeCrew(crew, membership);
    const serializedMembers: SerializedCrewMember[] = members.map((m: any) => ({
      userId: m.userId,
      username: m.username,
      name: m.username,
      avatarKey: m.avatarKey || null,
      avatarVersion: m.avatarVersion || null,
      role: m.role,
      joinedAt: m.joinedAt,
    }));
    return { ...base, members: serializedMembers, memberCount: members.length };
  }

  // Share helpers with sub-routers via deps
  const _crewHelpers = {
    resolveCrewOwnership,
    serializeCrew,
    serializeCrewWithMembers,
    MAX_CREWS_PER_USER_PER_FESTIVAL,
  };
  const subDeps = { ...deps, _crewHelpers };

  // ── Mount sub-routers ──────────────────────────────────────────────
  const inviteRoutes = createInviteRoutes(subDeps);
  const meetingPointRoutes = createMeetingPointRoutes(subDeps);
  const pollRoutes = createPollRoutes(subDeps);
  const packingRoutes = createPackingRoutes(subDeps);
  const ridesRoutes = createRidesRoutes(subDeps);
  const statusRoutes = createStatusRoutes(subDeps);
  const sosRoutes = createSosRoutes(subDeps);
  const memberRoutes = createCrewMemberRoutes(subDeps);

  router.use('/', inviteRoutes);
  router.use('/', meetingPointRoutes);
  router.use('/', pollRoutes);
  router.use('/', packingRoutes);
  router.use('/', ridesRoutes);
  router.use('/', statusRoutes);
  router.use('/', sosRoutes);
  router.use('/', memberRoutes);

  // ── Crew creation helpers ────────────────────────────────────────
  async function validateCrewCreation(req: any, cleanFestivalId: any) {
    const { rows: festivalRows } = await pool.query('SELECT 1 FROM festivals WHERE id = $1 AND deleted_at IS NULL', [
      cleanFestivalId,
    ]);
    if (festivalRows.length === 0) return 'Festival not found';

    const profile = await stores.profiles.readByUserAndFestival?.(req.user.userId, cleanFestivalId);
    if (!profile) return 'Join the festival first';

    const existingCrews = await stores.crews.listByUserAndFestival(req.user.userId, cleanFestivalId);
    if (!Array.isArray(existingCrews) || existingCrews.length >= MAX_CREWS_PER_USER_PER_FESTIVAL) {
      return `Maximum ${MAX_CREWS_PER_USER_PER_FESTIVAL} crews per festival`;
    }
    return null;
  }

  async function persistCrew(crewData: any) {
    if (stores.crews.createWithOwner) {
      await stores.crews.createWithOwner(crewData);
    } else {
      await stores.crews.create(crewData);
      await stores.crews.addMember({ crewId: crewData.id, userId: crewData.createdBy, role: 'owner' });
    }
  }

  // ── POST / — Create a crew ──────────────────────────────────────
  router.post('/', userAuth, rateLimit(10, 'crew-create'), validate(schemas.crewCreate), async (req: any, res: any) => {
    try {
      const { name, festivalId, totemName, totemEmoji } = req.validatedBody;
      const cleanName = sanitizeString(name, 60);
      const cleanFestivalId = sanitizeIdentifier(festivalId, 100);
      const cleanTotemName = totemName !== undefined ? sanitizeString(totemName, 40) : undefined;
      const cleanTotemEmoji = totemEmoji !== undefined ? sanitizeString(totemEmoji, 16) : undefined;

      if (!cleanName) return sendError(res, 400, 'Crew name required', ErrorCodes.MISSING_FIELD);
      if (!cleanFestivalId) return sendError(res, 400, 'Festival ID required', ErrorCodes.MISSING_FIELD);

      const validationError = await validateCrewCreation(req, cleanFestivalId);
      if (validationError) {
        const code = validationError.startsWith('Maximum')
          ? ErrorCodes.MAX_LIMIT_REACHED
          : validationError === 'Festival not found'
            ? ErrorCodes.NOT_FOUND
            : ErrorCodes.FORBIDDEN;
        const status =
          validationError === 'Festival not found' ? 404 : validationError.startsWith('Maximum') ? 400 : 403;
        return sendError(res, status, validationError, code);
      }

      const crewId = createOpaqueId('crew');
      const inviteCode = await generateUniqueInviteCode(stores);
      const crewData = {
        id: crewId,
        festivalId: cleanFestivalId,
        name: cleanName,
        createdBy: req.user.userId,
        inviteCode,
        inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        maxMembers: 30,
        totemName: cleanTotemName,
        totemEmoji: cleanTotemEmoji,
      };

      await persistCrew(crewData);
      const crew = await stores.crews.getById(crewId);
      const members = await stores.crews.getMembers(crewId);

      if (!crew || !Array.isArray(members)) {
        log.error('crew creation incomplete', { crewId });
        // Compensating cleanup: persistCrew already committed the crew row + owner
        // membership, so delete it to avoid an orphaned crew (crew_members cascades
        // via ON DELETE CASCADE). Cleanup failure still returns 500.
        try {
          await stores.crews.delete(crewId);
        } catch (cleanupError: any) {
          log.error('crew creation cleanup failed', { crewId, error: cleanupError.message });
        }
        return sendError(res, 500, 'Failed to create crew', ErrorCodes.INTERNAL_ERROR);
      }

      log.info('crew:created', { crewId, festivalId: cleanFestivalId, userId: req.user.userId });
      res.status(201);
      return sendSuccess(res, serializeCrewWithMembers(crew, members, req.user.userId));
    } catch (error: any) {
      log.error('crew create failed', { error: error.message, userId: req.user.userId });
      return sendError(res, 500, 'Failed to create crew', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /:crewId/reform — Reform this crew for another festival ──
  //
  // Crews are festival-scoped, so "reform" creates a NEW crew in
  // targetFestivalId and brings the prior roster across. Consent-safe:
  //   • requester → owner of the new crew
  //   • prior members who already have a profile in the target festival →
  //     auto-added (they could join anyway; no consent gap)
  //   • everyone else → invited via the returned link, never silently added
  // Idempotent: if a crew already reformed FROM this source INTO this target by
  // this requester exists, we return it (and top up any newly-eligible
  // auto-adds) instead of creating a duplicate. The guarantee is the DB's, not
  // the read's: crews_reform_idem_uidx (migration 061) is UNIQUE on
  // (created_by, festival_id, reformed_from), so a concurrent/retried request
  // that the read below can't yet see loses on the index and is re-read, never
  // duplicated.
  router.post(
    '/:crewId/reform',
    userAuth,
    rateLimit(10, 'crew-reform'),
    validateParams(schemas.crewIdParams),
    validate(schemas.crewReform),
    async (req: any, res: any) => {
      try {
        const sourceCrewId = sanitizeIdentifier(req.validatedParams.crewId, 100);
        const targetFestivalId = sanitizeIdentifier(req.validatedBody.targetFestivalId, 100);
        if (!sourceCrewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);
        if (!targetFestivalId) return sendError(res, 400, 'Target festival ID required', ErrorCodes.MISSING_FIELD);

        // Source crew must exist and the requester must be a member of it.
        const sourceCrew = await stores.crews.getById(sourceCrewId);
        if (!sourceCrew) return sendError(res, 404, 'Crew not found', ErrorCodes.NOT_FOUND);
        const membership = await stores.crews.getMember(sourceCrewId, req.user.userId);
        if (!membership) return sendError(res, 403, 'Not a member of this crew', ErrorCodes.FORBIDDEN);

        // Target festival must exist (and not be deleted).
        const { rows: festivalRows } = await pool.query(
          'SELECT 1 FROM festivals WHERE id = $1 AND deleted_at IS NULL',
          [targetFestivalId],
        );
        if (festivalRows.length === 0) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

        // The requester must have a profile in the target festival to own a crew
        // there (mirrors POST /crews — "Join the festival first").
        const requesterProfile = await stores.profiles.readByUserAndFestival?.(req.user.userId, targetFestivalId);
        if (!requesterProfile) return sendError(res, 403, 'Join the festival first', ErrorCodes.FORBIDDEN);

        const sourceMembers = await stores.crews.getMembers(sourceCrewId);
        const targetProfileUserIds = await stores.profiles.userIdsByFestival(targetFestivalId);

        // ── Idempotency: reuse an existing reform of this source by this
        // requester in the target festival rather than creating a duplicate. ──
        // This read is the fast path, NOT the guarantee — it cannot see a
        // concurrent request's uncommitted crew. crews_reform_idem_uidx
        // (migration 061) is the guarantee; the persist below absorbs its 23505.
        const requesterTargetCrews = await stores.crews.listByUserAndFestival(req.user.userId, targetFestivalId);
        let newCrew = (requesterTargetCrews || []).find(
          (c: any) => c.reformedFrom === sourceCrewId && c.createdBy === req.user.userId,
        );

        if (!newCrew) {
          // Honor the per-festival crew cap for the requester.
          if ((requesterTargetCrews || []).length >= MAX_CREWS_PER_USER_PER_FESTIVAL) {
            return sendError(
              res,
              400,
              `Maximum ${MAX_CREWS_PER_USER_PER_FESTIVAL} crews per festival`,
              ErrorCodes.MAX_LIMIT_REACHED,
            );
          }
          const newCrewId = createOpaqueId('crew');
          const inviteCode = await generateUniqueInviteCode(stores);
          try {
            await persistCrew({
              id: newCrewId,
              festivalId: targetFestivalId,
              name: sanitizeString(sourceCrew.name, 60) || sourceCrew.name,
              createdBy: req.user.userId,
              inviteCode,
              inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              maxMembers: sourceCrew.maxMembers || 30,
              reformedFrom: sourceCrewId,
            });
            newCrew = await stores.crews.getById(newCrewId);
          } catch (persistErr: any) {
            // Lost the reform race: a concurrent/retried request already inserted
            // the crew for this (createdBy, festivalId, reformedFrom) and won the
            // unique key on crews_reform_idem_uidx (migration 061), so our INSERT
            // raised 23505 and rolled back cleanly (createWithOwner is
            // transactional — no orphan crew or member row). Re-read and reuse
            // the winner so the losing request returns the same crew instead of
            // 500ing. Any non-23505 error (or a 23505 with no matching winner,
            // e.g. an unrelated unique collision) is unexpected — rethrow to the
            // outer 500 handler.
            if (persistErr?.code !== '23505') throw persistErr;
            const raced = await stores.crews.listByUserAndFestival(req.user.userId, targetFestivalId);
            newCrew = (raced || []).find(
              (c: any) => c.reformedFrom === sourceCrewId && c.createdBy === req.user.userId,
            );
            if (!newCrew) throw persistErr;
          }
          if (!newCrew) {
            log.error('crew reform creation incomplete', { sourceCrewId, targetFestivalId });
            return sendError(res, 500, 'Failed to reform crew', ErrorCodes.INTERNAL_ERROR);
          }
        }

        // Plan the roster split. Pass the NEW crew's CURRENT members as the
        // already-member set so re-running reform never double-adds (idempotent).
        const existingNewMembers = await stores.crews.getMembers(newCrew.id);
        const existingMemberUserIds = existingNewMembers.map((m: any) => m.userId);
        const memberCap = newCrew.maxMembers || 30;
        const { toAutoAdd, toInvite } = planReformRoster(
          sourceMembers,
          req.user.userId,
          targetProfileUserIds,
          existingMemberUserIds,
        );

        // Auto-add eligible prior members up to the member cap. Each add is
        // best-effort + idempotent at the DB layer guard above; a duplicate-key
        // race is swallowed so one stragler can't fail the whole reform.
        const added: string[] = [];
        let slots = memberCap - existingMemberUserIds.length;
        for (const uid of toAutoAdd) {
          if (slots <= 0) break;
          try {
            await stores.crews.addMember({ crewId: newCrew.id, userId: uid, role: 'member' });
            added.push(uid);
            slots--;
          } catch (addErr: any) {
            log.warn('crew reform auto-add skipped', { crewId: newCrew.id, userId: uid, error: addErr?.message });
          }
        }

        const finalCrew = await stores.crews.getById(newCrew.id);
        const finalMembers = await stores.crews.getMembers(newCrew.id);

        // Broadcast to the new crew room so any already-open client refreshes.
        if (io) {
          io.to(`crew:${newCrew.id}`).emit('crew:reformed', {
            crewId: newCrew.id,
            reformedFrom: sourceCrewId,
            festivalId: targetFestivalId,
          });
        }

        log.info('crew:reformed', {
          sourceCrewId,
          newCrewId: newCrew.id,
          targetFestivalId,
          userId: req.user.userId,
          autoAdded: added.length,
          invited: toInvite.length,
        });

        // M3 re-engagement: notify the INVITED prior members (those without a
        // target-festival profile). Event-gated, per-type opt-out + DND + deduped
        // inside the trigger. Best-effort + fire-and-forget so a notify failure
        // never fails the reform itself.
        if (reengagement?.sendCrewReformed && toInvite.length > 0) {
          const origin = config?.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
          const inviteUrl = finalCrew?.inviteCode
            ? `${origin}/join/${encodeURIComponent(finalCrew.inviteCode)}`
            : undefined;
          let festivalName = '';
          try {
            const { rows } = await pool.query('SELECT name FROM festivals WHERE id = $1', [targetFestivalId]);
            festivalName = rows[0]?.name || '';
          } catch {
            /* name is optional for the notification */
          }
          reengagement
            .sendCrewReformed({
              newCrewId: newCrew.id,
              crewName: finalCrew?.name || sourceCrew.name,
              festivalName,
              invitedUserIds: toInvite,
              inviteUrl,
            })
            .catch((err: any) => log.warn('crew_reformed notify failed', { error: err?.message }));
        }

        const serialized = serializeCrewWithMembers(finalCrew, finalMembers, req.user.userId);
        return sendSuccess(res, {
          ...serialized,
          reformedFrom: sourceCrewId,
          // Roster outcome so the UI can say "N added, M to invite" and surface
          // the invite link for the rest.
          reform: {
            autoAdded: added,
            invited: toInvite,
          },
        });
      } catch (error: any) {
        log.error('crew reform failed', { error: error.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to reform crew', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── GET / — List my crews (optionally filtered by festivalId) ───
  router.get(
    '/',
    userAuth,
    rateLimit(120, 'crew-list'),
    validateQuery(schemas.crewListQuery),
    async (req: any, res: any) => {
      try {
        setNoStore(res);
        const festivalId = req.validatedQuery.festivalId
          ? sanitizeIdentifier(req.validatedQuery.festivalId, 100)
          : null;

        let crews;
        if (festivalId) {
          crews = await stores.crews.listByUserAndFestival(req.user.userId, festivalId);
        } else {
          crews = await stores.crews.listByUser(req.user.userId);
        }

        // Batch-load members for all crews in a single query (avoids N+1)
        const crewIds = crews.map((c: any) => c.id);
        const membersByCrewId = await stores.crews.getMembersForCrews(crewIds);

        const result = crews.map((crew: any) => {
          const members = membersByCrewId.get(crew.id) || [];
          return serializeCrewWithMembers(crew, members, req.user.userId);
        });
        return sendSuccess(res, result);
      } catch (error: any) {
        log.error('crew list failed', { error: error.message, userId: req.user.userId });
        return sendError(res, 500, 'Failed to list crews', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── GET /:crewId — Get crew details with members ───────────────
  router.get(
    '/:crewId',
    userAuth,
    rateLimit(120, 'crew-get'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        setNoStore(res);
        const crewId = sanitizeIdentifier(req.validatedParams.crewId, 100);
        if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

        const crew = await stores.crews.getById(crewId);
        if (!crew) return sendError(res, 404, 'Crew not found', ErrorCodes.NOT_FOUND);

        const membership = await stores.crews.getMember(crewId, req.user.userId);
        if (!membership) return sendError(res, 403, 'Not a member of this crew', ErrorCodes.FORBIDDEN);

        const members = await stores.crews.getMembers(crewId);
        return sendSuccess(res, serializeCrewWithMembers(crew, members, req.user.userId));
      } catch (error: any) {
        log.error('crew get failed', { error: error.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to get crew', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── PUT /:crewId — Update crew (owner only) ────────────────────
  router.put(
    '/:crewId',
    userAuth,
    rateLimit(10, 'crew-update'),
    validateParams(schemas.crewIdParams),
    validate(schemas.crewUpdate),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId, 100);
        if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

        const resolved = await resolveCrewOwnership(res, crewId, req.user.userId, 'update');
        if (!resolved) return;
        const { crew } = resolved;

        const updateData: any = { id: crewId };
        if (req.validatedBody.name !== undefined) {
          updateData.name = sanitizeString(req.validatedBody.name, 60);
        } else {
          updateData.name = crew.name;
        }
        if (req.validatedBody.maxMembers !== undefined) {
          updateData.maxMembers = req.validatedBody.maxMembers;
        } else {
          updateData.maxMembers = crew.maxMembers;
        }
        // Totem: keep existing when the field is omitted (undefined → unchanged),
        // mirroring name/maxMembers above. The store only writes a column when
        // its value is supplied, so passing the prior value is a harmless no-op.
        if (req.validatedBody.totemName !== undefined) {
          updateData.totemName = sanitizeString(req.validatedBody.totemName, 40);
        } else {
          updateData.totemName = crew.totemName ?? null;
        }
        if (req.validatedBody.totemEmoji !== undefined) {
          updateData.totemEmoji = sanitizeString(req.validatedBody.totemEmoji, 16);
        } else {
          updateData.totemEmoji = crew.totemEmoji ?? null;
        }

        await stores.crews.update(updateData);
        const updated = await stores.crews.getById(crewId);
        const members = await stores.crews.getMembers(crewId);

        if (io) {
          const broadcastData = serializeCrewWithMembers(updated, members, null);
          delete broadcastData.inviteCode;
          io.to(`crew:${crewId}`).emit('crew:updated', broadcastData);
        }

        log.info('crew:updated', { crewId, userId: req.user.userId });
        return sendSuccess(res, serializeCrewWithMembers(updated, members, req.user.userId));
      } catch (error: any) {
        log.error('crew update failed', { error: error.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to update crew', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── DELETE /:crewId — Delete crew (owner only) ──────────────────
  router.delete(
    '/:crewId',
    userAuth,
    rateLimit(5, 'crew-delete'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId, 100);
        if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);

        const resolved = await resolveCrewOwnership(res, crewId, req.user.userId, 'delete');
        if (!resolved) return;
        const { crew } = resolved;

        if (io) io.to(`crew:${crewId}`).emit('crew:deleted', { crewId, festivalId: crew.festivalId });
        // H1: force every remaining member's still-connected socket(s) out of the
        // crew room so they stop receiving live location/SOS/status broadcasts for
        // a crew that's about to vanish and can no longer inject into it. Mirrors
        // kick/leave (routes/crew-members.ts) and admin whole-crew delete
        // (routes/admin-bulk.ts). Must run BEFORE the cascade, while the room
        // still holds its sockets.
        await evictAllFromCrewRoom(crewId);

        await stores.crews.delete(crewId);

        log.info('crew:deleted', { crewId, festivalId: crew.festivalId, userId: req.user.userId });
        return sendSuccess(res, { success: true });
      } catch (error: any) {
        log.error('crew delete failed', { error: error.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to delete crew', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
