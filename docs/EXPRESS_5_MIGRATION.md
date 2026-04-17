# Express 5.x Migration Plan

**Status**: Planned (Phase 3)
**Risk**: LOW — codebase is already well-aligned with Express 5 patterns
**Estimated effort**: 2-4 hours (reduced from initial 8h estimate after audit)
**Current version**: express ~4.22.1
**Target version**: express ^5.0.0

## Pre-Migration Audit Results

### No Changes Required
- **Route methods**: All routes use `router.delete()` (not deprecated `app.del()`)
- **Response signatures**: Correct `res.status(n).json(body)` pattern throughout
- **Route patterns**: No regex anchors in routes; standard `:param` syntax only
- **`app.param()`**: Not used
- **`req.host`**: Not used (uses `req.get('host')` which works in both versions)
- **Body parsing**: Custom `express.json()` wrapper handles both error types
- **Error middleware**: 4-parameter `(error, req, res, next)` signature present
- **Promise handling**: All async handlers have try-catch (Express 5 auto-catches but this is safe)

### Required Changes

#### 1. Query parser configuration (HIGH)
Express 5 does not parse query strings by default. Add after `const app = express()`:
```javascript
app.set('query parser', 'simple'); // or 'qs' for nested object support
```
**Affected files**: routes/admin.js, routes/festivals.js, routes/profiles.js use `req.query.*`

#### 2. Update package.json (HIGH)
```diff
-    "express": "~4.22.1",
+    "express": "^5.0.0",
```

#### 3. Verify swagger-ui-express compatibility (MEDIUM)
swagger-ui-express@5.x should work, but test the `/api-docs` endpoint post-upgrade.
Existing error-handling fallback in health.js already guards against failures.

## Migration Steps

1. **Branch**: `feat/express-5`
2. **Bump**: `npm install express@5`
3. **Add query parser**: `app.set('query parser', 'simple')` in server.js
4. **Run test suite**: `npm test` — all 6 test files must pass
5. **Manual smoke test**: Admin panel, auth flows, Socket.IO, export
6. **Deploy**: Standard deploy pipeline

## Rollback Plan
Revert to express@4.22.1 — no database or data migration involved.
