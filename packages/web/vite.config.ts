import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

export default defineConfig({
  build: {
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
        ],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: ['**/admin-*.js'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // Cache ONLY the public festival catalog (GET /festivals,
            // /festivals/:id) for offline schedule viewing. Per-user endpoints
            // (/auth, /profiles, /crews, /account) must never be cached —
            // StaleWhileRevalidate keys by URL only (ignores the session
            // cookie), so on a shared device an account switch would otherwise
            // repaint the previous user's data until the revalidate lands.
            urlPattern: ({ url, request }: { url: URL; request: Request }) =>
              request.method === 'GET' && /^\/api\/v1\/festivals(\/[^/]+)?$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // F5: cache the PUBLIC weather GET (/api/v1/weather/:festivalId) so a
            // downloaded festival shows its forecast offline. Weather is NOT
            // per-user (it keys off the festival's coords), so URL-keyed SW
            // caching is safe here — unlike /profiles or /crews, which stay in
            // zustand-persist. NetworkFirst with a short timeout: prefer fresh
            // data when online, fall back to the cached forecast when offline.
            urlPattern: ({ url, request }: { url: URL; request: Request }) =>
              request.method === 'GET' && /^\/api\/v1\/weather\/[^/]+$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'weather-cache',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 6 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // F5: CacheFirst for artist/album art (Spotify CDNs + our app art
            // host). These are immutable, content-addressed PUBLIC images — once
            // cached they render offline on set cards / detail panels. Bounded to
            // ~300 entries so the cache can't grow unbounded on a big lineup.
            urlPattern: ({ url }: { url: URL }) =>
              /(^|\.)scdn\.co$/.test(url.hostname) ||
              /(^|\.)spotifycdn\.com$/.test(url.hostname) ||
              url.hostname === 'art.festie.us',
            handler: 'CacheFirst',
            options: {
              cacheName: 'art-cache',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
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
