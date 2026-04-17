'use strict';

/**
 * OpenAPI 3.0 spec generator — produces a JSON spec from the app's route/schema definitions.
 * Served at GET /api/docs/openapi.json
 */

function generateOpenAPISpec(config) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Festie API',
      version: `1.${config?.API_VERSION || '0'}`,
      description: 'Real-time festival schedule planner — coordinate sets with your crew.',
      contact: { name: 'Asir Khan', url: 'https://festie.us' },
    },
    servers: [
      { url: config?.PUBLIC_ORIGIN || 'https://festie.us', description: 'Production' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Session token from /auth/login or /auth/register' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'fp_session', description: 'httpOnly session cookie' },
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
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            username: { type: 'string' },
            avatarUrl: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Festival: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            stages: { type: 'array', items: { $ref: '#/components/schemas/Stage' } },
            days: { type: 'array', items: { $ref: '#/components/schemas/Day' } },
          },
        },
        Stage: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' }, sortOrder: { type: 'integer' } },
        },
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
        Profile: {
          type: 'object',
          properties: {
            id: { type: 'string' }, userId: { type: 'string' }, festivalId: { type: 'string' },
            name: { type: 'string' }, picks: { type: 'object', additionalProperties: { type: 'string', enum: ['must', 'want-to-see', 'maybe'] } },
          },
        },
        RefreshTokenResponse: {
          type: 'object',
          properties: {
            user: { $ref: '#/components/schemas/User' },
            token: { type: 'string', description: 'New session token' },
            refreshToken: { type: 'string', description: 'New refresh token (90-day TTL)' },
          },
        },
      },
    },
    paths: {
      '/api/v1/auth/register': {
        post: {
          tags: ['Auth'], summary: 'Register new user',
          requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['username', 'password', 'confirmPassword'], properties: { username: { type: 'string', minLength: 2, maxLength: 30 }, password: { type: 'string', minLength: 8 }, confirmPassword: { type: 'string' } } } } } },
          responses: { 201: { description: 'User created', content: { 'application/json': { schema: { $ref: '#/components/schemas/RefreshTokenResponse' } } } } },
        },
      },
      '/api/v1/auth/login': {
        post: {
          tags: ['Auth'], summary: 'Login',
          requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string' } } } } } },
          responses: { 200: { description: 'Login successful' }, 401: { description: 'Invalid credentials' }, 423: { description: 'Account locked' } },
        },
      },
      '/api/v1/auth/refresh-token': {
        post: {
          tags: ['Auth'], summary: 'Exchange refresh token for new session + refresh token',
          requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } } } } },
          responses: { 200: { description: 'Tokens rotated', content: { 'application/json': { schema: { $ref: '#/components/schemas/RefreshTokenResponse' } } } }, 401: { description: 'Invalid/expired refresh token' } },
        },
      },
      '/api/v1/auth/me': {
        get: { tags: ['Auth'], summary: 'Get current user', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Current user info' } } },
      },
      '/api/v1/auth/logout': {
        post: { tags: ['Auth'], summary: 'Logout', responses: { 200: { description: 'Session invalidated' } } },
      },
      '/api/v1/auth/refresh': {
        post: { tags: ['Auth'], summary: 'Refresh session token (requires valid session)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'New session token' } } },
      },
      '/api/v1/festivals': {
        get: { tags: ['Festivals'], summary: 'List all festivals', responses: { 200: { description: 'Festival list (ETag-cached)' } } },
      },
      '/api/v1/festivals/{id}': {
        get: {
          tags: ['Festivals'], summary: 'Get festival by ID',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'depth', in: 'query', schema: { type: 'integer', enum: [0, 1, 2] } }],
          responses: { 200: { description: 'Festival data' } },
        },
      },
      '/api/v1/profiles/{festivalId}': {
        get: { tags: ['Profiles'], summary: 'List profiles for festival', security: [{ bearerAuth: [] }], parameters: [{ name: 'festivalId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Profile list' } } },
      },
      '/api/v1/profiles/{festivalId}/join': {
        post: { tags: ['Profiles'], summary: 'Join festival', security: [{ bearerAuth: [] }], responses: { 201: { description: 'Profile created' } } },
      },
      '/api/v1/profiles/{festivalId}/picks': {
        put: { tags: ['Profiles'], summary: 'Update picks (with ETag concurrency)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Picks updated' }, 409: { description: 'Version mismatch' } } },
      },
      '/api/v1/crews': {
        get: { tags: ['Crews'], summary: 'List user crews', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Crew list' } } },
        post: { tags: ['Crews'], summary: 'Create crew', security: [{ bearerAuth: [] }], responses: { 201: { description: 'Crew created' } } },
      },
      '/api/v1/crews/join/{code}': {
        post: { tags: ['Crews'], summary: 'Join crew by invite code', security: [{ bearerAuth: [] }], parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Joined crew' } } },
      },
      '/api/v1/crews/{crewId}/overlap': {
        get: { tags: ['Crews'], summary: 'Get crew pick overlap analysis', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Overlap data' } } },
      },
      '/api/v1/festivals/{festivalId}/calendar': {
        get: { tags: ['Export'], summary: 'Calendar events JSON for native integration', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Calendar events' } } },
      },
      '/api/v1/notifications/tokens': {
        post: { tags: ['Notifications'], summary: 'Register FCM push token', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Token registered' } } },
      },
      '/api/v1/notifications/preferences': {
        get: { tags: ['Notifications'], summary: 'Get notification preferences', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Preferences' } } },
        put: { tags: ['Notifications'], summary: 'Update notification preferences', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Updated' } } },
      },
      '/api/v1/admin/bulk/deactivate': {
        post: { tags: ['Admin'], summary: 'Bulk deactivate users', security: [{ bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { userIds: { type: 'array', items: { type: 'string' }, maxItems: 50 } } } } } }, responses: { 200: { description: 'Results' } } },
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

module.exports = { generateOpenAPISpec };
