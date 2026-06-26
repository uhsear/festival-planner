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
                    content?: never;
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
                    content?: never;
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
                    content?: never;
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
        Profile: {
            festivalId?: string;
            id?: string;
            name?: string;
            picks?: {
                [key: string]: "must" | "want-to-see" | "maybe";
            };
            userId?: string;
        };
        RefreshTokenResponse: {
            /** @description New refresh token (90-day TTL) */
            refreshToken?: string;
            /** @description New session token */
            token?: string;
            user?: components["schemas"]["User"];
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
