import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { serviceWorker } from './sw-plugin.ts';

// The app is served by the Node server, not by Vite: `npm run build` writes apps/web/dist, and
// src/routes/shell.js sends dist/index.html (with the workspace's look written into it, the way the classic
// portals' pages are) at /dashboard and /employee for anyone who has switched to the new app, and the hashed
// files in dist at /ui. So every URL the build writes is under /ui/.
export default defineConfig({
  base: '/ui/',
  plugins: [react(), serviceWorker()],
  resolve: {
    // The one file that works out the workspace's look, shared with the server and the classic pages (see src/types/theme-core.d.ts).
    alias: {
      '@theme-core': fileURLToPath(new URL('../../public/assets/theme-core.js', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  // `npm run dev -w apps/web` serves the app on its own; the API, the install manifests and the icons are the server's.
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/manifest-dashboard.json': 'http://localhost:3000',
      '/manifest-employee.json': 'http://localhost:3000',
      '/icons': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'sw-plugin.test.ts'],
    // The module registry is whatever `modules/*/index.ts` files there are (import.meta.glob), which a cache keyed on the
    // registry's own text cannot know: a module added since the last run would be missing from it, and its tests fail oddly.
    fsModuleCache: false,
  },
});
