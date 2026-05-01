// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

function mountSwaggerUI(app, config) {
  const path = require('path');
  const express = require('express');

  let distDir;
  try {
    distDir = path.dirname(require.resolve('swagger-ui-dist/swagger-ui-bundle.js'));
  } catch {
    return;
  }

  const { generateOpenAPISpec } = require('./openapi');
  const spec = generateOpenAPISpec(config);

  // Serve swagger-ui-dist static files (JS, CSS, maps)
  app.use('/api/docs', express.static(distDir, { index: false, maxAge: 86400000 }));

  // Serve custom HTML page with absolute asset paths
  app.get('/api/docs', (req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Festie API Docs</title>
  <link rel="stylesheet" href="/api/docs/swagger-ui.css">
  <style>.swagger-ui .topbar { display: none } body { scrollbar-width: thin; scrollbar-color: #666 transparent; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api/docs/swagger-ui-bundle.js"></script>
  <script src="/api/docs/swagger-ui-standalone-preset.js"></script>
  <script>
    SwaggerUIBundle({
      spec: ${JSON.stringify(spec)},
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: 'StandaloneLayout'
    });
  </script>
</body>
</html>`);
  });
}

module.exports = { mountSwaggerUI };
