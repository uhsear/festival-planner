// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * Backend route-handler typing barrel.
 *
 * Importing this module also pulls in `./request` for its global side-effect —
 * the canonical `declare module 'express'` augmentation of `Request`. Route
 * modules can `import type { RouteDeps } from '../lib/types'` and get the
 * augmented `Request` in the same import graph.
 */

import './request';

export type { AppContext, RouteDeps, Stores, Middleware, ValidateFactory, SendSuccess, SendError } from './app-context';

export type * from './contracts';
