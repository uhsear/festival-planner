/**
 * Socket presence management — tracks online users per festival room.
 * Supports Redis-backed cross-worker presence with in-memory fallback.
 */
export function createPresenceManager({ state, redisPresence, redis, log, getUserMap, buildAvatarUrl }: any) {

  function removeSocketPresence(socket: any) {
    const festivalId = socket.data?.festivalId;
    if (!festivalId) return null;
    const room = state.onlineUsers.get(festivalId);
    if (room) {
      room.delete(socket.id);
      if (room.size === 0) state.onlineUsers.delete(festivalId);
    }
    if (redisPresence) {
      redisPresence.setOffline(festivalId, socket.id).catch((err: any) => {
        log.debug('redis presence setOffline failed', { error: err.message });
      });
    }
    log.info('presence: user left', { festivalId, socketId: socket.id, userId: socket.data?.userId });
    socket.data.festivalId = null;
    return festivalId;
  }

  async function setSocketPresence(festivalId: any, userId: any, username: any, socketId: any) {
    if (!state.onlineUsers.has(festivalId)) {
      state.onlineUsers.set(festivalId, new Map());
    }
    state.onlineUsers.get(festivalId).set(socketId, { userId, username });
    log.info('presence: user joined', { festivalId, userId, username, socketId });
    if (redisPresence) {
      try {
        await redisPresence.setOnline(festivalId, userId, username, socketId);
      } catch (err: any) {
        log.debug('redis presence setOnline failed', { error: err.message });
      }
    }
  }

  async function getPresenceList(festivalId: any) {
    if (redisPresence) {
      try {
        const entries = await redisPresence.getOnline(festivalId);
        const usersById = await getUserMap();
        return entries.map(({ userId, username }: any) => ({
          userId,
          username,
          avatarUrl: buildAvatarUrl(usersById.get(userId)),
        }));
      } catch (err: any) {
        log.debug('redis presence getOnline failed, using local', { error: err.message });
      }
    }
    const room = state.onlineUsers.get(festivalId);
    if (!room) return [];
    const usersById = await getUserMap();
    const seen = new Set();
    const online: any[] = [];
    for (const { userId, username } of room.values()) {
      if (seen.has(userId)) continue;
      seen.add(userId);
      online.push({ userId, username, avatarUrl: buildAvatarUrl(usersById.get(userId)) });
    }
    return online;
  }

  const _presenceDebounce = new Map();
  function emitPresence(festivalId: any, io: any) {
    if (_presenceDebounce.has(festivalId)) clearTimeout(_presenceDebounce.get(festivalId));
    _presenceDebounce.set(festivalId, setTimeout(async () => {
      _presenceDebounce.delete(festivalId);
      try {
        const online = await getPresenceList(festivalId);
        io.to(festivalId).emit('presence:update', { online });
      } catch (err: any) {
        log.warn('emitPresence failed', { festivalId, error: err.message });
      }
    }, 200));
  }

  function clearPresenceTimers() {
    for (const timer of _presenceDebounce.values()) clearTimeout(timer);
    _presenceDebounce.clear();
  }

  async function emitProfileIdentity(user: any, io: any, getProfiles: any) {
    const avatarUrl = buildAvatarUrl(user);
    const allProfiles = await getProfiles();
    const profiles = allProfiles.filter((profile: any) => profile.userId === user.id);
    const festivals = new Set();
    for (const profile of profiles) {
      festivals.add(profile.festivalId);
      io.to(profile.festivalId).emit('profile:identity', {
        festivalId: profile.festivalId,
        profileId: profile.id,
        username: user.username,
        avatarUrl,
      });
    }
    for (const festivalId of festivals) emitPresence(festivalId, io);
  }

  function clearSocketSession(socket: any) {
    socket.data.userId = null;
    socket.data.username = null;
    socket.data.festivalId = null;
    socket.data.profileId = null;
    socket.data.userSessionToken = null;
  }

  function leaveFestivalRealtime(socket: any, io: any, presenceTargets: any = null) {
    const festivalId = removeSocketPresence(socket);
    if (!festivalId) return null;
    if (presenceTargets) presenceTargets.add(festivalId);
    socket.leave(festivalId);
    socket.data.profileId = null;
    return festivalId;
  }

  function disconnectSocket(socket: any, io: any, presenceTargets: any = null) {
    leaveFestivalRealtime(socket, io, presenceTargets);
    clearSocketSession(socket);
    socket.disconnect(true);
  }

  function disconnectUserSockets(userId: any, io: any) {
    const presenceTargets = new Set();
    for (const socket of Array.from(io.of('/').sockets.values()) as any[]) {
      if (socket.data?.userId !== userId) continue;
      disconnectSocket(socket, io, presenceTargets);
    }
    if (presenceTargets.size > 0) log.info('presence: disconnected all sockets for user', { userId, festivals: [...presenceTargets] });
    for (const festivalId of presenceTargets) emitPresence(festivalId, io);
  }

  function disconnectSessionTokens(tokens: any, io: any) {
    const tokenSet = new Set((tokens || []).filter(Boolean));
    if (tokenSet.size === 0) return;
    const presenceTargets = new Set();
    for (const socket of Array.from(io.of('/').sockets.values()) as any[]) {
      if (!tokenSet.has(socket.data?.userSessionToken)) continue;
      disconnectSocket(socket, io, presenceTargets);
    }
    for (const festivalId of presenceTargets) emitPresence(festivalId, io);
  }

  function removeFestivalSockets(festivalId: any, io: any) {
    const presenceTargets = new Set();
    for (const socket of Array.from(io.of('/').sockets.values()) as any[]) {
      if (socket.data?.festivalId !== festivalId) continue;
      leaveFestivalRealtime(socket, io, presenceTargets);
      socket.emit('festival:access-revoked', { festivalId });
    }
    state.onlineUsers.delete(festivalId);
    if (redisPresence && redis) {
      redis.del(`presence:${festivalId}`).catch(() => {});
    }
    for (const targetFestivalId of presenceTargets) emitPresence(targetFestivalId, io);
  }

  function removeProfileSockets(profile: any, io: any) {
    if (!profile?.userId || !profile?.festivalId) return;
    const presenceTargets = new Set();
    for (const socket of Array.from(io.of('/').sockets.values()) as any[]) {
      if (socket.data?.userId !== profile.userId || socket.data?.festivalId !== profile.festivalId) continue;
      leaveFestivalRealtime(socket, io, presenceTargets);
      socket.emit('festival:access-revoked', { festivalId: profile.festivalId, profileId: profile.id });
    }
    for (const festivalId of presenceTargets) emitPresence(festivalId, io);
  }

  return {
    removeSocketPresence,
    setSocketPresence,
    getPresenceList,
    emitPresence,
    clearPresenceTimers,
    emitProfileIdentity,
    clearSocketSession,
    leaveFestivalRealtime,
    disconnectSocket,
    disconnectUserSockets,
    disconnectSessionTokens,
    removeFestivalSockets,
    removeProfileSockets,
  };
}
