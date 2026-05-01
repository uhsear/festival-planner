/**
 * Crew features — meeting points + polls
 * Extracted from routes/crews.js to reduce file size.
 */
'use strict';

const MAX_MEETING_POINTS_PER_CREW = 20;

module.exports = function mountCrewFeatures(router, deps) {
  const {
    stores, userAuth, sendSuccess, sendError, ErrorCodes,
    rateLimit, log, io, validate, schemas,
    sanitizeIdentifier, createOpaqueId,
  } = deps;

  // ── PUT /:crewId/home-base — set crew meeting point ─────────────
  router.put('/:crewId/home-base', userAuth, rateLimit(10, 'crew-homebase'), validate(schemas.crewHomeBase), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);
      const member = await stores.crews.getMember(crewId, req.user.userId);
      if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
      if (member.role !== 'owner') return sendError(res, 403, 'Only owner can set home base', ErrorCodes.FORBIDDEN);

      const { location, time } = req.validatedBody;
      const updated = await stores.crews.updateHomeBase(crewId, { location, time });
      io.to('crew:' + crewId).emit('crew:home-base-updated', { crewId, location, time });
      await stores.activity.log({ crewId, userId: req.user.userId, type: 'home-base-updated', detail: location || null }).catch(()=>{});
      return sendSuccess(res, { crew: updated });
    } catch (err) {
      log.error('set home base failed', { error: err.message });
      return sendError(res, 500, 'Failed to update home base', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── GET /:crewId/meeting-points ─────────────────────────────────
  router.get('/:crewId/meeting-points', userAuth, rateLimit(120, 'crew-mp-list'), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);
      const member = await stores.crews.getMember(crewId, req.user.userId);
      if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
      const points = await stores.crews.meetingPoints.listByCrew(crewId);
      return sendSuccess(res, { meetingPoints: points });
    } catch (err) {
      log.error('get meeting points failed', { error: err.message });
      return sendError(res, 500, 'Failed to load meeting points', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── POST /:crewId/meeting-points ────────────────────────────────
  router.post('/:crewId/meeting-points', userAuth, rateLimit(20, 'crew-mp-create'), validate(schemas.meetingPointCreate), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId);
      if (!crewId) return sendError(res, 400, 'Invalid crew ID', ErrorCodes.INVALID_INPUT);
      const member = await stores.crews.getMember(crewId, req.user.userId);
      if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

      const count = await stores.crews.meetingPoints.countByCrew(crewId);
      if (count >= MAX_MEETING_POINTS_PER_CREW) {
        return sendError(res, 400, 'Maximum ' + MAX_MEETING_POINTS_PER_CREW + ' meeting points per crew', ErrorCodes.VALIDATION_ERROR);
      }

      const { label, location, type, meetAt, stageReference } = req.validatedBody;
      const id = createOpaqueId('mp');
      let expiresAt = null;
      if (meetAt) {
        expiresAt = new Date(new Date(meetAt).getTime() + 30 * 60_000).toISOString();
      }

      const point = await stores.crews.meetingPoints.create({
        id, crewId, createdBy: req.user.userId,
        label, location, type: type || 'during', meetAt, stageReference, expiresAt,
      });

      io.to('crew:' + crewId).emit('crew:meeting-point-created', point);
      return sendSuccess(res, { meetingPoint: point }, 201);
    } catch (err) {
      log.error('create meeting point failed', { error: err.message });
      return sendError(res, 500, 'Failed to create meeting point', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── PUT /:crewId/meeting-points/:mpId ───────────────────────────
  router.put('/:crewId/meeting-points/:mpId', userAuth, rateLimit(20, 'crew-mp-update'), validate(schemas.meetingPointUpdate), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId);
      const mpId = sanitizeIdentifier(req.params.mpId);
      if (!crewId || !mpId) return sendError(res, 400, 'Invalid ID', ErrorCodes.INVALID_INPUT);

      const member = await stores.crews.getMember(crewId, req.user.userId);
      if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

      const existing = await stores.crews.meetingPoints.getById(mpId);
      if (!existing || existing.crewId !== crewId || !existing.active) {
        return sendError(res, 404, 'Meeting point not found', ErrorCodes.NOT_FOUND);
      }

      if (existing.createdBy !== req.user.userId && member.role !== 'owner') {
        return sendError(res, 403, 'Only the creator or crew owner can edit', ErrorCodes.FORBIDDEN);
      }

      const updated = await stores.crews.meetingPoints.update(mpId, req.validatedBody);
      io.to('crew:' + crewId).emit('crew:meeting-point-updated', updated);
      return sendSuccess(res, { meetingPoint: updated });
    } catch (err) {
      log.error('update meeting point failed', { error: err.message });
      return sendError(res, 500, 'Failed to update meeting point', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── DELETE /:crewId/meeting-points/:mpId ────────────────────────
  router.delete('/:crewId/meeting-points/:mpId', userAuth, rateLimit(20, 'crew-mp-delete'), async (req, res) => {
    try {
      const crewId = sanitizeIdentifier(req.params.crewId);
      const mpId = sanitizeIdentifier(req.params.mpId);
      if (!crewId || !mpId) return sendError(res, 400, 'Invalid ID', ErrorCodes.INVALID_INPUT);

      const member = await stores.crews.getMember(crewId, req.user.userId);
      if (!member) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

      const existing = await stores.crews.meetingPoints.getById(mpId);
      if (!existing || existing.crewId !== crewId || !existing.active) {
        return sendError(res, 404, 'Meeting point not found', ErrorCodes.NOT_FOUND);
      }

      if (existing.createdBy !== req.user.userId && member.role !== 'owner') {
        return sendError(res, 403, 'Only the creator or crew owner can remove', ErrorCodes.FORBIDDEN);
      }

      await stores.crews.meetingPoints.deactivate(mpId);
      io.to('crew:' + crewId).emit('crew:meeting-point-removed', { id: mpId, crewId });
      return sendSuccess(res, { removed: true });
    } catch (err) {
      log.error('delete meeting point failed', { error: err.message });
      return sendError(res, 500, 'Failed to remove meeting point', ErrorCodes.INTERNAL_ERROR);
    }
  });

  // ── Poll routes (Phase 2C) ─────────────────────────────────────

  router.get('/:crewId/polls', userAuth, rateLimit(120, 'crew-poll-list'), async (req, res) => {
    try {
      const { crewId } = req.params;
      const userId = req.user.userId;
      const membership = await stores.crews.getMember(crewId, userId);
      if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
      const polls = await stores.polls.listByCrew(crewId);
      sendSuccess(res, { polls });
    } catch (err) {
      log.error('get polls error', { error: err.message, crewId: req.params.crewId });
      sendError(res, 500, 'Failed to list polls', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/:crewId/polls', userAuth, rateLimit(10, 'crew-poll-create'), validate(schemas.pollCreate), async (req, res) => {
    try {
      const { crewId } = req.params;
      const { question, options, closesAt } = req.validatedBody;
      const userId = req.user.userId;

      if (!question || !Array.isArray(options) || options.length < 2 || options.length > 4) {
        return sendError(res, 400, 'Invalid poll data', ErrorCodes.INVALID_INPUT);
      }

      const membership = await stores.crews.getMember(crewId, userId);
      if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

      const activePollCount = await stores.polls.countActiveByCrew(crewId);
      if (activePollCount >= 3) return sendError(res, 409, 'Max 3 active polls per crew', ErrorCodes.CONFLICT);

      const poll = await stores.polls.create({
        crewId, createdBy: userId, question, options,
        closesAt: closesAt ? new Date(closesAt) : null,
      });

      io.to('crew:' + crewId).emit('crew:poll-created', {
        pollId: poll.id, question: poll.question, options: poll.options, createdBy: userId,
      });
      await stores.activity.log({ crewId, userId, type: 'poll-created', detail: poll.question.slice(0, 100) }).catch(()=>{});
      sendSuccess(res, { poll });
    } catch (err) {
      log.error('create poll error', { error: err.message });
      sendError(res, 500, 'Failed to create poll', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.post('/:crewId/polls/:pollId/vote', userAuth, rateLimit(60, 'crew-poll-vote'), validate(schemas.pollVote), async (req, res) => {
    try {
      const { crewId, pollId } = req.params;
      const { optionIndex } = req.validatedBody;
      const userId = req.user.userId;

      if (!Number.isInteger(optionIndex) || optionIndex < 0) {
        return sendError(res, 400, 'Invalid option', ErrorCodes.INVALID_INPUT);
      }

      const membership = await stores.crews.getMember(crewId, userId);
      if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

      const poll = await stores.polls.getById(pollId);
      if (!poll || poll.crew_id !== crewId) return sendError(res, 404, 'Poll not found', ErrorCodes.NOT_FOUND);
      if (optionIndex >= poll.options.length) return sendError(res, 400, 'Invalid option index', ErrorCodes.INVALID_INPUT);

      await stores.polls.vote(pollId, userId, optionIndex);
      io.to('crew:' + crewId).emit('crew:poll-voted', { pollId, userId, optionIndex });
      await stores.activity.log({ crewId, userId, type: 'poll-voted', detail: poll.options[optionIndex] || null }).catch(()=>{});
      sendSuccess(res, { voted: true });
    } catch (err) {
      log.error('vote error', { error: err.message });
      sendError(res, 500, 'Failed to vote', ErrorCodes.INTERNAL_ERROR);
    }
  });

  router.delete('/:crewId/polls/:pollId', userAuth, rateLimit(10, 'crew-poll-delete'), async (req, res) => {
    try {
      const { crewId, pollId } = req.params;
      const userId = req.user.userId;

      const membership = await stores.crews.getMember(crewId, userId);
      if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

      const poll = await stores.polls.getById(pollId);
      if (!poll || poll.crew_id !== crewId) return sendError(res, 404, 'Poll not found', ErrorCodes.NOT_FOUND);
      if (poll.created_by !== userId && membership.role !== 'owner') {
        return sendError(res, 403, 'Only creator or owner can close poll', ErrorCodes.FORBIDDEN);
      }

      const closed = await stores.polls.close(pollId);
      io.to('crew:' + crewId).emit('crew:poll-closed', { pollId });
      sendSuccess(res, { closed });
    } catch (err) {
      log.error('close poll error', { error: err.message });
      sendError(res, 500, 'Failed to close poll', ErrorCodes.INTERNAL_ERROR);
    }
  });
};
