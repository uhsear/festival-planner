// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * `AppContext` — the typed shape of the object returned by
 * `createAppContext()` in lib/app-context/index.ts, and `RouteDeps` — what
 * every route factory receives (the context plus the runtime-injected `io` and
 * `emitter`, attached in server.ts after Socket.IO is created).
 *
 * Design: type the HIGH-LEVERAGE keys precisely (response helpers, validators,
 * the serializers, stores) so converted route modules get real checking, and
 * leave genuinely-hard infra (`config`, presence, rate-limiter internals) as
 * narrow function signatures or `unknown` — never `any`. Expand member typing
 * per converted module as more handlers come under type.
 */

import type { Response, RequestHandler } from 'express';
import type { z } from 'zod';
import type { Server } from 'socket.io';
import type { EventEmitter } from 'node:events';

import type { AppConfig } from '../config';
import type { ErrorCodes } from '../response';
import type { schemas } from '../schemas';
import type { Crew, Profile, User } from './contracts';

/**
 * The public-safe projection of a user emitted by `serializePublicUser`. It is a
 * *subset* of the shared `User` contract — the public API intentionally omits
 * `createdAt`/`updatedAt`/`isAdmin`. Kept assignable to `Partial<User>` so the
 * compile-time contract test can assert structural compatibility.
 */
export interface PublicUser {
  id: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
  emailVerified: boolean;
  // Payment handles for settle-up deep links (null when unset).
  venmoHandle: string | null;
  cashappCashtag: string | null;
  paypalHandle: string | null;
}

/** A Zod-validation middleware factory (validate / validateParams / validateQuery). */
// `ZodType<any>` is Zod's own variance-correct way to accept any schema; the
// `any` is the output-type parameter, not a real `any` value.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ValidateFactory = (schema: z.ZodType<any>) => RequestHandler;

/** Response helpers (re-exported from lib/response). */
export type SendSuccess = <T = unknown>(
  res: Response,
  data: T,
  // `meta` mirrors the runtime `sendSuccess` signature (lib/response.ts), an
  // open-ended bag of response metadata.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: Record<string, any> | null,
  config?: AppConfig | null,
) => Response;

export type SendError = (
  res: Response,
  status: number,
  message: string,
  code?: string | null,
  details?: Record<string, unknown> | null,
) => Response;

/**
 * Minimal store surface used by the currently-converted route modules. Stores
 * are loosely typed in the data layer (lib/db/stores/*); this enumerates only
 * the members the typed handlers touch and leaves the rest open via the index
 * signature. Tighten incrementally as more modules are converted.
 */
export interface Stores {
  users: {
    update(userId: string, patch: Record<string, unknown>): Promise<User | null>;
    // Other user-store methods (getByUsername, getById, …) are accessed
    // dynamically by not-yet-typed call sites.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [k: string]: any;
  };
  crews: {
    getById(crewId: string): Promise<Crew | null>;
    getMember(crewId: string, userId: string): Promise<{ role?: string; [k: string]: unknown } | null>;
    updateHomeBase(crewId: string, args: { location?: string | null; time?: string | null }): Promise<unknown>;
    meetingPoints: {
      listByCrew(crewId: string): Promise<unknown[]>;
      countByCrew(crewId: string): Promise<number>;
      create(data: Record<string, unknown>): Promise<unknown>;
      getById(
        id: string,
      ): Promise<{ crew_id?: string; created_by?: string; active?: boolean; [k: string]: unknown } | null>;
      update(id: string, patch: unknown): Promise<unknown>;
      deactivate(id: string): Promise<unknown>;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [k: string]: any;
  };
  activity: { log(entry: Record<string, unknown>): Promise<unknown> };
  // Other stores (profiles, sessions, deviceTokens, notificationPrefs, …) are
  // accessed dynamically by not-yet-typed call sites. `any` (not `unknown`)
  // because those modules destructure deep methods off them; tighten as each is
  // converted.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [store: string]: any;
}

/**
 * An Express-style auth/rate-limit middleware. Aliased to Express's own
 * `RequestHandler` so these can be passed straight to `router.get(...)` etc.
 * without the augmented-Request fields making the handler signature
 * structurally incompatible with Express's overloads.
 */
export type Middleware = RequestHandler;

/**
 * The application context — dependency-injection surface for every route module
 * and middleware. Precisely-typed keys are the ones converted handlers rely on;
 * the rest of the (large) surface is intentionally left to the index signature
 * until those consumers are typed.
 */
export interface AppContext {
  // Response helpers
  sendSuccess: SendSuccess;
  sendError: SendError;
  ErrorCodes: typeof ErrorCodes;

  // Validation
  schemas: typeof schemas;
  validate: ValidateFactory;
  validateParams: ValidateFactory;
  validateQuery: ValidateFactory;

  // Auth / rate limiting middleware
  userAuth: Middleware;
  adminAuth: Middleware;
  rateLimit: (max: number, key: string) => Middleware;

  // Stores
  stores: Stores;

  // Serializers — the PAYOFF is the pinned RETURN types (PublicUser/Profile);
  // the inputs are loosely-typed DB/cache rows, so `any` there is honest.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  serializePublicUser: (user: any) => PublicUser;
  serializeOwnProfile: (profile: any, user?: any) => Profile;
  serializeProfileForViewer: (profile: any, viewerUserId: any, user?: any) => Partial<Profile>;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Socket.IO injection point (the live `io` is on RouteDeps, set in server.ts)
  setIO: (io: Server) => void;

  // The remaining context surface (config, state, pool, presence, cookie/cache/
  // avatar helpers, normalizers, infra) is broad and dynamically consumed by
  // not-yet-typed call sites (server.ts, middleware, socket-setup). The catch-all
  // is `any` so those consumers keep their existing inference until they are
  // converted; never rely on `any` at a *converted* call site — narrow there.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * What route factories actually receive: the context plus the runtime-injected
 * Socket.IO server and the domain event emitter (attached in server.ts).
 */
export type RouteDeps = AppContext & {
  io: Server;
  emitter: EventEmitter;
};
