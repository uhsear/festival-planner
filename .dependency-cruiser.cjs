/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment:
        'A dependency the cruiser cannot resolve is invisible to every rule below. This gate ' +
        'passed vacuously for months: dependency-cruiser 16 refused to load TypeScript 6, dropped ' +
        '.ts from its resolver extensions, and left all ~200 first-party relative imports ' +
        'unresolved, so no rule matched anything. Keep this rule first — it is what makes the ' +
        'gate fail loudly instead of silently going blind the next time the toolchain moves.',
      from: {},
      to: {
        couldNotResolve: true,
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular dependencies lead to hard-to-debug issues and tight coupling. viaOnly.' +
        'dependencyTypesNot limits this to cycles made entirely of runtime edges — the ones ' +
        'that can actually deadlock a module at require time. Cycles that contain an ' +
        '`import type` edge are erased by the transpiler and are reported by ' +
        'no-circular-type-only below instead of failing the build.',
      from: {},
      to: {
        circular: true,
        viaOnly: {
          dependencyTypesNot: ['type-only'],
        },
      },
    },
    {
      name: 'no-circular-type-only',
      severity: 'warn',
      comment:
        'A cycle that survives only because at least one edge is `import type`. Not a runtime ' +
        'hazard (TypeScript erases those imports), but still a design smell worth seeing on ' +
        'every run. Known instance: lib/helpers.ts -> lib/types/app-context.ts -> lib/schemas.ts ' +
        '-> lib/helpers.ts, where the first two edges are type-only.',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'no-routes-importing-routes',
      severity: 'error',
      comment:
        'Route modules should not import from other route modules. Extract shared logic to lib/. ' +
        'Exempted in `from` are the four aggregator routes that exist purely to compose child ' +
        'routers (admin.ts mounts admin-users/audit/bulk, crews.ts mounts the crew-* routers, ' +
        'crew-features.ts mounts crew-meeting-points/crew-polls, health.ts mounts health-core/' +
        'admin-status/admin-metrics). Every one of those imports is a default-exported router ' +
        'factory that the parent invokes and mounts a few lines later; moving router factories ' +
        'into lib/ would put HTTP handlers in the data layer and make this worse. Verified as ' +
        'exhaustive: when this gate was first made to run it also exposed ONE genuine shared- ' +
        'logic leak, generateUniqueInviteCode imported from crew-invites.ts, and that was moved ' +
        'to lib/invite-code.ts rather than exempted. Re-check that claim before widening this ' +
        'list. The exemption is on `from` only, so the four aggregators remain forbidden as ' +
        'TARGETS, and the rule still catches every other route-to-route import, including a ' +
        'child route reaching back into an aggregator or sideways into a sibling.',
      from: {
        path: '^routes/',
        pathNot: '^routes/(admin|crews|crew-features|health)\\.ts$',
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
    // These options only take effect when dependency-cruiser can actually load
    // the installed TypeScript (see supportedTranspilers in its meta.cjs, and
    // `depcruise --info`). If it cannot, they no-op silently — which is exactly
    // what not-to-unresolvable above is there to catch.
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
