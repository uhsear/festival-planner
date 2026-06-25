// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Backend-reachable re-export of the shared domain contracts.
 *
 * The backend cannot import the `@festie/shared` barrel — it drags in React and
 * other browser-only deps. We re-export ONLY the domain *types* here via a
 * `import type`-only relative path, so nothing is resolved at runtime (types are
 * stripped by `tsx`). This is the single seam through which route serializers
 * and the compile-time contract test assert their return shapes against the
 * same types the web/mobile clients consume.
 *
 * If this relative path ever becomes fragile, the alternative is a tsconfig
 * `paths` alias `@festie/shared/types` → packages/shared/src/types — but the
 * relative form is the most robust under `moduleResolution: "bundler"`.
 */
export type {
  Priority,
  Festival,
  Stage,
  FestivalDay,
  Artist,
  FestivalSet,
  User,
  AuthResponse,
  Profile,
  CrewMember,
  Crew,
  CrewOverlap,
  CrewPoll,
  CrewPollVote,
  CrewMeetingPoint,
  CrewExpense,
  CrewExpenseBalance,
  CrewActivityEntry,
  NotificationPrefs,
  OnlineUser,
  PeerLocation,
} from '../../packages/shared/src/types/domain';

// Live-location socket payloads live in the shared socket-events module (which
// itself only imports types from ./domain), so this `import type`-only re-export
// is likewise runtime-free. The live-location snapshot cache asserts its return
// shape against the exact contract the web/mobile clients consume.
export type { LocationPeerUpdatePayload } from '../../packages/shared/src/types/socket-events';
