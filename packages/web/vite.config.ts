import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
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
          if (id.includes('vaul') || id.includes('@radix-ui') || id.includes('/motion/') || id.includes('@use-gesture')) return 'ui-motion';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('html-to-image')) return 'export-tools';
          if (id.includes('web-vitals') || id.includes('workbox')) return 'telemetry';
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: /\/api\/v1\//,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 },
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
      // Proxy legacy static assets (app.css, icons, etc.) to the Express server
      '/app.css': {
        target: process.env.VITE_API_URL || 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
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
              proxyRes.headers['set-cookie'] = (Array.isArray(sc) ? sc : [sc]).map(
                (c) => c.replace(/;\s*Secure/gi, '').replace(/;\s*SameSite=Strict/gi, '; SameSite=Lax')
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
