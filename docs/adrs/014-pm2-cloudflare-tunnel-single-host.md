# ADR-014: PM2 Fork + Cloudflare Tunnel Single-Host Deployment

**Status:** Accepted
**Date:** 2026-06-19

## Context

Festie is deployed on a single self-hosted Linux server that does not have a public IP — it sits
behind a private network. HTTPS termination, DDoS protection, and public DNS must be handled
externally. Alternatives included a VPS with nginx reverse proxy, a cloud PaaS (Fly.io, Railway,
Render), or Docker Swarm. The single-host self-hosted model was chosen to minimize operational
cost during the pre-revenue phase.

PM2 is the process supervisor. Due to the tsx-as-interpreter constraint (ADR-007),
`exec_mode: 'cluster'` cannot be used — PM2 cluster mode requires a Node.js entry point and
cannot fork processes around a TypeScript interpreter. The ecosystem config therefore uses
`exec_mode: 'fork'` with `instances: 1`.

## Decision

Production runs `ecosystem.config.cjs` under PM2: a single fork process named `festie`, serving
on loopback only (not exposed to the network). Cloudflare Tunnel (`cloudflared`) connects the
server to Cloudflare's edge without inbound firewall rules, providing HTTPS termination, TLS
certificates, DDoS protection, and the `festie.us` domain. The tunnel acts as the only public
ingress; the application binds exclusively to loopback (`BIND_ADDRESS: '127.0.0.1'`). Cookie
security settings (`COOKIE_SECURE: 'true'`, `COOKIE_SAME_SITE: 'strict'`) and
`TRUST_PROXY: 'loopback'` are set via PM2 env. PM2 manages autorestart
(`autorestart: true`, `max_restarts: 10`, `restart_delay: 5s`) and log rotation (via
`pm2-logrotate` plugin). The deploy script SSH-keys into the server, syncs git, installs deps,
builds the web bundle, restarts PM2, and gates on `/api/ready` before tagging the deploy.

Redis 7 and PostgreSQL 16 run locally on the same host.

## Consequences

- Zero ingress firewall rules needed on the host; the Cloudflare Tunnel eliminates the
  port-forwarding and DDoS exposure of a public IP.
- Operational cost is the server hardware and Cloudflare's free tunnel tier.
- Deploys are a single script invocation; no container registry, no orchestrator, no image build.
- Trade-off: single host means single point of failure. There is no automatic failover; a hardware
  failure requires manual recovery. A rollback script is available but operates on the same host.
- Trade-off: `exec_mode: 'fork'` with one instance means no CPU core parallelism at the Node.js
  level. The tsx constraint (ADR-007) is the binding reason; eliminating it by compiling to JS
  would unlock `exec_mode: 'cluster'` and horizontal intra-host scaling.
- Trade-off: Redis and PostgreSQL share the host with the app process. Under memory pressure, any
  of the three services can starve the others. `max_memory_restart: '768M'` on the PM2 process
  provides an upper bound for the Node process.
- Trade-off: the deploy pipeline relies on SSH key access to the production host from the
  developer's machine. There is no CI/CD pipeline deploying to production automatically; all
  deploys are initiated manually.
- Trade-off: Cloudflare Tunnel introduces a dependency on Cloudflare's availability and routing.
  Cloudflare outages that affect tunnel connectivity will take the app offline even if the host is
  healthy.
