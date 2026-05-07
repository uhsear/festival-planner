// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
module.exports = function createProfilesRoutes(deps) {
  const {
    express, config, log,
    userAuth, adminAuth, setNoStore,
    sanitizeIdentifier, getFestivalById, getProfiles, getUserMap, getUserById,
    normalizePickPayload, normalizeNotePayload, normalizeReminderPayload,
    serializeProfileForViewer, serializeOwnProfile,
    _buildAvatarUrl,
    createOpaqueId,
    sendSuccess, sendError, ErrorCodes,
    rateLimit,
    removeProfileSockets,
    io, emitter,
    schemas, validate, validateParams,
    stores,
  } = deps;

  const router = express.Router();
  const { parsePageParams, paginateArray } = require('../lib/pagination');

  router.get('/:festivalId', userAuth, validateParams(schemas.festivalIdParams), async (req, res) => {
    try {
      setNoStore(res);
      const festivalId = req.validatedParams.festivalId;
      const festival = await getFestivalById(festivalId);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);
      const { getUserFestivalProfile } = deps;
      if (!await getUserFestivalProfile(req.user.userId, festivalId)) {
        return sendError(res, 403, 'Join this festival to view crew plans', ErrorCodes.FORBIDDEN);
      }
      const rawProfiles = stores.profiles.getByFestival
        ? await stores.profiles.getByFestival(festivalId)
        : (await getProfiles()).filter((profile) => profile.festivalId === festivalId);
      const userIds = [...new Set(rawProfiles.map((p) => p.userId).filter(Boolean))];
      const usersById = stores.users.getByIds
        ? await stores.users.getByIds(userIds)
        : await getUserMap();
      const profiles = rawProfiles
        .map((profile) => serializeProfileForViewer(profile, req.user.userId, usersById.get(profile.userId)));
      // Support paginated response when params present
      if (req.query.cursor || req.query.limit || req.query.pageSize) {
        const { limit, cursor } = parsePageParams(req.query);
        const { items, pagination } = paginateArray(profiles, { limit, cursor });
        return sendSuccess(res, items, { pagination });
      }
      return sendSuccess(res, profiles);
    } catch (error) {
      log.error('profile load failed', { error: error.message, festivalId: req.params.festivalId });
      return sendError(res, 500, 'Failed to load profiles', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/', userAuth, rateLimit(10, 'profile-join'), validate(schemas.joinFestival), async (req, res) => {
    try {
      const festivalId = sanitizeIdentifier(req.validatedBody?.festivalId, 100);
      if (!festivalId) return sendError(res, 400, 'Festival ID required', ErrorCodes.MISSING_FIELD);
      const festival = await getFestivalById(festivalId);
      if (!festival) return sendError(res, 404, 'Festival not found', ErrorCodes.NOT_FOUND);

      // Check if user already has profile for this festival
      const { getUserFestivalProfile } = deps;
      let profile = await getUserFestivalProfile(req.user.userId, festivalId);
      if (profile) {
        const user = await getUserById(profile.userId);
        if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
        emitter.profileCreated({ festivalId, profile, user });
        return sendSuccess(res, serializeOwnProfile(profile, user));
      }

      // Try to claim orphan profile matching username
      profile = await stores.profiles.claimOrphan(festivalId, req.user.userId, req.user.username);
      if (profile) {
        const user = await getUserById(profile.userId);
        if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
        emitter.profileCreated({ festivalId, profile, user });
        return sendSuccess(res, serializeOwnProfile(profile, user));
      }

      // Check max profiles per festival — use countByFestival if available, else fallback
      const festivalProfileCount = stores.profiles.countByFestival
        ? await stores.profiles.countByFestival(festivalId)
        : (await getProfiles()).filter((p) => p.festivalId === festivalId).length;
      if (festivalProfileCount >= config.MAX_PROFILES_PER_FESTIVAL) {
        return sendError(res, 400, 'Maximum profiles reached', ErrorCodes.MAX_LIMIT_REACHED);
      }

      // Create new profile
      profile = await stores.profiles.create({
        id: createOpaqueId('prof'),
        festivalId,
        userId: req.user.userId,
        name: req.user.username,
        picks: {},
        notes: {},
        reminders: {},
        createdAt: new Date().toISOString(),
      });

      const user = await getUserById(profile.userId);
      if (!user) return sendError(res, 404, 'User not found', ErrorCodes.NOT_FOUND);
      log.info('profile:created', { profileId: profile.id, festivalId, userId: req.user.userId, username: req.user.username });
      emitter.profileCreated({ festivalId, profile, user });
      return sendSuccess(res, serializeOwnProfile(profile, user));
    } catch (error) {
      log.error('profile create failed', { error: error.message });
      return sendError(res, 500, 'Failed to create/join profile', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // PUT and PATCH both accept partial payloads
  async function updateProfile(req, res) {
    try {
      setNoStore(res);
      const profileId = req.validatedParams.id;
      let nextPicks;
      if (req.validatedBody?.picks !== undefined) {
        const normalized = normalizePickPayload(req.validatedBody.picks);
        if (normalized.error) return sendError(res, 400, normalized.error, ErrorCodes.INVALID_INPUT);
        nextPicks = normalized.value;
      }

      let nextNotes;
      if (req.validatedBody?.notes !== undefined) {
        const normalized = normalizeNotePayload(req.validatedBody.notes);
        if (normalized.error) return sendError(res, 400, normalized.error, ErrorCodes.INVALID_INPUT);
        nextNotes = normalized.value;
        // Validate notes size limits
        if (Object.keys(nextNotes).length > 200) {
          return sendError(res, 400, 'Maximum 200 notes per profile', ErrorCodes.INVALID_INPUT);
        }
        for (const [setId, noteText] of Object.entries(nextNotes)) {
          if (typeof noteText === 'string' && noteText.length > 1000) {
            return sendError(res, 400, `Note text exceeds 1000 character limit for set ${setId}`, ErrorCodes.INVALID_INPUT);
          }
        }
      }

      let nextReminders;
      if (req.validatedBody?.reminders !== undefined) {
        const normalized = normalizeReminderPayload(req.validatedBody.reminders);
        if (normalized.error) return sendError(res, 400, normalized.error, ErrorCodes.INVALID_INPUT);
        nextReminders = normalized.value;
        // Validate reminders size limits
        if (Object.keys(nextReminders).length > 200) {
          return sendError(res, 400, 'Maximum 200 reminders per profile', ErrorCodes.INVALID_INPUT);
        }
        for (const [setId, reminderValue] of Object.entries(nextReminders)) {
          if (typeof reminderValue !== 'number' || reminderValue < 1) {
            return sendError(res, 400, `Reminder for set ${setId} must be a positive integer`, ErrorCodes.INVALID_INPUT);
          }
        }
      }

      // Optional optimistic concurrency: If-Match header contains expected updatedAt
      const ifMatch = req.headers['if-match'];

      // Fetch profile and festival data
      // Use direct lookup instead of full scan
      const currentProfile = stores.profiles.getById
        ? await stores.profiles.getById(profileId)
        : (await getProfiles()).find((p) => p.id === profileId);
      if (!currentProfile) return sendError(res, 404, 'Profile not found', ErrorCodes.NOT_FOUND);
      if (currentProfile.userId !== req.user.userId) {
        return sendError(res, 403, 'Not your profile', ErrorCodes.FORBIDDEN);
      }
      // Conflict detection: reject if client's version doesn't match
      if (ifMatch && currentProfile.updatedAt && ifMatch !== `"${currentProfile.updatedAt}"`) {
        const user = await getUserById(currentProfile.userId) || null;
        return sendError(res, 409, 'Profile was modified since your last fetch', ErrorCodes.VERSION_MISMATCH, {
          current: serializeOwnProfile(currentProfile, user),
        });
      }

      const festival = await getFestivalById(currentProfile.festivalId);
      const validSetIds = new Set((festival?.days || []).flatMap((day) => (day.sets || []).map((set) => set.id)));
      const _validStageIds = new Set((festival?.stages || []).map((stage) => stage.id));

      // Validate set references
      if (nextPicks !== undefined && Object.keys(nextPicks).some((setId) => !validSetIds.has(setId))) {
        return sendError(res, 400, 'Pick references an unknown set', ErrorCodes.INVALID_INPUT);
      }
      if (nextNotes !== undefined && Object.keys(nextNotes).some((setId) => !validSetIds.has(setId))) {
        return sendError(res, 400, 'Note references an unknown set', ErrorCodes.INVALID_INPUT);
      }
      if (nextReminders !== undefined && Object.keys(nextReminders).some((setId) => !validSetIds.has(setId))) {
        return sendError(res, 400, 'Reminder references an unknown set', ErrorCodes.INVALID_INPUT);
      }

      // Build update fields
      const updateFields = {};
      if (nextPicks !== undefined) updateFields.picks = nextPicks;
      if (nextNotes !== undefined) updateFields.notes = nextNotes;
      if (nextReminders !== undefined) updateFields.reminders = nextReminders;

      // Update profile
      const profile = await stores.profiles.update(profileId, updateFields);
      if (!profile) return sendError(res, 500, 'Failed to update profile', ErrorCodes.INTERNAL_ERROR);

      log.info('profile:updated', { profileId, userId: req.user.userId, fields: Object.keys(updateFields) });
      emitter.profileUpdated({
        profile,
        user: await getUserById(profile.userId),
        changedFields: { picks: nextPicks !== undefined },
      });

      // Set ETag for optimistic concurrency on subsequent updates
      if (profile.updatedAt) res.setHeader('ETag', `"${profile.updatedAt}"`);
      return sendSuccess(res, serializeOwnProfile(profile, await getUserById(profile.userId)));
    } catch (error) {
      log.error('profile update failed', { error: error.message, profileId: req.params.id });
      return sendError(res, 500, 'Failed to update profile', ErrorCodes.INTERNAL_ERROR);
    }
  }
  // Support both PUT and PATCH for compatibility with different HTTP clients. Both treat payloads as partial updates (merge semantics).
  router.put('/:id', userAuth, rateLimit(30, 'profile-update'), validateParams(schemas.profileIdParams), validate(schemas.profileUpdate), updateProfile);
  router.patch('/:id', userAuth, rateLimit(30, 'profile-update'), validateParams(schemas.profileIdParams), validate(schemas.profileUpdate), updateProfile);

  router.delete('/:id', adminAuth, rateLimit(5, 'profile-delete'), validateParams(schemas.profileIdParams), async (req, res) => {
    try {
      const profile = await stores.profiles.delete(req.validatedParams.id);

      if (!profile) return sendError(res, 404, 'Profile not found', ErrorCodes.NOT_FOUND);
      log.info('profile:deleted', { profileId: profile.id, festivalId: profile.festivalId, userId: profile.userId });
      removeProfileSockets(profile, io);
      emitter.profileDeleted({ festivalId: profile.festivalId, profileId: profile.id });
      return sendSuccess(res, { success: true });
    } catch (error) {
      log.error('profile delete failed', { error: error.message, profileId: req.params.id });
      return sendError(res, 500, 'Failed to delete profile', ErrorCodes.INTERNAL_ERROR);
    }
  });

  return router;
};
