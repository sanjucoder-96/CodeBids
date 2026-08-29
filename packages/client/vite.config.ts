import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Offline-first build (spec section 41):
 *  - no CDN, no remote fonts, no analytics: every asset is emitted locally,
 *  - assetsInlineLimit keeps small icons inline so there are fewer requests,
 *  - the dev server proxies /api and /ws to the local game server.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4400', changeOrigin: true },
      '/ws': { target: 'ws://localhost:4400', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
