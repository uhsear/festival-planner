# MCP / tool setup (2026-04-18)

Quick reference for activating the new tools added this session. The code-level stuff (build, lhci, react-scan) is already live; MCPs need a one-time env-var setup and a Claude Code restart.

## What got installed

### Dev deps (packages/web, on prod + committed to lockfile)
- `@lhci/cli` — Lighthouse CI runner for perf / PWA / a11y gates
- `react-scan` — dev-time re-render visualizer (script-tag or `<ReactScan />`)
- `@axe-core/playwright` + `eslint-plugin-jsx-a11y` — a11y test hooks (from earlier install)

### Local Windows (via pipx)
- `semgrep` 1.159.0 — static analysis, no account required
- `postgres-mcp` 0.3.0 — MCP server for Postgres introspection + query stats

### `.mcp.json` entries (local)
- `github` — `@modelcontextprotocol/server-github` via `npx -y`, reads `GITHUB_PERSONAL_ACCESS_TOKEN`
- `postgres` — `postgres-mcp --access-mode=restricted`, reads `FP_POSTGRES_URI`

## One-time setup to activate the MCPs

### 1. GitHub MCP

Get a personal-access token from https://github.com/settings/tokens (scopes: `repo`, `workflow`, `read:org`). Then in PowerShell:

```powershell
setx GITHUB_PERSONAL_ACCESS_TOKEN "ghp_YourTokenHere"
```

Close + reopen Claude Code so the new env var is inherited.

### 2. Postgres MCP

Point at the production DB (read-only via `--access-mode=restricted` is already set in `.mcp.json`):

```powershell
setx FP_POSTGRES_URI "postgresql://USER:PASS@REDACTED:5432/festival_planner"
```

> The DB creds live on prod in `/home/asir/festival-planner/.env` as `DATABASE_URL`. SSH in and grep it out, then `setx` on Windows. Restart Claude Code.

### 3. `gh` CLI (optional)

The earlier install was cancelled. Re-run with UAC approved:

```powershell
winget install --id GitHub.cli -e
```

Then `gh auth login` once.

## Using semgrep

Runs without any setup:

```powershell
# Quick OWASP + React scan of the whole repo
py -m pipx run semgrep --config=p/react --config=p/owasp-top-ten packages/ lib/ routes/

# Fast scan of just the React frontend
py -m pipx run semgrep --config=p/react packages/web/src/
```

Add to CI later if it catches useful things.

## Using Lighthouse CI

From `packages/web/`:

```bash
pnpm exec lhci autorun --config=.lighthouserc.cjs
```

You'll need a `.lighthouserc.cjs` in `packages/web/` — a starter:

```js
module.exports = {
  ci: {
    collect: { url: ['https://festie.us/', 'https://festie.us/cards', 'https://festie.us/festival-mode'], numberOfRuns: 3 },
    assert: {
      assertions: {
        'categories:performance':   ['warn',  { minScore: 0.8 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:pwa':           ['warn',  { minScore: 0.8 }],
        'total-byte-weight':        ['warn',  { maxNumericValue: 800000 }]
      }
    },
    upload: { target: 'temporary-public-storage' }
  }
};
```

## Using React Scan (dev-time)

Fastest path — drop a script tag into `packages/web/index.html`:

```html
<script src="https://unpkg.com/react-scan/dist/auto.global.js"></script>
```

Or via import: `pnpm --filter @festie/web add -D react-scan` is done; add to `main.tsx` inside a `if (import.meta.env.DEV)` block:

```tsx
if (import.meta.env.DEV) {
  import('react-scan').then(({ scan }) => scan({ enabled: true }));
}
```

## Using the bundle treemap

Already generated: `docs/bundle-viz-2026-04-18.html`. Open in any browser to see what's in the 697 KB `index-*.js` chunk. Likely splits:
- `react` + `react-dom` → one chunk
- `@tanstack/*` → one chunk
- `motion` + `vaul` + `@radix-ui/*` → UI chunk
- `socket.io-client` + `zod` + `html-to-image` → misc chunk

Add to `packages/web/vite.config.ts` under `build.rollupOptions.output.manualChunks` when you're ready to ship the split.

## What doesn't require activation

- `semgrep` — just `py -m pipx run semgrep ...`
- Bundle viz — just open the HTML
- @lhci/cli — already installed; runs via `pnpm exec`

## What DOES require Claude Code restart

- GitHub MCP + Postgres MCP (after env vars set)

Rule of thumb: anything in `.mcp.json` needs Claude Code to re-read the config at startup.
