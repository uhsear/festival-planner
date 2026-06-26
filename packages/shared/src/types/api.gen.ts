// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.
//
// GENERATED FILE — do not edit by hand.
// Source: lib/openapi.ts (request contracts derived from lib/schemas.ts Zod).
// Regenerate: `npm run gen:api-types`. CI git-diffs this file to catch drift.
//
// Pure type module (zero runtime imports) so @festie/shared can re-export these
// to BOTH web and React Native without dragging in any server runtime dep.

export type paths = {
    "/api/v1/admin/bulk/archive-festivals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Bulk archive festivals */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Results */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/bulk/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Bulk deactivate users */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        userIds: string[];
                    };
                };
            };
            responses: {
                /** @description Results */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Login */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        password: string;
                        username: string;
                    };
                };
            };
            responses: {
                /** @description Login successful */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AuthEnvelope"];
                    };
                };
                /** @description Invalid credentials */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Account locked */
                423: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Logout */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Session invalidated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get current user */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Current user info */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AuthEnvelope"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Refresh session token (requires valid session) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description New session token */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/refresh-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Exchange refresh token for new session + refresh token */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        refreshToken: string;
                    };
                };
            };
            responses: {
                /** @description Tokens rotated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RefreshTokenResponse"];
                    };
                };
                /** @description Invalid/expired refresh token */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Register new user */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        confirmPassword: string;
                        dateOfBirth: string;
                        email?: string | "";
                        password: string;
                        /** @enum {boolean} */
                        tosAccepted: true;
                        username: string;
                    };
                };
            };
            responses: {
                /** @description User created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RefreshTokenResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List user crews */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Crew list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Crew"][];
                    };
                };
            };
        };
        put?: never;
        /** Create crew */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Crew created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Crew"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crews/{crewId}/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Crew activity feed (cursor-paginated) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    crewId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Activity entries */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items?: components["schemas"]["CrewActivityEntry"][];
                            nextCursor?: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crews/{crewId}/expenses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List crew expenses */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    crewId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Expense ledger */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CrewExpense"][];
                    };
                };
            };
        };
        put?: never;
        /** Add crew expense */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    crewId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Expense created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CrewExpense"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crews/{crewId}/expenses/settlement-plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Netted who-pays-whom settlement plan */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    crewId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Balances + settlements */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CrewSettlementPlan"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crews/{crewId}/overlap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get crew pick overlap analysis */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Overlap data */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crews/{crewId}/packing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List crew packing items */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    crewId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Packing board */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items?: components["schemas"]["CrewPackingItem"][];
                        };
                    };
                };
            };
        };
        put?: never;
        /** Add packing item */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    crewId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Item created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            item?: components["schemas"]["CrewPackingItem"];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crews/{crewId}/polls": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List active crew polls */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    crewId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Polls (with vote tallies) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            polls?: components["schemas"]["CrewPoll"][];
                        };
                    };
                };
            };
        };
        put?: never;
        /** Create crew poll */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    crewId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Poll created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            poll?: components["schemas"]["CrewPoll"];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crews/{crewId}/rides": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List crew ride offers */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    crewId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Ride board */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            offers?: components["schemas"]["CrewRideOffer"][];
                        };
                    };
                };
            };
        };
        put?: never;
        /** Add ride offer */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    crewId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Offer created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            offer?: components["schemas"]["CrewRideOffer"];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crews/{crewId}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List crew member statuses */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    crewId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Member statuses */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            statuses?: components["schemas"]["CrewMemberStatus"][];
                        };
                    };
                };
            };
        };
        /** Upsert my own status */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    crewId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Status upserted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            status?: components["schemas"]["CrewMemberStatus"];
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crews/join/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Join crew by invite code */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    code: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Joined crew */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/festivals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all festivals */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Festival list (ETag-cached) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FestivalListItem"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/festivals/{festivalId}/calendar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Calendar events JSON for native integration */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Calendar events */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/festivals/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get festival by ID */
        get: {
            parameters: {
                query?: {
                    depth?: number;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Festival data (full depth=2 document; depth=1 returns the FestivalDepth1 shape) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Festival"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health check with metrics */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Health status */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get notification preferences */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Preferences */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotificationPrefs"];
                    };
                };
            };
        };
        /** Update notification preferences */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotificationPrefs"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Register FCM push token */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Token registered */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/profiles/{festivalId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List profiles for festival */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    festivalId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Profile list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Profile"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/profiles/{festivalId}/join": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Join festival */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Profile created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Profile"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/profiles/{festivalId}/picks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Update picks (with ETag concurrency) */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Picks updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Profile"];
                    };
                };
                /** @description Version mismatch */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness probe (no DB, no auth) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Alive */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/join/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Crew invite deep link (redirects to app) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    code: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Redirect to app with joinCrew param */
                302: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: {
        Artist: {
            links?: {
                [key: string]: string;
            };
            name: string;
        };
        AuthEnvelope: {
            refreshToken?: string;
            token?: string;
            user: {
                avatarUrl: string | null;
                cashappCashtag: string | null;
                email: string | null;
                emailVerified: boolean;
                id: string;
                name: string | null;
                paypalHandle: string | null;
                username: string;
                venmoHandle: string | null;
            };
        };
        Crew: {
            createdAt: string;
            createdBy: string;
            festivalId: string;
            homeBaseLocation: string | null;
            homeBaseTime: string | null;
            homeBaseUpdatedAt: string | null;
            id: string;
            inviteCode?: string;
            inviteExpiresAt?: string | null;
            joinedAt?: string;
            maxMembers?: number;
            memberCount: number;
            members: {
                avatarKey: string | null;
                avatarVersion: string | null;
                joinedAt?: string;
                name: string;
                /** @enum {string} */
                role: "owner" | "member";
                userId: string;
                username: string;
            }[];
            name: string;
            owner: string;
            photoAlbumUrl: string | null;
            reformedFrom: string | null;
            /** @enum {string} */
            role?: "owner" | "member";
            totem_emoji: string | null;
            totem_name: string | null;
            updatedAt: string;
        };
        CrewActivityEntry: {
            created_at: string;
            crew_id: string;
            detail: string | null;
            id: string;
            type: string;
            user_id: string;
            username: string;
        };
        CrewExpense: {
            amount: string;
            category: string;
            created_at: string;
            crew_id: string;
            description: string;
            id: string;
            paid_by: string;
            paid_by_name?: string;
            planned: boolean;
            split_with: string[];
        };
        CrewMember: {
            avatarKey: string | null;
            avatarVersion: string | null;
            joinedAt?: string;
            name: string;
            /** @enum {string} */
            role: "owner" | "member";
            userId: string;
            username: string;
        };
        CrewMemberStatus: {
            avatar_key?: string | null;
            avatar_version?: string | null;
            crew_id: string;
            eta_minutes: number | null;
            latitude: number | null;
            location_captured_at: string | null;
            longitude: number | null;
            name?: string | null;
            note: string | null;
            status: string | null;
            target_meeting_point_id: string | null;
            updated_at: string;
            user_id: string;
            username?: string;
        };
        CrewPackingItem: {
            brought_by: string | null;
            claimed: boolean;
            created_at: string;
            created_by: string;
            creator_name?: string;
            crew_id: string;
            id: string;
            label: string;
        };
        CrewPoll: {
            closed: boolean;
            closes_at: string | null;
            created_at: string;
            created_by: string;
            crew_id: string;
            id: string;
            options: string[];
            question: string;
            vote_count?: string;
            votes?: {
                option: number | null;
                user_id: string | null;
            }[];
        };
        CrewPollVote: {
            option: number | null;
            user_id: string | null;
        };
        CrewRideOffer: {
            created_at: string;
            created_by: string;
            creator_name?: string;
            crew_id: string;
            depart_at: string | null;
            depart_from: string | null;
            driver: string | null;
            id: string;
            note: string | null;
            seats: number | null;
        };
        CrewSettlementPlan: {
            balances: {
                balance: number;
                userId: string;
                username: string;
            }[];
            settlements: {
                amount: number;
                amountCents: number;
                fromName: string;
                fromUserId: string;
                payeeHandles: {
                    cashapp: string | null;
                    paypal: string | null;
                    venmo: string | null;
                };
                toName: string;
                toUserId: string;
            }[];
        };
        Day: {
            date?: string;
            id?: string;
            name?: string;
            sets?: components["schemas"]["Set"][];
        };
        Error: {
            data?: null;
            error?: {
                /** @description Machine-readable error code */
                code?: string;
                message?: string;
                /** @description Whether the client should retry this request */
                retryable?: boolean;
                status?: number;
            };
        };
        Festival: {
            b2bSeparator: string;
            createdAt: string;
            days: {
                date: string;
                dayIndex: number;
                label: string;
                sets: {
                    artist: string | null;
                    artists: {
                        links?: {
                            [key: string]: string;
                        };
                        name: string;
                    }[];
                    endTime: string | null;
                    id: string;
                    linkUrl: string | null;
                    stageId: string | null;
                    startTime: string | null;
                }[];
            }[];
            id: string;
            location: string;
            mapConfig: {
                amenities?: {
                    features: {
                        geometry: {
                            coordinates: (number)[];
                            /** @enum {string} */
                            type: "Point";
                        };
                        properties: {
                            /** @enum {string} */
                            amenityType: "water" | "medical" | "toilet" | "food" | "atm" | "entrance" | "exit" | "info" | "charging";
                            id: string;
                            label: string;
                        };
                        /** @enum {string} */
                        type: "Feature";
                    }[];
                    /** @enum {string} */
                    type: "FeatureCollection";
                };
                bounds?: ((number)[] | (number)[])[];
                center?: (number)[];
                offlineBasemap?: {
                    attribution?: string;
                    /** Format: uri */
                    pmtilesUrl: string;
                };
                siteplan?: {
                    corners: ((number)[] | (number)[] | (number)[] | (number)[])[];
                    /** Format: uri */
                    imageUrl: string;
                    opacity: number;
                };
                /** @enum {number} */
                version: 1;
                zones?: {
                    features: {
                        geometry: {
                            coordinates: (number)[][][];
                            /** @enum {string} */
                            type: "Polygon";
                        };
                        properties?: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        type: "Feature";
                    }[];
                    /** @enum {string} */
                    type: "FeatureCollection";
                };
            } | null;
            name: string;
            stages: {
                color: string | null;
                id: string;
                latitude: number | null;
                longitude: number | null;
                name: string;
            }[];
            timeZone: string | null;
            updatedAt: string;
        };
        FestivalDepth1: {
            createdAt: string;
            days: {
                date: string;
                label: string;
                sets: {
                    artist: string | null;
                    artists: {
                        links?: {
                            [key: string]: string;
                        };
                        name: string;
                    }[];
                    endTime: string | null;
                    id: string;
                    stageId: string | null;
                    startTime: string | null;
                }[];
            }[];
            id: string;
            location: string;
            mapConfig: {
                amenities?: {
                    features: {
                        geometry: {
                            coordinates: (number)[];
                            /** @enum {string} */
                            type: "Point";
                        };
                        properties: {
                            /** @enum {string} */
                            amenityType: "water" | "medical" | "toilet" | "food" | "atm" | "entrance" | "exit" | "info" | "charging";
                            id: string;
                            label: string;
                        };
                        /** @enum {string} */
                        type: "Feature";
                    }[];
                    /** @enum {string} */
                    type: "FeatureCollection";
                };
                bounds?: ((number)[] | (number)[])[];
                center?: (number)[];
                offlineBasemap?: {
                    attribution?: string;
                    /** Format: uri */
                    pmtilesUrl: string;
                };
                siteplan?: {
                    corners: ((number)[] | (number)[] | (number)[] | (number)[])[];
                    /** Format: uri */
                    imageUrl: string;
                    opacity: number;
                };
                /** @enum {number} */
                version: 1;
                zones?: {
                    features: {
                        geometry: {
                            coordinates: (number)[][][];
                            /** @enum {string} */
                            type: "Polygon";
                        };
                        properties?: {
                            [key: string]: unknown;
                        };
                        /** @enum {string} */
                        type: "Feature";
                    }[];
                    /** @enum {string} */
                    type: "FeatureCollection";
                };
            } | null;
            name: string;
            stages: {
                color: string | null;
                id: string;
                latitude: number | null;
                longitude: number | null;
                name: string;
            }[];
            updatedAt: string;
        };
        FestivalListItem: {
            dayCount: number;
            endDate: string | null;
            id: string;
            location: string;
            name: string;
            stageCount: number;
            startDate: string | null;
        };
        FestivalSet: {
            artist: string | null;
            artists: {
                links?: {
                    [key: string]: string;
                };
                name: string;
            }[];
            endTime: string | null;
            id: string;
            linkUrl: string | null;
            stageId: string | null;
            startTime: string | null;
        };
        MeetingPoint: {
            active: boolean;
            created_at: string;
            created_by: string;
            creator_name?: string;
            crew_id: string;
            expires_at: string | null;
            id: string;
            label: string;
            latitude: number | null;
            location: string;
            longitude: number | null;
            meet_at: string | null;
            recurs_daily: boolean;
            stage_reference: string | null;
            type: string;
            updated_at: string;
        };
        NotificationPrefs: {
            crewReformed: number;
            crewUpdates: number;
            dndEnd: string | null;
            dndStart: string | null;
            lineupDrops: number;
            scheduleChanges: number;
            setReminders: number;
            userId: string;
            wrapReady: number;
        };
        /** @enum {string} */
        PickPriority: "must" | "want-to-see" | "maybe";
        Profile: {
            avatarUrl: string | null;
            createdAt: string;
            festivalId: string;
            id: string;
            name: string;
            notes?: {
                [key: string]: string;
            };
            picks: {
                [key: string]: "must" | "want-to-see" | "maybe";
            };
            reminders?: {
                [key: string]: number;
            };
            updatedAt: string;
            userId: string | null;
        };
        RefreshTokenResponse: {
            refreshToken?: string;
            token?: string;
            user: {
                avatarUrl: string | null;
                cashappCashtag: string | null;
                email: string | null;
                emailVerified: boolean;
                id: string;
                name: string | null;
                paypalHandle: string | null;
                username: string;
                venmoHandle: string | null;
            };
        };
        Set: {
            endTime?: string | null;
            id?: string;
            linkUrl?: string | null;
            name?: string;
            stageId?: string;
            startTime?: string | null;
        };
        Stage: {
            color: string | null;
            id: string;
            latitude: number | null;
            longitude: number | null;
            name: string;
        };
        Success: {
            /** @description Response payload */
            data?: unknown;
            error?: null;
            /** @description Optional metadata (pagination, etc.) */
            meta?: Record<string, never>;
        };
        User: {
            avatarUrl: string | null;
            cashappCashtag: string | null;
            email: string | null;
            emailVerified: boolean;
            id: string;
            name: string | null;
            paypalHandle: string | null;
            username: string;
            venmoHandle: string | null;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
