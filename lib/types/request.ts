// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * The ONE canonical augmentation of Express's `Request` with the fields the
 * Festie middleware stack actually sets:
 *   - `user` / `userToken` / `userAuthSource` — set by session/auth middleware
 *   - `validatedBody` / `validatedParams` / `validatedQuery` — set by the Zod
 *     `validate*` middleware factories in lib/schemas.ts. Typed as `unknown` so
 *     handlers must narrow (cast `as z.infer<...>`) before use — no silent `any`.
 *   - `id` / `traceId` — request-id middleware
 *   - `file` — multer (avatar upload)
 *
 * Importing this module for its side-effect (done by lib/types/index.ts) makes
 * the augmentation global. Do NOT redeclare these fields in individual route
 * modules — rely on this central definition.
 */

import 'express';

// Augment `express-serve-static-core` (NOT just `express`) — that is the module
// whose `Request` interface backs `RequestHandler`, so the fields land on the
// Request type Express's router overloads actually reference. Augmenting only
// `express` adds the fields to the re-export but not to the handler-parameter
// Request, which breaks `router.get(path, handler)` assignability.
declare module 'express-serve-static-core' {
  interface Request {
    user: { userId: string; username: string };
    userToken: string;
    userAuthSource: string;
    validatedBody: unknown;
    validatedParams: unknown;
    validatedQuery: unknown;
    id: string;
    traceId?: string;
    file?: Express.Multer.File;
  }
}
