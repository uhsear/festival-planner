// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function createAuditMiddleware(deps) {
  const { stores, log, getRequestIp } = deps;

  return (req, res, next) => {
    if (!MUTATING_METHODS.has(req.method)) {
      return next();
    }

    let responseStatus = 200;
    let _responseJson = null;

    const originalJson = res.json;
    res.json = function(data) {
      _responseJson = data;
      return originalJson.call(this, data);
    };

    res.on('finish', () => {
      responseStatus = res.statusCode || 200;
      logAuditEntry(req, responseStatus);
    });

    return next();
  };

  async function logAuditEntry(req, statusCode) {
    try {
      const actor = extractActor(req);
      const target = extractTarget(req);
      const action = deriveAction(req);

      const entry = {
        id: req.id,
        actor_type: actor.type,
        actor_id: actor.id,
        action,
        target_type: target.type,
        target_id: target.id,
        user_agent: req.get('user-agent') || null,
        request_id: req.id,
        ip: getRequestIp(req),
        status: statusCode >= 200 && statusCode < 300 ? 'success' : 'failure',
        details_json: null,
      };

      await stores.auditLog.insert(entry);
    } catch (error) {
      log.error('audit-middleware:insert-failed', { error: error.message });
    }
  }

  function extractActor(req) {
    if (req.user?.userId) {
      return { type: 'user', id: req.user.userId };
    }
    if (req.adminSession) {
      return { type: 'admin', id: 'admin' };
    }
    return { type: 'system', id: null };
  }

  function extractTarget(req) {
    if (!req.route) {
      return { type: null, id: null };
    }

    const routePath = req.route.path || '';
    const parts = routePath.split('/').filter(Boolean);

    let type = null;
    if (parts.length >= 1) {
      type = parts[0].replace(/^:/, '');
    }

    let id = null;
    const routeParamKeys = Object.keys(req.params || {});
    if (routeParamKeys.length > 0) {
      id = req.params[routeParamKeys[0]];
    }

    return { type, id };
  }

  function deriveAction(req) {
    const method = req.method;
    const routePath = req.route?.path || req.path;

    const resourceMatch = routePath.split('/').filter(Boolean)[0] || 'unknown';
    const verb = getVerbForMethod(method);

    return `${verb}:${resourceMatch}`.toLowerCase();
  }

  function getVerbForMethod(method) {
    switch (method) {
      case 'POST':
        return 'create';
      case 'PUT':
        return 'replace';
      case 'PATCH':
        return 'update';
      case 'DELETE':
        return 'delete';
      default:
        return method.toLowerCase();
    }
  }
}

module.exports = createAuditMiddleware;
