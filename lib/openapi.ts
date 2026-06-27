/**
 * OpenAPI 3.0 spec generator — produces a JSON spec from the app's route/schema definitions.
 * Served at GET /api/docs/openapi.json — dev/staging ONLY (gated
 * NODE_ENV !== 'production' in middleware.ts; the contract is intentionally not
 * exposed on the public prod API to keep the attack surface small).
 *
 * REQUEST bodies and params are DERIVED from the authoritative Zod schemas in
 * `lib/schemas.ts` via zod-openapi's `createSchema` (zod v4-native). This makes
 * the documented request contract a projection of the validator — the docs can
 * no longer silently disagree with what the server actually accepts (the prior
 * hand-written `username` bounds had drifted to minLength:2/maxLength:30 while
 * the validator enforced min1/max40).
 *
 * RESPONSE component schemas are now DERIVED from the response-shape Zod schemas
 * in `lib/responseSchemas.ts` (Phase 2) via `createSchema(..., { io: 'output' })`,
 * so the documented payloads are a projection of the same schemas that model what
 * the serializers actually emit. They are registered as components and attached
 * as the success-response bodies of the matching routes. A few placeholder
 * components with no response Zod schema yet (Day, Set, Profile, the auth token
 * envelope) remain hand-written.
 *
 * `createSchema` is synchronous, so `generateOpenAPISpec` stays a plain function
 * the request handler / Swagger mount can call on demand under tsx.
 */

import type { z } from 'zod';
import { createSchema } from 'zod-openapi';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  adminBulkDeactivateSchema,
  festivalDepthQuery,
} from './schemas';
import { responseSchemas } from './responseSchemas';

/**
 * Convert a Zod schema to an OpenAPI 3.0.3 JSON Schema object (the request half
 * of an operation). `io: 'input'` so we document what the client must SEND
 * (pre-transform), and the 3.0.3 target so the emitted dialect matches the
 * spec's `openapi: '3.0.3'` (nullable/format rendered the 3.0 way, not 3.1).
 */
function zodSchema(schema: z.ZodType): Record<string, any> {
  return createSchema(schema, { io: 'input', openapiVersion: '3.0.3' }).schema as Record<string, any>;
}

/** Wrap a derived Zod schema as an application/json request body. */
function jsonBody(schema: z.ZodType) {
  return { content: { 'application/json': { schema: zodSchema(schema) } } };
}

/**
 * Convert a RESPONSE Zod schema to OpenAPI 3.0.3 JSON Schema. `io: 'output'` so
 * we document what the client RECEIVES (post-transform / serialized), the
 * mirror of the request half above.
 */
function zodResponseSchema(schema: z.ZodType): Record<string, any> {
  return createSchema(schema, { io: 'output', openapiVersion: '3.0.3' }).schema as Record<string, any>;
}

/**
 * The derived response component schemas, keyed by their OpenAPI component name.
 * These OVERRIDE the prior hand-written User/Festival/Stage placeholders and add
 * the previously-missing entities. Each is self-contained (nested schemas are
 * inlined by `createSchema`), so the spec needs no cross-component $refs here.
 */
const responseComponents: Record<string, Record<string, any>> = {
  User: zodResponseSchema(responseSchemas.user),
  Stage: zodResponseSchema(responseSchemas.stage),
  Artist: zodResponseSchema(responseSchemas.artist),
  FestivalSet: zodResponseSchema(responseSchemas.festivalSet),
  FestivalDepth1: zodResponseSchema(responseSchemas.festivalDepth1),
  Festival: zodResponseSchema(responseSchemas.festival),
  Crew: zodResponseSchema(responseSchemas.crew),
  CrewMember: zodResponseSchema(responseSchemas.crewMember),
  MeetingPoint: zodResponseSchema(responseSchemas.meetingPoint),
  // Phase 2 breadth — the remaining serialized entities. These OVERRIDE the
  // hand-written Profile / RefreshTokenResponse placeholders below (spread last)
  // and add the previously-undocumented crew/notification/auth shapes.
  FestivalListItem: zodResponseSchema(responseSchemas.festivalListItem),
  PickPriority: zodResponseSchema(responseSchemas.pickPriority),
  Profile: zodResponseSchema(responseSchemas.profile),
  CrewPoll: zodResponseSchema(responseSchemas.crewPoll),
  CrewPollVote: zodResponseSchema(responseSchemas.crewPollVote),
  CrewExpense: zodResponseSchema(responseSchemas.crewExpense),
  CrewSettlementPlan: zodResponseSchema(responseSchemas.crewSettlementPlan),
  CrewPackingItem: zodResponseSchema(responseSchemas.crewPackingItem),
  CrewRideOffer: zodResponseSchema(responseSchemas.crewRideOffer),
  CrewMemberStatus: zodResponseSchema(responseSchemas.crewMemberStatus),
  CrewActivityEntry: zodResponseSchema(responseSchemas.crewActivityEntry),
  NotificationPrefs: zodResponseSchema(responseSchemas.notificationPrefs),
  // The auth envelope backs both AuthEnvelope and the existing
  // RefreshTokenResponse component (same wire shape: { user, token?, refreshToken? }).
  AuthEnvelope: zodResponseSchema(responseSchemas.authEnvelope),
  RefreshTokenResponse: zodResponseSchema(responseSchemas.authEnvelope),
};

/** A `200`/`201` response body that $refs a registered response component. */
function jsonResponseRef(name: string) {
  return { content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } };
}

/** A success response body that is an ARRAY of a registered response component. */
function jsonResponseArrayRef(name: string) {
  return { content: { 'application/json': { schema: { type: 'array', items: { $ref: `#/components/schemas/${name}` } } } } };
}

/** A `{ ref: '#/components/schemas/<name>' }` reference (component property value). */
function ref(name: string) {
  return { $ref: `#/components/schemas/${name}` };
}

/**
 * A success body that is an OBJECT wrapping registered components — the common
 * crew sub-resource shape (e.g. `{ poll }`, `{ items, nextCursor }`). `props`
 * maps each wrapper key to its property schema (use `ref`/array shapes).
 */
function jsonResponseWrapper(props: Record<string, any>) {
  return { content: { 'application/json': { schema: { type: 'object', properties: props } } } };
}

/** Shorthand: an array-of-component property schema for a wrapper object. */
function arrayOf(name: string) {
  return { type: 'array', items: ref(name) };
}

/** The `crewId` path parameter shared by every crew sub-resource route. */
const crewIdPathParam = { name: 'crewId', in: 'path', required: true, schema: { type: 'string' } };

/**
 * Project a Zod object schema's top-level properties into OpenAPI query
 * `parameters`. Used for query schemas (e.g. the festival `depth` filter) so the
 * documented query contract is also derived from the validator.
 */
function queryParams(schema: z.ZodType): Array<Record<string, any>> {
  const json = zodSchema(schema);
  const props: Record<string, any> = json.properties || {};
  const required: string[] = json.required || [];
  return Object.entries(props).map(([name, propSchema]) => ({
    name,
    in: 'query',
    required: required.includes(name),
    schema: propSchema,
  }));
}

export function generateOpenAPISpec(config: any) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Festie API',
      version: `1.${config?.API_VERSION || '0'}`,
      description: 'Real-time festival schedule planner — coordinate sets with your crew.',
      contact: { name: 'Asir Khan', url: 'https://festie.us' },
    },
    servers: [
      { url: config?.PUBLIC_ORIGIN || 'http://localhost:4000', description: config?.PUBLIC_ORIGIN ? 'Production' : 'Local dev' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Session token from /auth/login or /auth/register' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'festie_session', description: 'httpOnly session cookie' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            data: { type: 'null' },
            error: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                status: { type: 'integer' },
                code: { type: 'string', description: 'Machine-readable error code' },
                retryable: { type: 'boolean', description: 'Whether the client should retry this request' },
              },
            },
          },
        },
        Success: {
          type: 'object',
          properties: {
            data: { description: 'Response payload' },
            error: { type: 'null' },
            meta: { type: 'object', description: 'Optional metadata (pagination, etc.)' },
          },
        },
        // User, Stage, Festival (and Artist/FestivalSet/FestivalDepth1/Crew/
        // CrewMember/MeetingPoint) are derived from lib/responseSchemas.ts and
        // spread in via `...responseComponents` at the end of this block.
        Day: {
          type: 'object',
          properties: {
            id: { type: 'string' }, name: { type: 'string' }, date: { type: 'string' },
            sets: { type: 'array', items: { $ref: '#/components/schemas/Set' } },
          },
        },
        Set: {
          type: 'object',
          properties: {
            id: { type: 'string' }, name: { type: 'string' }, stageId: { type: 'string' },
            startTime: { type: 'string', nullable: true }, endTime: { type: 'string', nullable: true },
            linkUrl: { type: 'string', nullable: true },
          },
        },
        // Profile and RefreshTokenResponse are now DERIVED (see responseComponents:
        // Profile ⇐ profileResponseSchema, RefreshTokenResponse ⇐ authEnvelopeResponseSchema)
        // and spread in below, so their hand-written placeholders were removed.
        // Derived response components (override User/Stage/Festival placeholders
        // above and add Artist/FestivalSet/FestivalDepth1/Crew/CrewMember/
        // MeetingPoint + the Phase-2 breadth entities). Spread LAST so the
        // derived definitions win.
        ...responseComponents,
      },
    },
    paths: {
      '/api/v1/auth/register': {
        post: {
          tags: ['Auth'], summary: 'Register new user',
          requestBody: jsonBody(registerSchema),
          responses: { 201: { description: 'User created', content: { 'application/json': { schema: { $ref: '#/components/schemas/RefreshTokenResponse' } } } } },
        },
      },
      '/api/v1/auth/login': {
        post: {
          tags: ['Auth'], summary: 'Login',
          requestBody: jsonBody(loginSchema),
          responses: { 200: { description: 'Login successful', ...jsonResponseRef('AuthEnvelope') }, 401: { description: 'Invalid credentials' }, 423: { description: 'Account locked' } },
        },
      },
      '/api/v1/auth/refresh-token': {
        post: {
          tags: ['Auth'], summary: 'Exchange refresh token for new session + refresh token',
          requestBody: jsonBody(refreshTokenSchema),
          responses: { 200: { description: 'Tokens rotated', content: { 'application/json': { schema: { $ref: '#/components/schemas/RefreshTokenResponse' } } } }, 401: { description: 'Invalid/expired refresh token' } },
        },
      },
      '/api/v1/auth/me': {
        get: { tags: ['Auth'], summary: 'Get current user', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Current user info', ...jsonResponseRef('AuthEnvelope') } } },
      },
      '/api/v1/auth/logout': {
        post: { tags: ['Auth'], summary: 'Logout', responses: { 200: { description: 'Session invalidated' } } },
      },
      '/api/v1/auth/refresh': {
        post: { tags: ['Auth'], summary: 'Refresh session token (requires valid session)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'New session token' } } },
      },
      '/api/v1/festivals': {
        get: { tags: ['Festivals'], summary: 'List all festivals', responses: { 200: { description: 'Festival list (ETag-cached)', ...jsonResponseArrayRef('FestivalListItem') } } },
      },
      '/api/v1/festivals/{id}': {
        get: {
          tags: ['Festivals'], summary: 'Get festival by ID',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, ...queryParams(festivalDepthQuery)],
          responses: { 200: { description: 'Festival data (full depth=2 document; depth=1 returns the FestivalDepth1 shape)', ...jsonResponseRef('Festival') } },
        },
      },
      '/api/v1/profiles/{festivalId}': {
        get: { tags: ['Profiles'], summary: 'List profiles for festival', security: [{ bearerAuth: [] }], parameters: [{ name: 'festivalId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Profile list', ...jsonResponseArrayRef('Profile') } } },
      },
      '/api/v1/profiles/{festivalId}/join': {
        post: { tags: ['Profiles'], summary: 'Join festival', security: [{ bearerAuth: [] }], responses: { 201: { description: 'Profile created', ...jsonResponseRef('Profile') } } },
      },
      '/api/v1/profiles/{festivalId}/picks': {
        put: { tags: ['Profiles'], summary: 'Update picks (with ETag concurrency)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Picks updated', ...jsonResponseRef('Profile') }, 409: { description: 'Version mismatch' } } },
      },
      '/api/v1/crews': {
        get: { tags: ['Crews'], summary: 'List user crews', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Crew list', ...jsonResponseArrayRef('Crew') } } },
        post: { tags: ['Crews'], summary: 'Create crew', security: [{ bearerAuth: [] }], responses: { 201: { description: 'Crew created', ...jsonResponseRef('Crew') } } },
      },
      '/api/v1/crews/join/{code}': {
        post: { tags: ['Crews'], summary: 'Join crew by invite code', security: [{ bearerAuth: [] }], parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Joined crew' } } },
      },
      '/api/v1/crews/{crewId}/overlap': {
        get: { tags: ['Crews'], summary: 'Get crew pick overlap analysis', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Overlap data' } } },
      },
      '/api/v1/crews/{crewId}/polls': {
        get: { tags: ['Crews'], summary: 'List active crew polls', security: [{ bearerAuth: [] }], parameters: [crewIdPathParam], responses: { 200: { description: 'Polls (with vote tallies)', ...jsonResponseWrapper({ polls: arrayOf('CrewPoll') }) } } },
        post: { tags: ['Crews'], summary: 'Create crew poll', security: [{ bearerAuth: [] }], parameters: [crewIdPathParam], responses: { 200: { description: 'Poll created', ...jsonResponseWrapper({ poll: ref('CrewPoll') }) } } },
      },
      '/api/v1/crews/{crewId}/expenses': {
        get: { tags: ['Crews'], summary: 'List crew expenses', security: [{ bearerAuth: [] }], parameters: [crewIdPathParam], responses: { 200: { description: 'Expense ledger', ...jsonResponseArrayRef('CrewExpense') } } },
        post: { tags: ['Crews'], summary: 'Add crew expense', security: [{ bearerAuth: [] }], parameters: [crewIdPathParam], responses: { 201: { description: 'Expense created', ...jsonResponseRef('CrewExpense') } } },
      },
      '/api/v1/crews/{crewId}/expenses/settlement-plan': {
        get: { tags: ['Crews'], summary: 'Netted who-pays-whom settlement plan', security: [{ bearerAuth: [] }], parameters: [crewIdPathParam], responses: { 200: { description: 'Balances + settlements', ...jsonResponseRef('CrewSettlementPlan') } } },
      },
      '/api/v1/crews/{crewId}/packing': {
        get: { tags: ['Crews'], summary: 'List crew packing items', security: [{ bearerAuth: [] }], parameters: [crewIdPathParam], responses: { 200: { description: 'Packing board', ...jsonResponseWrapper({ items: arrayOf('CrewPackingItem') }) } } },
        post: { tags: ['Crews'], summary: 'Add packing item', security: [{ bearerAuth: [] }], parameters: [crewIdPathParam], responses: { 200: { description: 'Item created', ...jsonResponseWrapper({ item: ref('CrewPackingItem') }) } } },
      },
      '/api/v1/crews/{crewId}/rides': {
        get: { tags: ['Crews'], summary: 'List crew ride offers', security: [{ bearerAuth: [] }], parameters: [crewIdPathParam], responses: { 200: { description: 'Ride board', ...jsonResponseWrapper({ offers: arrayOf('CrewRideOffer') }) } } },
        post: { tags: ['Crews'], summary: 'Add ride offer', security: [{ bearerAuth: [] }], parameters: [crewIdPathParam], responses: { 200: { description: 'Offer created', ...jsonResponseWrapper({ offer: ref('CrewRideOffer') }) } } },
      },
      '/api/v1/crews/{crewId}/status': {
        get: { tags: ['Crews'], summary: 'List crew member statuses', security: [{ bearerAuth: [] }], parameters: [crewIdPathParam], responses: { 200: { description: 'Member statuses', ...jsonResponseWrapper({ statuses: arrayOf('CrewMemberStatus') }) } } },
        put: { tags: ['Crews'], summary: 'Upsert my own status', security: [{ bearerAuth: [] }], parameters: [crewIdPathParam], responses: { 200: { description: 'Status upserted', ...jsonResponseWrapper({ status: ref('CrewMemberStatus') }) } } },
      },
      '/api/v1/crews/{crewId}/activity': {
        get: { tags: ['Crews'], summary: 'Crew activity feed (cursor-paginated)', security: [{ bearerAuth: [] }], parameters: [crewIdPathParam], responses: { 200: { description: 'Activity entries', ...jsonResponseWrapper({ items: arrayOf('CrewActivityEntry'), nextCursor: { type: 'string', nullable: true } }) } } },
      },
      '/api/v1/festivals/{festivalId}/calendar': {
        get: { tags: ['Export'], summary: 'Calendar events JSON for native integration', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Calendar events' } } },
      },
      '/api/v1/notifications/tokens': {
        post: { tags: ['Notifications'], summary: 'Register FCM push token', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Token registered' } } },
      },
      '/api/v1/notifications/preferences': {
        get: { tags: ['Notifications'], summary: 'Get notification preferences', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Preferences', ...jsonResponseRef('NotificationPrefs') } } },
        put: { tags: ['Notifications'], summary: 'Update notification preferences', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Updated', ...jsonResponseRef('NotificationPrefs') } } },
      },
      '/api/v1/admin/bulk/deactivate': {
        post: { tags: ['Admin'], summary: 'Bulk deactivate users', security: [{ bearerAuth: [] }], requestBody: jsonBody(adminBulkDeactivateSchema), responses: { 200: { description: 'Results' } } },
      },
      '/api/v1/admin/bulk/archive-festivals': {
        post: { tags: ['Admin'], summary: 'Bulk archive festivals', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Results' } } },
      },
      '/health/live': {
        get: { tags: ['Health'], summary: 'Liveness probe (no DB, no auth)', responses: { 200: { description: 'Alive' } } },
      },
      '/api/v1/health': {
        get: { tags: ['Health'], summary: 'Health check with metrics', responses: { 200: { description: 'Health status' } } },
      },
      '/join/{code}': {
        get: { tags: ['Deep Links'], summary: 'Crew invite deep link (redirects to app)', parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }], responses: { 302: { description: 'Redirect to app with joinCrew param' } } },
      },
    },
    tags: [
      { name: 'Auth', description: 'Authentication and session management' },
      { name: 'Festivals', description: 'Festival CRUD and listing' },
      { name: 'Profiles', description: 'Festival participation, picks, notes' },
      { name: 'Crews', description: 'Crew management, invites, overlap' },
      { name: 'Export', description: 'Calendar and data export' },
      { name: 'Notifications', description: 'Push notifications and preferences' },
      { name: 'Admin', description: 'Admin operations' },
      { name: 'Health', description: 'Health checks and metrics' },
      { name: 'Deep Links', description: 'Universal link / deep link handlers' },
    ],
  };
}
