# Mobile native fingerprint — build-vs-OTA baseline

This folder holds `baseline.json`: the **native fingerprint of the last EAS _build_**.
It is the anchor the **build-vs-OTA gate** (`.github/workflows/mobile-release-gate.yml`)
compares against to decide whether a code change can ship for free or needs a new build.

## Why this exists (cut EAS build spend)

`app.json` uses `"runtimeVersion": { "policy": "fingerprint" }`. The fingerprint is a
hash of everything that affects the **native** binary: native dependency versions,
config plugins, `app.json` native fields, `ios/` & `android/` dirs, patches, etc.
Pure JS/asset changes do **not** change it.

- **Fingerprint unchanged** → the installed native binary is still compatible →
  ship the new JS over-the-air with **`eas update`** (free). **No build needed.**
- **Fingerprint changed** → the native layer moved → the old binary can't run the
  new JS → a new **EAS build** is required (costs a build credit).

The gate computes the current fingerprint, diffs it against `baseline.json`, and
**reports the decision only** — it does not trigger a build or an update (v1 is free
and side-effect-free). Wiring the actual `eas build` / `eas update` is a follow-up.

## How the gate uses `baseline.json`

`scripts/fingerprint-gate.mjs` (run by the workflow):

1. Computes the current fingerprint via `@expo/fingerprint`.
2. Reads `baseline.json`.
3. If the baseline is **missing or still the placeholder** (`hash` ===
   `PLACEHOLDER-REFRESH-AFTER-FIRST-BUILD`), it **self-seeds** the file with the
   current hash, reports `native_changed=false` + `baseline_seeded=true`, and asks
   you to commit it.
4. Otherwise it sets `native_changed=true|false` and writes the decision to the job
   summary.

## When / how to refresh the baseline

**Refresh `baseline.json` every time you run an EAS build**, because that build *is*
the new "last built" native binary. The point of the baseline is to track the
fingerprint that the currently-distributed binary was built from.

Refresh it from a Unix/CI checkout (the fingerprint computes reliably on Linux;
on Windows the `@expo/fingerprint` config step fails with `spawn node ENOENT`):

```sh
# from packages/mobile
node ./node_modules/expo/bin/fingerprint generate
# copy the top-level "hash" value into baseline.json, then commit it
```

Or, simplest, let the gate seed/refresh it: delete the contents back to the
placeholder (or run the gate after a build with a stale baseline), let
`mobile-release-gate.yml` write the new hash, then **commit** the result.

> The seed-on-first-run path means the very first gate run after this lands will
> set the real baseline automatically. Just commit what it produces.

## Manual fingerprint commands (reference)

```sh
# Generate (prints sources + the top-level hash)
node ./node_modules/expo/bin/fingerprint generate

# Or via the Expo CLI:
pnpm --filter @festie/mobile exec expo fingerprint:generate
```
