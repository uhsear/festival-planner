# ADR-009: Dependency Injection via Route Factory Functions Receiving a deps Object

**Status:** Accepted
**Date:** 2026-06-19

## Context

Express applications commonly use module-level singletons (a global `db` import, a global `redis`
import) or framework-provided IoC containers. Both approaches make unit testing difficult —
swapping a real database for a test double requires either monkey-patching module exports or a
mocking framework with module-level intercept capabilities. The backend has 37 route modules and a
growing test suite that exercises them in isolation with injected test doubles.

An alternative was a class-based DI container (InversifyJS, tsyringe), but these add significant
boilerplate and decorator-based metadata that conflicts with the ESM-first, decorator-free
codebase.

## Decision

Every route module exports a single factory function that receives a `deps` object (the app
context assembled in `lib/app-context/index.ts`) and returns an Express `Router`. The canonical
signature is:

```ts
export default function createFeatureRoutes(
  { pool, redis, config, io, log, stores, schemas, ... }: AppContext
): Router {
  const router = Router();
  // handlers close over deps
  return router;
}
```

`lib/app-context/index.ts` is the single composition root: it creates the pg pool, Redis client,
all store factories, session helpers, rate limiters, and utility functions, then assembles them
into the context object. `server.ts` calls `createAppContext()` once, passes the result to each
route factory, and mounts the returned routers. Socket.IO is wired in separately via
`configureSocketIO(app, ctx)` and injected back via `ctx.setIO(io)` before route mounting.

## Consequences

- Route modules are pure functions of their dependencies; tests pass lightweight stubs without
  module mocking infrastructure.
- The dependency graph is explicit and flat — all wiring is visible in `lib/app-context/index.ts`
  and `server.ts`. There are no hidden singleton imports.
- The app context type is the single authoritative surface for what every route can access; adding
  a new infrastructure dependency requires updating this type and the composition root before any
  route can use it.
- Trade-off: the context object is large (pool, redis, config, io, log, stores, schemas, rate
  limiters, auth helpers, utility functions, and more). Routes destructure only what they need, but
  the full object is always passed, which obscures which routes actually depend on which services.
- Trade-off: the factory pattern is unusual for Express codebases; engineers familiar with Express
  middleware conventions (global `app.locals`, singleton imports) require a brief orientation.
- Trade-off: Socket.IO is created after the initial `createAppContext()` call (because it needs
  the Express app), requiring a `setIO` callback to avoid circular initialization — this `_io`
  late-binding is a documented quirk in the composer's comments.
