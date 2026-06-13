# iOS Simulator Testing Tools — Research Report

**Date:** 2026-06-11  
**Context:** Festie (Expo SDK 56, React Native), Windows dev box (non-negotiable), GitHub Actions CI
(public repo, macOS runners at 10× minute burn), existing Android Maestro 2.6.0 E2E harness
in `.github/workflows/android-e2e.yml`.

---

## 1. Cost Model — GH Actions macOS Minutes

GitHub Actions pricing for **public repos**: minutes are free (GitHub Free/Teams plans include
unlimited minutes for public repos). This changes the calculus significantly vs. private repos.

- **Public repo (current):** macOS runner minutes are **free**. No overage concern regardless of
  run count. The 10× multiplier only applies to private repos billed against included minutes.
- **If repo goes private:** 2,000 free min/mo → 200 effective macOS min/mo (~13 runs at 15 min
  wall time each). Beyond that: $0.08/min ($1.20/run overage).

**Bottom line:** On a public repo, iOS CI on GH Actions macOS runners costs $0. This removes
the primary barrier. The constraint that remains is wall-time (test turnaround) and flakiness.

---

## 2. Per-Tool Digest

### 2a. launch-ios-simulator (futureware-tech/simulator-action)

- **What it is:** GitHub Action (v5, MIT, ~73 stars) that calls `xcrun simctl` to boot a named
  iOS/tvOS/watchOS simulator and outputs the UDID for downstream steps.
- **Key inputs:** `model`, `os`, `os_version`, `boot_timeout_seconds` (default 360),
  `boot_retries` (default 2).
- **Boot time in CI:** 30–120 s cold start (Xcode 15 penalty). macOS-15 runner had a simulator
  device-matching regression (issue #12777 in actions/runner-images, unresolved as of research
  date).
- **Pairing with Maestro:** Natural. Action boots sim → xcodebuild/EAS artifact installs `.app`
  → `maestro test` drives flows. Exact same YAML DSL as Android flows.
- **Role in Festie:** The sim-boot primitive for a GitHub Actions–native iOS E2E job. Low-level,
  composable, no vendor lock-in.
- **Verdict:** Adopt as the sim-boot step. Mature enough, actively maintained (v5 released
  2026-03-01), minimal surface area.

### 2b. Baguette (tddworks)

- **What it is:** Swift CLI + web UI for headless iOS simulator control (MJPEG/H.264 stream,
  HID injection, accessibility tree JSON, screenshots/recordings). ARM64e only, links against
  private Xcode 26 / SimulatorKit frameworks.
- **Stars/maturity:** 1.4k stars, v0.1.75 (June 9 2026), 110+ tests, active cadence.
- **Hard requirements:** macOS + Xcode 26, Apple Silicon. GH Actions `macos-15` runners are
  Apple Silicon — this works in CI. Dev box (Windows) cannot run it.
- **Role for Festie:** Interactive inspection/debugging on the CI runner. Not a test
  runner — it's a control layer. Useful for visually inspecting simulator state
  (e.g., debug a flaky flow by streaming the screen). No MCP server shipped; needs a thin shell
  wrapper for remote debugging integration.
- **Verdict:** Interesting for future interactive debugging. Not needed in initial build. Xcode 26
  requirement is a risk (runner must have Xcode 26; macos-26 runners in beta as of mid-2026).
  **Defer.**

### 2c. ios-simulator-mcp (joshuayoes variant)

- **What it is:** Node.js MCP server (npm: `ios-simulator-mcp`, v1.6.0 April 2026, 2,000+ stars,
  15 releases) exposing 15+ tools to Cursor and similar tools: `ui_tap`, `ui_swipe`, `ui_type`,
  `ui_find_element` (accessibility tree search), `screenshot`, `record_video`, `launch_app`,
  `install_app`, etc. Backed by Facebook IDB.
- **Local (Windows):** No. iOS Simulator is macOS-only.
- **CI:** Viable on GH Actions macOS runner. IDB install adds ~60 s setup overhead.
- **vs Maestro:** Maestro already has iOS simulator support and shares the same YAML DSL as the
  Android flows. For CI automation, Maestro is the right tool (shared flows, lower overhead).
  ios-simulator-mcp's value is interactive testing sessions on a macOS machine —
  not a CI runner.
- **Verdict:** Not recommended for Festie CI (Maestro is already the harness). Potentially useful
  if a macOS machine were available for interactive debugging sessions. **Reject for CI; consider for
  interactive debugging only if/when a Mac is available.**

### 2d. agent-simulator (jasonkneen)

- **What it is:** Browser-based iOS simulator control platform: Rust sim-server (MJPEG + HID via
  `axe`), Node.js orchestrator, React web UI, 15 MCP tools (`sim_tap_by_label`, `sim_swipe`,
  etc.). Cursor-free input, accessibility tree + React fiber inspection.
- **Stars/maturity:** 194 stars, created 2026-04-21, last commit 2026-04-28. Very early stage
  (~50 days old at research time). AGPL-3.0 license — incompatible with closed-source proprietary
  use without a commercial license (Festie is proprietary).
- **CI fit:** Not CI-ready; optimized for local same-machine operation. No npm package published
  (install from GitHub). Remote macOS operation untested.
- **Verdict:** **Reject.** AGPL-3.0 license incompatibility, very early maturity, no CI defaults,
  inferior to ios-simulator-mcp on all axes except the novel `axe` cursor-free driver.

### 2e. ios-bridge (Python FastAPI)

- **What it is:** Cross-platform remote control for iOS simulators: FastAPI server on macOS,
  WebSocket/WebRTC client for Windows/Linux. Streams video, dispatches taps/swipes/hardware
  buttons via REST + WebSocket. `pip install ios-bridge-cli`.
- **Stars/maturity:** 62 stars, v1.0.10 (Aug 2025), 0 open issues, sparse documentation. Streaming
  quality noted as "not yet at envisioned level" in project materials. Low adoption signal.
- **ios-bridge remote control from Windows — verdict:** Technically possible (Windows client
  connects to macOS server via HTTP/WebSocket), but the macOS server must run somewhere (CI
  runner or a dedicated Mac). Provides video streaming and REST control, not a test assertion
  framework. You'd still need Maestro or a separate assertion layer on top.
- **CI fit:** POC-only. No CI-ready defaults, no Expo integration docs, streaming quality caveats.
- **Verdict:** **Reject for now.** Low maturity, no clear advantage over Maestro + launch-ios-
  simulator, adds operational complexity with unproven stability.

---

## 3. Recommended Architecture — iOS Simulator E2E in CI

### Design Principles (mirroring android-e2e.yml)

- Manual-trigger only (`workflow_dispatch`) — iOS E2E is a ~20 min job; don't gate every push.
- Prebuild on runner (no EAS build credits) — same philosophy as Android job.
- Shared Maestro flows — reuse/extend `.maestro/android-smoke.yaml` with an iOS variant.
- Upload artifacts on `always()` — screenshots, junit report, logs.

### How the Expo Simulator Build Gets There

Two options; **Option A is recommended:**

**Option A — Expo prebuild on the runner (mirrors Android exactly, free)**

```
checkout → setup-node → pnpm install → expo prebuild --platform ios
→ xcodebuild (Release, simulator SDK, arm64+x86_64)
→ xcrun simctl install booted <.app path>
→ maestro test
```

Build output is a `.app` bundle (not an IPA). `xcodebuild` with
`-sdk iphonesimulator -configuration Release` produces a self-contained bundle that installs
directly into the booted simulator without code signing.

**Option B — EAS simulator artifact (simpler build, costs EAS minutes)**

```
eas build --platform ios --profile e2e-simulator (ios.simulator: true)
→ download artifact URL from EAS
→ xcrun simctl install booted <extracted .app>
```

Add to `eas.json`:
```json
"e2e-simulator": {
  "extends": "preview",
  "ios": { "simulator": true }
}
```

Use Option B only if the on-runner xcodebuild proves too slow (iOS Release builds can exceed
20 min on cold runners). EAS pre-builds and caches — Option B would be ~5–8 min download vs
~15–20 min local compile.

### Workflow Sketch — `.github/workflows/ios-e2e.yml`

```yaml
name: iOS E2E

# Mirrors android-e2e.yml: manual-only, not on every push.
# Public repo → macOS runner minutes are FREE (no 10x billing on public repos).
on:
  workflow_dispatch:

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'
  EXPO_NO_TELEMETRY: '1'

permissions:
  contents: read

jobs:
  ios-e2e:
    runs-on: macos-15          # Apple Silicon (M-series), Xcode 16+
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5

      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5
        with:
          node-version: '22'

      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
        with:
          version: 9
          run_install: false

      - name: Install workspace deps (pnpm)
        working-directory: packages
        run: pnpm install --frozen-lockfile

      # Boot simulator BEFORE the long build so it's ready when build finishes.
      - name: Boot iOS Simulator
        id: sim
        uses: futureware-tech/simulator-action@v5
        with:
          model: 'iPhone 15 Pro'
          os: 'iOS'
          os_version: '>=17'
          wait_for_boot: true
          boot_timeout_seconds: 180
          boot_retries: 3

      - name: Expo prebuild (ios)
        working-directory: packages/mobile
        run: pnpm exec expo prebuild --platform ios --no-install

      # Release build targeting the simulator SDK — no code signing required.
      # arm64 only (Apple Silicon runner), saves ~40% compile time vs fat binary.
      - name: Build .app for simulator
        working-directory: packages/mobile/ios
        run: |
          xcodebuild \
            -workspace festie.xcworkspace \
            -scheme festie \
            -sdk iphonesimulator \
            -configuration Release \
            -arch arm64 \
            -derivedDataPath build \
            CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO \
            build | xcpretty || true
          # Locate the .app bundle
          APP_PATH=$(find build -name "*.app" -not -path "*/Debug-*" | head -1)
          echo "APP_PATH=$APP_PATH" >> "$GITHUB_ENV"

      - name: Install .app into simulator
        run: xcrun simctl install "${{ steps.sim.outputs.udid }}" "$APP_PATH"

      - name: Install Maestro
        run: |
          export MAESTRO_VERSION=2.6.0
          curl -fsSL "https://get.maestro.mobile.dev" | bash
          echo "$HOME/.maestro/bin" >> "$GITHUB_PATH"

      - name: Run Maestro smoke (iOS)
        working-directory: packages/mobile
        env:
          TEST_USERNAME: ${{ secrets.TEST_USERNAME }}
          TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}
        run: |
          MAESTRO_CLI_NO_ANALYTICS=1 maestro test \
            -e TEST_USERNAME="$TEST_USERNAME" \
            -e TEST_PASSWORD="$TEST_PASSWORD" \
            --format junit \
            --output maestro-ios-report.xml \
            .maestro/ios-smoke.yaml
          MAESTRO_RC=$?
          xcrun simctl spawn booted log stream --predicate 'process == "festie"' \
            --style syslog > simulator-log.txt 2>&1 &
          exit $MAESTRO_RC

      - name: Upload .app
        if: always()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: ios-simulator-app
          path: packages/mobile/ios/build/**/*.app
          if-no-files-found: ignore

      - name: Upload Maestro artifacts
        if: always()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: ios-maestro-results
          path: |
            packages/mobile/*.png
            packages/mobile/maestro-ios-report.xml
            packages/mobile/simulator-log.txt
          if-no-files-found: ignore
```

**Notes on the sketch:**
- `xcpretty` is pre-installed on GH macOS runners; the `|| true` prevents CI abort on
  `xcpretty` warnings (xcodebuild exit code still propagates via `$APP_PATH` check).
- Workspace name `festie.xcworkspace` — verify post-prebuild via `ls packages/mobile/ios/`.
- Scheme name `festie` — may differ; check with `xcodebuild -list` after prebuild.
- Boot the simulator before the build (parallel work) to avoid sim cold-start on the critical
  path after a 15–20 min compile.

### Maestro iOS Flow Strategy

- Create `.maestro/ios-smoke.yaml` that mirrors `android-smoke.yaml`.
- Most Maestro YAML is cross-platform (element matching via `testID` / accessibility labels works
  identically on iOS and Android). Platform-specific differences:
  - `appId` changes (iOS bundle ID vs Android package name).
  - Some gesture coordinates differ if any flows use absolute coordinates (avoid; use element selectors).
  - iOS `launchApp` in Maestro uses `BUNDLE_ID` env var or `appId` in the flow header.
- Recommended: start with a copy of `android-smoke.yaml`, change `appId` to the iOS bundle ID,
  run it, fix element-selector mismatches incrementally.

---

## 4. Windows Interactive Control — ios-bridge Verdict

**Question:** Can the Windows dev box drive an iOS simulator running on a CI macOS runner or
remote Mac via ios-bridge (or similar)?

**Verdict: Not recommended for Festie at this stage.**

- ios-bridge's FastAPI server must run on the macOS machine. A Windows client CAN connect over
  HTTP/WebSocket to issue taps/screenshots. Technically feasible.
- However: (a) streaming quality noted as immature, (b) no assertion/test framework — you'd need
  Maestro or a script layer on top, (c) the macOS server would need to be a persistent machine
  (not a disposable CI runner), (d) 62 stars / Aug 2025 last release = low confidence.
- **The practical alternative for Windows interactive debugging:** Trigger the GH Actions iOS E2E
  job (`gh workflow run ios-e2e.yml --ref <branch>`), download the artifact screenshots/videos
  from Maestro's `video_recording: true` option, inspect logs. This is the same workflow used for
  Android today (no local emulator on Windows; rely on CI artifacts).
- **If a persistent macOS server is ever provisioned** (Mac Mini, self-hosted runner): ios-bridge
  becomes viable for quick interactive checks. Baguette (with a shell-wrapper) would be superior
  for interactive inspection given its accessibility tree JSON output. But this requires Mac
  infrastructure investment.

**Bottom line:** No viable real-time Windows→iOS remote control path that is production-ready
today. Rely on CI artifacts (screenshots, Maestro video recordings, logs) for debugging.

---

## 5. Cost Estimate

| Scenario | Wall time | macOS min consumed | Cost |
|---|---|---|------|
| Public repo (current) | 20–25 min | N/A | **$0** (free unlimited) |
| Private repo, on-demand (≤13 runs/mo) | 20–25 min | ~200 min | **$0** (within free tier) |
| Private repo, run 14th time | 20–25 min | ~150 min | ~$9/run overage |

- Bottleneck is iOS Release build: ~15–20 min on `macos-15` Apple Silicon runner (no cache,
  cold runner). Subsequent runs may be faster with `actions/cache` on DerivedData.
- Maestro test run adds ~3–5 min.
- Sim boot (parallel with install steps): ~60–90 s.

**If switching to EAS Option B** (download pre-built simulator artifact): drops build time to
~5–8 min download → total job ~10–12 min. Tradeoff: consumes EAS build minutes ($19/mo Starter
plan includes 60 min; one iOS sim build ≈ 10–15 min → 4–6 builds/mo before overage).

---

## 6. Ranked Build Order

### Rank 1 — Adopt: launch-ios-simulator + Maestro (GitHub Actions)

**Why:** Lowest friction, zero new tooling philosophy, mirrors android-e2e.yml exactly, shared
Maestro YAML DSL, public repo = $0 cost, futureware-tech action is stable (v5, March 2026).

**Build steps:**
1. Create `.maestro/ios-smoke.yaml` from `android-smoke.yaml` (change `appId`, test on
   sim locally if a Mac is ever accessible, or iterate in CI).
2. Create `.github/workflows/ios-e2e.yml` per the sketch above.
3. Verify prebuild iOS workspace name and scheme name after first prebuild.
4. Add `video_recording: true` to Maestro flows for debugging.
5. Pin the simulator-action SHA (security best practice, matching android-e2e.yml pattern).

**Expected pain points:**
- xcodebuild output parsing (xcpretty helps but `.app` path discovery is fragile — add a
  `find` assertion step).
- macOS-15 simulator device matching regression: use model name only (no UDID pinning).
- First run will likely fail due to workspace/scheme name mismatch or missing pod install
  (add `pod install` step in `packages/mobile/ios` before xcodebuild).

### Rank 2 — Consider later: EAS simulator build (Option B)

**Why:** If on-runner xcodebuild proves too slow or too flaky, EAS pre-builds and caches iOS
simulator artifacts reliably. Add `e2e-simulator` profile to `eas.json`, download artifact URL
from EAS CLI in the workflow, install with `xcrun simctl install`.

**Blocker now:** Adds EAS build minutes cost and an API token secret to GH Actions. Not needed
until Option A proves too slow.

### Rank 3 — Defer: Baguette

**Why:** Requires Xcode 26 (macos-26 runner, beta stability risk), ARCHITECTURE.md-level
understanding of a new tool, and a shell wrapper for CI integration. Value add is interactive
visual debugging — useful but not essential for initial iOS E2E gate.

**Revisit when:** Xcode 26 runners are stable (GA macos-26), or when a flaky simulator flow
needs video/accessibility-tree inspection that Maestro's `video_recording` doesn't cover.

### Rejected: ios-simulator-mcp (joshuayoes)

Maestro is already the established harness. ios-simulator-mcp's value is interactive testing
sessions on macOS — not CI automation. Adds IDB setup overhead with no benefit over Maestro
for CI use.

### Rejected: agent-simulator (jasonkneen)

AGPL-3.0 license is incompatible with Festie's proprietary codebase without a commercial
agreement. Also early-stage (50 days old at research time), no CI defaults, no npm package.

### Rejected: ios-bridge

Low maturity (62 stars, v1.0.10 Aug 2025), streaming quality caveat in own docs, no assertion
layer, no Expo integration examples. Adds a Python FastAPI server dependency with unclear
stability. Not worth the operational overhead vs Maestro + launch-ios-simulator.

---

## 7. Recommended Path Summary

1. **Now:** Create `ios-e2e.yml` using `futureware-tech/simulator-action` + on-runner
   `xcodebuild` + Maestro (mirroring `android-e2e.yml`). Cost: $0 on public repo.
2. **iOS Maestro flows:** Derive `ios-smoke.yaml` from `android-smoke.yaml`; iterate in CI.
3. **Debugging from Windows:** Use Maestro `video_recording: true` + GH Actions artifact
   download. No real-time remote control path is production-ready today.
4. **If EAS build cost is acceptable:** Switch to EAS Option B to cut wall-time from ~25 min
   to ~12 min per run.
5. **Do not adopt:** agent-simulator (AGPL), ios-simulator-mcp (redundant with Maestro in CI),
   ios-bridge (low maturity), Baguette (Xcode 26 dependency risk).
