'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { generateOpenAPISpec } = require('../lib/openapi');

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
    assert.equal(spec.servers[0].url, 'https://festie.us');
    assert.equal(spec.servers[0].description, 'Production');
  });

  it('defaults to localhost when PUBLIC_ORIGIN is absent', () => {
    const spec = generateOpenAPISpec({});
    assert.equal(spec.servers[0].url, 'http://localhost:4000');
    assert.equal(spec.servers[0].description, 'Local dev');
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
      assert.ok(schemas[name], `Missing schema: ${name}`);
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
    const tagNames = spec.tags.map((t) => t.name);
    assert.ok(tagNames.includes('Auth'));
    assert.ok(tagNames.includes('Festivals'));
    assert.ok(tagNames.includes('Crews'));
    assert.ok(tagNames.includes('Health'));
    assert.ok(tagNames.includes('Notifications'));
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
