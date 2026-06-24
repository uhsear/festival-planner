# ── Build stage ────────────────────────────────────────────────────────────────
# Pin to Node 22.22.1 LTS (Jod) for reproducible builds
FROM node:22.22.1-slim AS build

WORKDIR /app

# Install build deps for native modules (sharp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    make g++ && \
    rm -rf /var/lib/apt/lists/*

# .npmrc carries legacy-peer-deps=true (openapi-typescript@7 peer-requires TS5;
# repo is on TS6). Without it here, `npm ci` ERESOLVE-fails in the image.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22.22.1-slim

WORKDIR /app

# Runtime deps for sharp (libvips only — no -dev headers needed at runtime)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 && \
    rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r app && useradd -r -g app -m app

# Copy node_modules from build stage
COPY --from=build /app/node_modules ./node_modules

# Copy app source (TypeScript, run via tsx — see CMD below)
COPY package.json tsconfig.json ./
COPY server.ts ./
COPY lib/ ./lib/
COPY routes/ ./routes/
COPY migrations/ ./migrations/
COPY public/ ./public/
COPY scripts/ ./scripts/

# Data and logs directories (mount as volumes in production)
RUN mkdir -p /app/data /app/lib/data /app/logs /app/public/uploads/avatars && \
    chown -R app:app /app/data /app/lib/data /app/logs /app/public/uploads

USER app

# Health check (uses PORT env var so the container works on any port)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const p=process.env.PORT||4000;require('http').get('http://127.0.0.1:'+p+'/api/ready',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

EXPOSE 4000

ENV NODE_ENV=production
ENV BIND_ADDRESS=0.0.0.0

CMD ["node", "--import", "tsx/esm", "server.ts"]
