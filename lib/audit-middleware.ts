// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export default function createAuditMiddleware(deps: any) {
  const { stores, log, getRequestIp } = deps;

  return (req: any, res: any, next: any) => {
    if (!MUTATING_METHODS.has(req.method)) {
      return next();
    }

    let responseStatus = 200;
    let _responseJson: any = null;

    const originalJson = res.json;
    res.json = function(data: any) {
      _responseJson = data;
      return originalJson.call(this, data);
    };

    res.on('finish', () => {
      responseStatus = res.statusCode || 200;
      logAuditEntry(req, responseStatus);
    });

    return next();
  };

  async function logAuditEntry(req: any, statusCode: any) {
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
    } catch (error: any) {
      log.error('audit-middleware:insert-failed', { error: error.message });
    }
  }

  function extractActor(req: any) {
    if (req.user?.userId) {
      return { type: 'user', id: req.user.userId };
    }
    if (req.adminSession) {
      return { type: 'admin', id: 'admin' };
    }
    return { type: 'system', id: null };
  }

  function extractTarget(req: any) {
    if (!req.route) {
      return { type: 'unknown', id: null };
    }

    const routePath = req.route.path || '';
    const parts = routePath.split('/').filter(Boolean);

    let type = 'unknown';
    if (parts.length >= 1 && parts[0] && !parts[0].startsWith(':')) {
      type = parts[0];
    }

    let id = null;
    const routeParamKeys = Object.keys(req.params || {});
    if (routeParamKeys.length > 0) {
      id = req.params[routeParamKeys[0]!];
    }

    return { type, id };
  }

  function deriveAction(req: any) {
    const method = req.method;
    const routePath = req.route?.path || req.path;

    const resourceMatch = routePath.split('/').filter(Boolean)[0] || 'unknown';
    const verb = getVerbForMethod(method);

    return `${verb}:${resourceMatch}`.toLowerCase();
  }

  function getVerbForMethod(method: any) {
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
