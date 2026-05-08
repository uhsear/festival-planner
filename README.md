# Festie

Real-time festival crew coordination app. Create festivals, pick sets from the lineup, coordinate with your crew via live chat, and export personalized schedules. Offline-first with WebSocket-driven updates.

**Live at [festie.us](https://festie.us)**

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 22, Express 5, Socket.IO 4 |
| Database | PostgreSQL 16, Redis 7 |
| Frontend | React 19, Vite 8, TypeScript, TanStack Router, Zustand, Tailwind CSS 4 |
| Monorepo | pnpm workspaces + Turborepo |
| Testing | Node built-in test runner, Playwright |
| Deployment | PM2 cluster, Cloudflare Tunnel, Docker |

## Prerequisites

- **Node.js** >= 20 (22 recommended)
- **PostgreSQL** 16+
- **Redis** 7+ (required for cluster mode; optional for single-process dev)
- **pnpm** >= 9 (for frontend/shared packages)
- **npm** (for backend root)

## Getting Started

```bash
# Clone
git clone https://github.com/uhsear/festival-planner.git
cd festival-planner

# Install backend dependencies
npm install

# Install frontend/shared dependencies
pnpm install --filter @festie/web --filter @festie/shared

# Create .env from example
cp .env.example .env
# Edit .env with your DATABASE_URL, SESSION_SECRET, etc.

# Run database migrations
# Migrations run automatically on server start via lib/planner-db-pg.js

# Start development (backend + frontend with hot reload)
npm run dev
```

The dev server starts the Express backend and proxies the Vite frontend. Open `http://localhost:4000` (or your configured PORT).

## Scripts

### Backend (root -- npm)

| Command | Description |
|---------|-------------|
| `npm run dev` | Backend + Vite frontend (proxied) |
| `npm start` | Backend only |
| `npm test` | All backend tests (sequential, ~28 files) |
| `npm run test:unit` | Unit tests only |
| `npm run test:e2e` | Playwright E2E tests |
| `npm run test:coverage` | c8 coverage (text + lcov + json-summary) |
| `npm run lint` | ESLint on lib/, routes/, server.js |
| `npm run lint:fix` | Auto-fix lint issues |

### Frontend (packages/web/ -- pnpm)

| Command | Description |
|---------|-------------|
| `pnpm dev` | Vite dev server standalone |
| `pnpm build` | TypeScript + Vite production build |
| `pnpm --filter @festie/web typecheck` | TypeScript type checking |
| `pnpm --filter @festie/web lint` | Frontend ESLint |

## Project Structure

```
festie/
  server.js                 Express orchestrator (392 lines)
  lib/
    app-context/            DI composition root (config, DB, Redis, auth)
    db/stores/              13 data access modules (PostgreSQL)
    notifications/          FCM push notifications (send, retry, DND)
    helpers/                Export utils, sanitize, validation
    config.js               Centralized env var management
    schemas.js              Zod validation for all API inputs
    rate-limiting.js        Multi-tier rate limiting
    middleware.js            Express middleware stack
    socket-setup.js         Socket.IO + Redis adapter
    shutdown.js             Graceful shutdown + background tasks
    openapi.js              OpenAPI spec generation
  routes/                   29 route factory modules
  migrations/               28 PostgreSQL migrations (004-032)
  tests/                    Unit, integration, hardening, E2E
  packages/
    web/src/                React 19 SPA (TanStack Router, Tailwind CSS 4)
    shared/src/             TypeScript stores, hooks, types, services
```

## Environment Variables

Required for production:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Strong random secret for session signing |
| `PUBLIC_ORIGIN` | Public URL (e.g., `https://festie.us`) |
| `FIREBASE_CREDENTIALS_PATH` | Path to FCM service account JSON |
| `RESEND_API_KEY` | Resend API key for transactional email |
| `REDIS_URL` | Redis connection (required for cluster mode) |

See `lib/config.js` for the full list of supported variables and their defaults.

## API Documentation

Interactive API docs are available at `/api/docs` (Swagger UI) when the server is running.

## Contributing

1. Read `CLAUDE.md` for detailed development guidance, conventions, and architecture notes.
2. Read `CONTEXT.md` for the domain language glossary.
3. Follow the code conventions: 2-space indent, single quotes, trailing commas, semicolons.
4. Backend is CommonJS; frontend is ESM/TypeScript.
5. All API inputs must have Zod schemas in `lib/schemas.js`.
6. All SQL must use parameterized queries (`$1, $2`).
7. Run the verification workflow before submitting changes:
   ```bash
   pnpm --filter @festie/web typecheck && npm run lint && pnpm --filter @festie/web lint && npm test
   ```

## License

Business Source License 1.1. See [LICENSE](LICENSE) for details.
