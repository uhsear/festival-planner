# Trust-Proxy Hardening

Festie's origin (Express, port 4000) runs behind Cloudflare and is reached only
through a Cloudflare Tunnel terminating on loopback. The client's real IP is used
as the rate-limit and audit key, so it must not be forgeable by an attacker
setting their own `X-Forwarded-For`.

## What changed in code (DONE)

These are committed in this change set — no action required to "apply" them:

- **`lib/app-context/request-helpers.ts` — `getRequestIp`:** when
  `config.TRUST_PROXY` is truthy, the IP key is derived ONLY from a
  `net.isIP`-validated `cf-connecting-ip` header, then the raw socket peer
  (`req.socket.remoteAddress` / `req.connection.remoteAddress`). `x-forwarded-for`
  is never consulted and `req.ip` is not used in this branch (it is itself
  XFF-derived under Express trust-proxy). A forged XFF can no longer move a
  client's rate-limit/audit key. Local-dev behaviour (TRUST_PROXY falsy) is
  unchanged: `req.ip` + socket addresses, no proxy headers.
- **`ecosystem.config.cjs` — `TRUST_PROXY: 'loopback'`** (was `'true'`): defense
  in depth. Express now only treats loopback peers as trusted to set
  `X-Forwarded-*`. Combined with the above, XFF is doubly neutralized.
- **`ecosystem.config.cjs` — `CLUSTER_SIZE: '1'`** (was `'4'`): the deploy runs a
  single PM2 fork worker (`exec_mode: 'fork', instances: 1`). The rate-limiter
  divides its in-memory fallback budget by `CLUSTER_SIZE` during a Redis outage;
  the stale `4` was inflating the effective per-process limit 4x.
- **`lib/config.ts` — `readTrustProxy`** now passes the Express preset strings
  `loopback` / `linklocal` / `uniquelocal` through unchanged (in addition to
  boolean / numeric hop counts). `app.set('trust proxy', config.TRUST_PROXY)` in
  `lib/middleware.ts` accepts these directly.

## Owner checklist (INFRA — owner action)

Run these against the live origin host (`192.168.0.150`). Each is independent of
the code change above; the code is hardened regardless, but these confirm the
network posture the code assumes.

1. **Origin binds loopback only.** On the origin host:
   ```
   ss -ltnp | grep 4000
   ```
   The listener address MUST be `127.0.0.1:4000` (not `0.0.0.0:4000` / `*:4000`).
   If it shows a wildcard bind, confirm `BIND_ADDRESS=127.0.0.1` is in effect.

2. **No WAN port-forward to the origin.** Confirm the router / firewall has no
   port-forward or DNAT rule exposing `192.168.0.150:4000` (or any external port)
   to the internet. The only ingress path must be the Cloudflare Tunnel.

3. **External-reachability negative test.** From a host OFF the LAN (e.g. a phone
   on cellular, or any external box), the origin must be unreachable directly:
   ```
   curl -sS --max-time 5 http://<wan-ip>:4000/health/live    # MUST fail / time out
   ```
   A connection refused / timeout is the expected (passing) result. A `200` here
   means the origin is exposed to the internet — stop and fix the firewall.

4. **Tunnel path still healthy.** The public hostname must still serve through
   Cloudflare:
   ```
   curl -sS -o /dev/null -w '%{http_code}\n' https://festie.us/health/live
   ```
   MUST print `200`.

If all four pass, the trust-proxy assumptions hold: real client IPs arrive via
Cloudflare's `cf-connecting-ip`, the tunnel terminates on loopback, and no
attacker can reach the origin directly to inject spoofed headers.
