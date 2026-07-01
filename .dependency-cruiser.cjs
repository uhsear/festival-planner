/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies lead to hard-to-debug issues and tight coupling.',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'no-routes-importing-routes',
      severity: 'error',
      comment: 'Route modules should not import from other route modules. Extract shared logic to lib/.',
      from: {
        path: '^routes/',
      },
      to: {
        path: '^routes/',
      },
    },
    {
      name: 'no-stores-importing-routes',
      severity: 'error',
      comment: 'Data access layer (lib/db/stores/) must not depend on route handlers.',
      from: {
        path: '^lib/db/stores/',
      },
      to: {
        path: '^routes/',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    // The backend is TypeScript run via tsx (no build step). Without tsConfig +
    // tsPreCompilationDeps, dependency-cruiser only follows runtime-resolvable
    // deps and cruises a fraction of modules — making the circular/boundary
    // guards near-useless. Point it at the real tsconfig and follow TS imports.
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)',
      },
    },
  },
};
