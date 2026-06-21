import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';
import { FESTIE_RUNTIME_CACHING } from '@festie/shared/pwa';
import path from 'path';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1100,
    target: 'es2022',
    cssCodeSplit: true,
    rolldownOptions: {
      output: {
        // Split the vendor bundle into logical chunks so the 697 KB index chunk
        // becomes a small shell + cacheable vendor groups. Parallel HTTP/2 load
        // plus cache longevity (react-core rarely changes; export-tools only
        // loads on Share/Export tap). Matches the bundle-viz treemap groupings.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.match(/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/)) return 'react-core';
          if (id.includes('@tanstack')) return 'router';
          if (id.includes('zustand') || id.includes('socket.io-client') || id.includes('/zod/')) return 'data';
          if (id.includes('vaul') || id.includes('@radix-ui') || id.includes('/motion/') || id.includes('@use-gesture'))
            return 'ui-motion';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('html-to-image')) return 'export-tools';
          if (id.includes('@sentry')) return 'telemetry';
          if (id.includes('web-vitals') || id.includes('workbox')) return 'telemetry';
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    process.env.ANALYZE && visualizer({ open: true, gzipSize: true, brotliSize: true }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Festie — Festival Planner',
        short_name: 'Festie',
        description: 'Plan your festival schedule with friends',
        theme_color: '#080810',
        background_color: '#080810',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Serve the SPA shell for client-routed navigations, but let real
        // server-rendered static pages (privacy/terms/etc., any *.html, the
        // API, and /.well-known) fall through to the network — otherwise the
        // service worker shadows them with index.html and the router 404s.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [
          /^\/privacy/,
          /^\/terms/,
          /^\/security-whitepaper/,
          /\.html$/,
          /^\/api/,
          /^\/\.well-known/,
          // Server-owned flows: password reset and crew-join links must hit the
          // network so the server can validate tokens / redirect correctly.
          // Without these the installed PWA intercepts them and serves index.html,
          // which means the token never reaches the server and the flow breaks.
          /^\/reset(\/|-password)/,
          /^\/join\//,
        ],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Vite's manualChunks does not produce admin-prefixed filenames; the
        // original '**/admin-*.js' glob matched nothing in practice.  Dropped to
        // avoid a misleading no-op.  If admin-only chunks are later split out
        // with a known naming convention, add a targeted pattern here.
        globIgnores: [],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // THE GATE: the runtimeCaching rules are the single source of truth in
        // @festie/shared/pwa so the shipped SW and the cross-account boundary
        // test (sw-parity.test.ts) can never drift. Edit the rules there.
        runtimeCaching: FESTIE_RUNTIME_CACHING,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@festie/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://127.0.0.1:4000',
        changeOrigin: true,
        // Rewrite Origin header so Express CSRF check doesn't reject dev server origin
        headers: { Origin: 'http://127.0.0.1:4000' },
        // Strip Secure flag from cookies so they work over HTTP in dev
        cookieDomainRewrite: '',
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const sc = proxyRes.headers['set-cookie'];
            if (sc) {
              proxyRes.headers['set-cookie'] = (Array.isArray(sc) ? sc : [sc]).map((c) =>
                c.replace(/;\s*Secure/gi, '').replace(/;\s*SameSite=Strict/gi, '; SameSite=Lax'),
              );
            }
          });
        },
      },
      '/socket.io': {
        target: process.env.VITE_API_URL || 'http://127.0.0.1:4000',
        changeOrigin: true,
        ws: true,
        headers: { Origin: 'http://127.0.0.1:4000' },
      },
    },
  },
});
