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
        pathNot: '^routes/index\\.js$',
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
    tsPreCompilationDeps: false,
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
