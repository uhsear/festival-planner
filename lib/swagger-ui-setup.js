// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

/**
 * Swagger UI Express setup for Festie API
 * Mounts interactive API documentation at /api/docs
 * Points to OpenAPI spec at /api/docs/openapi.json
 */

function mountSwaggerUI(app, config) {
  let swaggerUi;
  try {
    swaggerUi = require('swagger-ui-express');
  } catch {
    // swagger-ui-express not installed — skip silently
    return;
  }

  const { generateOpenAPISpec } = require('./openapi');
  const spec = generateOpenAPISpec(config);

  // Serve Swagger UI assets
  app.use('/api/docs', swaggerUi.serve);

  // Setup Swagger UI with custom configuration
  app.get('/api/docs', swaggerUi.setup(spec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Festie API Docs',
    swaggerOptions: {
      deepLinking: true,
    },
  }));
}

module.exports = { mountSwaggerUI };
