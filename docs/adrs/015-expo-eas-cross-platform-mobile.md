# ADR-015: Expo / EAS for Cross-Platform Mobile

**Status:** Accepted
**Date:** 2026-06-19

## Context

Festie needed a mobile presence on both iOS and Android to reach festival attendees in the field.
The options were: (1) Expo / React Native with Expo Application Services (EAS) for builds and
submissions; (2) native iOS (Swift) + native Android (Kotlin) as separate codebases; (3)
Flutter/Dart; (4) a progressive web app only. ADR-005's platform analysis ruled out Flutter (weak
backend ecosystem, canvas-based web that breaks PWA) and native per-platform (would require
rewriting the `@festie/shared` package and duplicating all state management). A PWA-only approach
was rejected because push notifications, camera (QR scanning), haptics, secure storage, and
background location require native APIs.

The mobile app can reuse `@festie/shared` directly (Zustand stores, API client, Socket.IO wrapper,
domain types) because Metro and babel-preset-expo can process TypeScript source. This reuse is the
primary justification for Expo over Flutter or native: the business logic layer already exists in
TypeScript.

## Decision

`packages/mobile` is an Expo SDK 56 project using `expo-router` (file-based routing, same
paradigm as TanStack Router on web) and React Native 0.85.3. Builds are handled by EAS Build;
iOS builds target TestFlight and Android builds target the Google Play internal track. OTA updates
via `expo-updates` are the primary delivery mechanism for JavaScript-layer changes, avoiding App
Store review cycles for non-native changes. Native modules in use include: `expo-notifications`
(FCM push via Firebase), `expo-camera` (QR code scanning), `expo-secure-store` (token storage),
`expo-location` (live location sharing), `expo-image-picker` (avatar upload), and `@expo/ui`
(native SwiftUI/Compose components via SDK 56's new UI primitives).

The mobile package imports only from its own declared dependencies or `@festie/shared/...`
subpaths — never from shared's transitive deps — enforced by CI typecheck (TS2307 on violation).

## Consequences

- A single TypeScript codebase covers web + mobile; the Zustand store layer, API client, socket
  wrapper, and all domain types are shared without duplication.
- OTA updates via `expo-updates` allow JavaScript-layer bug fixes and feature additions to reach
  users in minutes without an App Store submission cycle.
- EAS Build handles native compilation in the cloud, eliminating the need for macOS hardware for
  iOS builds in most cases (EAS manages the macOS build agents).
- Trade-off: EAS Build credits are consumption-capped; every native build (required when adding or
  modifying a native module) incurs cost. OTA-first discipline is enforced operationally to
  minimize native rebuild frequency.
- Trade-off: Expo SDK major upgrades are periodic forced migrations that require testing all native
  modules for compatibility and often require EAS builds. These upgrades cannot be deferred
  indefinitely as older SDKs lose support.
- Trade-off: `@expo/ui` SwiftUI/Jetpack Compose primitives (SDK 56) are new and have a smaller
  community surface than React Native's established component ecosystem. Components built on these
  primitives may need replacement if the API changes in future SDK versions.
- Trade-off: the mobile import boundary (no transitive deps) creates a CI-only enforcement
  surface; a developer who installs and imports a transitive dep will not see an error locally
  until CI typecheck runs.
