import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { generateOpenAPISpec } from '../lib/openapi.js';

describe('openapi: generateOpenAPISpec', () => {
  it('returns a valid OpenAPI 3.0.3 object', () => {
    const spec = generateOpenAPISpec({});
    assert.equal(spec.openapi, '3.0.3');
    assert.ok(spec.info);
    assert.ok(spec.paths);
    assert.ok(spec.components);
  });

  it('includes Festie API title', () => {
    const spec = generateOpenAPISpec({});
    assert.equal(spec.info.title, 'Festie API');
  });

  it('uses API_VERSION from config', () => {
    const spec = generateOpenAPISpec({ API_VERSION: '3' });
    assert.equal(spec.info.version, '1.3');
  });

  it('defaults to version 1.0 when API_VERSION is absent', () => {
    const spec = generateOpenAPISpec({});
    assert.equal(spec.info.version, '1.0');
  });

  it('uses PUBLIC_ORIGIN for server URL when provided', () => {
    const spec = generateOpenAPISpec({ PUBLIC_ORIGIN: 'https://festie.us' });
    assert.equal(spec.servers[0]!.url, 'https://festie.us');
    assert.equal(spec.servers[0]!.description, 'Production');
  });

  it('defaults to localhost when PUBLIC_ORIGIN is absent', () => {
    const spec = generateOpenAPISpec({});
    assert.equal(spec.servers[0]!.url, 'http://localhost:4000');
    assert.equal(spec.servers[0]!.description, 'Local dev');
  });

  it('defines bearerAuth and cookieAuth security schemes', () => {
    const spec = generateOpenAPISpec({});
    const schemes = spec.components.securitySchemes;
    assert.equal(schemes.bearerAuth.type, 'http');
    assert.equal(schemes.bearerAuth.scheme, 'bearer');
    assert.equal(schemes.cookieAuth.type, 'apiKey');
    assert.equal(schemes.cookieAuth.in, 'cookie');
  });

  it('defines Error and Success component schemas', () => {
    const spec = generateOpenAPISpec({});
    assert.ok(spec.components.schemas.Error);
    assert.ok(spec.components.schemas.Success);
  });

  it('defines User, Festival, Stage, Day, Set, Profile schemas', () => {
    const spec = generateOpenAPISpec({});
    const schemas = spec.components.schemas;
    for (const name of ['User', 'Festival', 'Stage', 'Day', 'Set', 'Profile']) {
      assert.ok((schemas as Record<string, any>)[name], `Missing schema: ${name}`);
    }
  });

  it('includes auth endpoints', () => {
    const spec = generateOpenAPISpec({});
    assert.ok(spec.paths['/api/v1/auth/register']);
    assert.ok(spec.paths['/api/v1/auth/login']);
    assert.ok(spec.paths['/api/v1/auth/logout']);
    assert.ok(spec.paths['/api/v1/auth/me']);
    assert.ok(spec.paths['/api/v1/auth/refresh-token']);
  });

  it('includes festival, profile, and crew endpoints', () => {
    const spec = generateOpenAPISpec({});
    assert.ok(spec.paths['/api/v1/festivals']);
    assert.ok(spec.paths['/api/v1/festivals/{id}']);
    assert.ok(spec.paths['/api/v1/profiles/{festivalId}']);
    assert.ok(spec.paths['/api/v1/crews']);
  });

  it('includes health endpoints', () => {
    const spec = generateOpenAPISpec({});
    assert.ok(spec.paths['/health/live']);
    assert.ok(spec.paths['/api/v1/health']);
  });

  it('includes notification endpoints', () => {
    const spec = generateOpenAPISpec({});
    assert.ok(spec.paths['/api/v1/notifications/tokens']);
    assert.ok(spec.paths['/api/v1/notifications/preferences']);
  });

  it('includes admin bulk endpoints', () => {
    const spec = generateOpenAPISpec({});
    assert.ok(spec.paths['/api/v1/admin/bulk/deactivate']);
    assert.ok(spec.paths['/api/v1/admin/bulk/archive-festivals']);
  });

  it('has expected tags', () => {
    const spec = generateOpenAPISpec({});
    const tagNames = spec.tags.map((t: any) => t.name);
    assert.ok(tagNames.includes('Auth'));
    assert.ok(tagNames.includes('Festivals'));
    assert.ok(tagNames.includes('Crews'));
    assert.ok(tagNames.includes('Health'));
    assert.ok(tagNames.includes('Notifications'));
  });

  it('derives the register request body from the Zod schema (drift closed)', () => {
    // The register request body is now a projection of `registerSchema` in
    // lib/schemas.ts via zod-openapi — NOT a hand-written duplicate. This pins
    // the username bounds to the authoritative validator (z.string().min(1).max(40))
    // and guards against the old drift where the hand-written spec claimed
    // minLength:2 / maxLength:30.
    const spec = generateOpenAPISpec({});
    const body = (spec.paths['/api/v1/auth/register'] as any).post.requestBody;
    const schema = body.content['application/json'].schema;
    const username = schema.properties.username;
    assert.equal(username.type, 'string');
    assert.equal(username.minLength, 1, 'username minLength must equal the Zod schema (.min(1))');
    assert.equal(username.maxLength, 40, 'username maxLength must equal the Zod schema (.max(40))');
    // Password bounds also come from the Zod schema (.min(8).max(200)).
    assert.equal(schema.properties.password.minLength, 8);
    assert.equal(schema.properties.password.maxLength, 200);
    // Fields the validator requires but the old hand-written spec omitted are
    // now documented because they are derived, not transcribed.
    assert.ok(schema.required.includes('username'));
    assert.ok(schema.required.includes('dateOfBirth'));
    assert.ok(schema.required.includes('tosAccepted'));
  });

  it('derives the login request body from the Zod schema', () => {
    const spec = generateOpenAPISpec({});
    const schema = (spec.paths['/api/v1/auth/login'] as any).post.requestBody.content['application/json'].schema;
    // loginSchema enforces username .max(40) — the derived spec reflects it.
    assert.equal(schema.properties.username.maxLength, 40);
    assert.deepEqual([...schema.required].sort(), ['password', 'username']);
  });

  it('derives the festival depth query parameter from the Zod schema', () => {
    const spec = generateOpenAPISpec({});
    const params = (spec.paths['/api/v1/festivals/{id}'] as any).get.parameters as any[];
    const depth = params.find((p) => p.name === 'depth');
    assert.ok(depth, 'depth query param present');
    assert.equal(depth.in, 'query');
    // festivalDepthQuery is z.coerce.number().int().min(0).max(2).optional()
    assert.equal(depth.required, false);
    assert.equal(depth.schema.minimum, 0);
    assert.equal(depth.schema.maximum, 2);
  });

  it('handles null config gracefully', () => {
    const spec = generateOpenAPISpec(null);
    assert.equal(spec.openapi, '3.0.3');
    assert.equal(spec.info.version, '1.0');
  });

  it('handles undefined config gracefully', () => {
    const spec = generateOpenAPISpec(undefined);
    assert.equal(spec.openapi, '3.0.3');
  });
});
