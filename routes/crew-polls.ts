import { Router } from 'express';

export default function createCrewPollRoutes(deps: any) {
  const {
    log,
    userAuth,
    sanitizeIdentifier,
    sendSuccess,
    sendError,
    ErrorCodes,
    rateLimit,
    stores,
    schemas,
    validate,
    validateParams,
    io,
  } = deps;

  const router = Router({ mergeParams: true });

  // ── GET /:crewId/polls ─────────────────────────────────────────
  router.get(
    '/:crewId/polls',
    userAuth,
    rateLimit(120, 'crew-poll-list'),
    validateParams(schemas.crewIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const userId = req.user.userId;
        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);
        const polls = await stores.polls.listByCrew(crewId);
        return sendSuccess(res, { polls });
      } catch (err: any) {
        log.error('get polls error', { error: err.message, crewId: req.validatedParams?.crewId });
        return sendError(res, 500, 'Failed to list polls', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /:crewId/polls ────────────────────────────────────────
  router.post(
    '/:crewId/polls',
    userAuth,
    rateLimit(10, 'crew-poll-create'),
    validateParams(schemas.crewIdParams),
    validate(schemas.pollCreate),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const { question, options, closesAt } = req.validatedBody;
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const activePollCount = await stores.polls.countActiveByCrew(crewId);
        if (activePollCount >= 3) return sendError(res, 409, 'Max 3 active polls per crew', ErrorCodes.CONFLICT);

        const poll = await stores.polls.create({
          crewId,
          createdBy: userId,
          question,
          options,
          closesAt: closesAt ? new Date(closesAt) : null,
        });

        io.to('crew:' + crewId).emit('crew:poll-created', {
          pollId: poll.id,
          question: poll.question,
          options: poll.options,
          createdBy: userId,
        });
        await stores.activity
          .log({ crewId, userId, type: 'poll-created', detail: poll.question.slice(0, 100) })
          .catch(() => {});
        return sendSuccess(res, { poll });
      } catch (err: any) {
        log.error('create poll error', { error: err.message });
        return sendError(res, 500, 'Failed to create poll', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── POST /:crewId/polls/:pollId/vote ───────────────────────────
  router.post(
    '/:crewId/polls/:pollId/vote',
    userAuth,
    rateLimit(60, 'crew-poll-vote'),
    validateParams(schemas.crewIdPollIdParams),
    validate(schemas.pollVote),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const pollId = sanitizeIdentifier(req.validatedParams.pollId);
        const { optionIndex } = req.validatedBody;
        const userId = req.user.userId;

        const membership = await stores.crews.getMember(crewId, userId);
        if (!membership) return sendError(res, 403, 'Not a crew member', ErrorCodes.FORBIDDEN);

        const poll = await stores.polls.getById(pollId);
        if (!poll || poll.crew_id !== crewId) return sendError(res, 404, 'Poll not found', ErrorCodes.NOT_FOUND);
        if (optionIndex >= poll.options.length)
          return sendError(res, 400, 'Invalid option index', ErrorCodes.INVALID_INPUT);
        if (poll.closed || (poll.closes_at && new Date(poll.closes_at) <= new Date()))
          return sendError(res, 409, 'Poll is closed', ErrorCodes.CONFLICT);

        await stores.polls.vote(pollId, userId, optionIndex);
        io.to('crew:' + crewId).emit('crew:poll-voted', { pollId, userId, optionIndex });
        await stores.activity
          .log({ crewId, userId, type: 'poll-voted', detail: poll.options[optionIndex] || null })
          .catch(() => {});
        return sendSuccess(res, { voted: true });
      } catch (err: any) {
        log.error('vote error', { error: err.message });
        return sendError(res, 500, 'Failed to vote', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  // ── DELETE /:crewId/polls/:pollId — Close a poll ───────────────
  router.delete(
    '/:crewId/polls/:pollId',
    userAuth,
    rateLimit(10, 'crew-poll-delete'),
    validateParams(schemas.crewIdPollIdParams),
    async (req: any, res: any) => {
      try {
        const crewId = sanitizeIdentifier(req.validatedParams.crewId);
        const pollId = sanitizeIdentifier(req.validatedParams.pollId);
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
        return sendSuccess(res, { closed });
      } catch (err: any) {
        log.error('close poll error', { error: err.message });
        return sendError(res, 500, 'Failed to close poll', ErrorCodes.INTERNAL_ERROR);
      }
    },
  );

  return router;
}
