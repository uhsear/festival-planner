// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

const { openPlannerDatabase, parseJsonObject, serializeJson, withTransaction } = require('./connection');
const createUtils = require('./utils');
const createUsersStore = require('./stores/users');
const createFestivalsStore = require('./stores/festivals');
const createProfilesStore = require('./stores/profiles');
const createCrewsStore = require('./stores/crews');
const createSessionsStore = require('./stores/sessions');
const createNotificationsStore = require('./stores/notifications');
const createAuditStore = require('./stores/audit');
const createRolesStore = require('./stores/roles');
const createPollsStore = require('./stores/polls');
const { createRatingsStore } = require('./stores/ratings');
const { createExpensesStore } = require('./stores/expenses');
const { createActivityStore } = require('./stores/activity');
const { createCalendarTokensStore } = require('./stores/calendar-tokens');
const { createEmailTokensStore } = require('./stores/email-tokens');
const { createDbLatencyTracker } = require('./latency');
const { createLogger } = require('../logger');

const log = createLogger('db:cleanup');

/**
 * Returns true if THIS process should run singleton background jobs
 * (expired-token cleanup, etc.). In PM2 cluster mode, instance 0 is the
 * leader. In single-process / dev, NODE_APP_INSTANCE is unset — treat as
 * leader so cleanup still runs.
 *
 * Matches the pattern used by the reminder scheduler (Agent 2 fix).
 */
function isCleanupLeader() {
  const instance = process.env.NODE_APP_INSTANCE;
  if (instance === undefined || instance === null || instance === '') return true;
  return instance === '0';
}

/**
 * Create data access stores for all database entities
 * Each store provides async CRUD operations for its table(s)
 * @param {Pool} pool - PostgreSQL connection pool
 * @returns {Object} - Store objects {users, profiles, festivals, sessions, etc.}
 */
function createStores(pool, { nodeEnv } = {}) {
  const utils = createUtils(pool);

  const users = createUsersStore(pool, utils);
  const festivals = createFestivalsStore(pool, utils);

  const profilesResult = createProfilesStore(pool, utils);
  const profiles = profilesResult.profiles;
  const picks = profilesResult.picks;


  const crewsResult = createCrewsStore(pool, utils);
  const crews = crewsResult.crews;
  const topicSubscriptions = crewsResult.topicSubscriptions;
  crews.meetingPoints = crewsResult.meetingPoints;

  const sessions = createSessionsStore(pool, utils);
  const refreshTokens = sessions.refreshTokens;
  const loginFailures = sessions.loginFailures;
  const metricsRollups = sessions.metricsRollups;

  const notificationsResult = createNotificationsStore(pool, utils);
  const deviceTokens = notificationsResult.deviceTokens;
  const notificationPrefs = notificationsResult.notificationPrefs;
  const notificationLog = notificationsResult.notificationLog;
  const notificationCounts = notificationsResult.notificationCounts;

  const auditLog = createAuditStore(pool, utils);
  const roles = createRolesStore(pool, { nodeEnv });
  const polls = createPollsStore(pool, utils);
  const ratings = createRatingsStore(pool);
  const expenses = createExpensesStore(pool);
  const activity = createActivityStore(pool);
  const calendarTokens = createCalendarTokensStore(pool);
  const emailTokens = createEmailTokensStore(pool);

  return {
    pool,
    users,
    festivals,
    profiles,
    picks,
    sessions,
    deviceTokens,
    notificationPrefs,
    notificationLog,
    notificationCounts,
    topicSubscriptions,
    crews,
    auditLog,
    roles,
    polls,
    ratings,
    expenses,
    activity,
    calendarTokens,
    refreshTokens,
    loginFailures,
    metricsRollups,
    emailTokens,

    async counts() {
      const result = await pool.query('SELECT COUNT(*) AS count FROM festivals WHERE deleted_at IS NULL');
      const festivalCount = parseInt(result.rows[0].count, 10);
      const sessionCounts = await sessions.counts();
      return {
        festivals: festivalCount,
        ...sessionCounts,
      };
    },

    createCleanupTimer(sessionTtlMs = 24 * 60 * 60 * 1000) {
      /**
       * Returns a cleanup function that can be called on a timer.
       * Removes expired device tokens and stale sessions.
       *
       * Leader election (2026-04-14 audit fix): in PM2 cluster mode we have
       * 4 workers. Previously each worker ran this on an interval, producing
       * 4x DB load and write contention. Now only NODE_APP_INSTANCE='0'
       * actually performs the deletes; other workers return a no-op and log
       * once at startup.
       *
       * Interval behaviour (1h sessions etc.) is unchanged — the CALLER
       * wraps this in setInterval. This function just returns the worker.
       */
      const leader = isCleanupLeader();
      if (!leader) {
        log.info('cleanup skipped on this instance (not leader)', {
          nodeAppInstance: process.env.NODE_APP_INSTANCE,
        });
        // No-op cleanup for follower workers. Preserves the async contract
        // so callers can still `await` it without branching.
        return async () => { /* not leader — cleanup runs on instance 0 */ };
      }

      log.info('cleanup enabled on this instance (leader)', {
        nodeAppInstance: process.env.NODE_APP_INSTANCE ?? '(unset)',
      });

      return async () => {
        try {
          await deviceTokens.deleteExpired();
        } catch { /* ignore cleanup errors */ }
        try {
          await sessions.deleteExpiredUserSessions(sessionTtlMs);
        } catch { /* ignore cleanup errors */ }
        // admin_sessions table removed in migration 011 (roles-based auth)
        try {
          if (refreshTokens) await refreshTokens.deleteExpired();
        } catch { /* ignore cleanup errors */ }
      };
    },
  };
}

async function importLegacyDataToPostgres({ databaseUrl }) {
  const { pool } = openPlannerDatabase({ databaseUrl });
  const _stores = createStores(pool);

  // This function would be called with legacy JSON data
  // For now, just validate that the pool works
  try {
    const _result = await pool.query('SELECT 1');
    return { success: true };
  } finally {
    await pool.end();
  }
}

module.exports = {
  createStores,
  createDbLatencyTracker,
  importLegacyDataToPostgres,
  openPlannerDatabase,
  parseJsonObject,
  serializeJson,
  withTransaction,
};
