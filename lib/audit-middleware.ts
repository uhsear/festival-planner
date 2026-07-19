// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export default function createAuditMiddleware(deps: any) {
  const { stores, log, getRequestIp } = deps;

  return (req: any, res: any, next: any) => {
    if (!MUTATING_METHODS.has(req.method)) {
      return next();
    }

    res.on('finish', () => {
      logAuditEntry(req, res, res.statusCode || 200);
    });

    return next();
  };

  async function logAuditEntry(req: any, res: any, statusCode: any) {
    try {
      const actor = extractActor(req);
      const target = extractTarget(req);
      const action = deriveAction(req, target);

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
        details_json: res.locals?.auditDetail ?? null,
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

    // Nested routers (every crew sub-router, mounted at '/' by
    // routes/crews.ts:161-168) register leaf paths as '/:crewId/polls', so
    // the resource name is never parts[0] -- walk past every leading :param
    // segment instead of only checking the first one.
    const resourceSegment = parts.find((part: string) => !part.startsWith(':'));
    const type = resourceSegment || 'unknown';

    let id = null;
    const routeParamKeys = Object.keys(req.params || {});
    if (routeParamKeys.length > 0) {
      id = req.params[routeParamKeys[0]!];
    }

    return { type, id };
  }

  function deriveAction(req: any, target: any) {
    // Reuse extractTarget's resolved resource name instead of re-deriving it
    // from the path independently -- that duplicate logic used to skip the
    // ':'-prefix check entirely, producing garbage like 'create::crewid'.
    const verb = getVerbForMethod(req.method);
    return `${verb}:${target.type}`.toLowerCase();
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
