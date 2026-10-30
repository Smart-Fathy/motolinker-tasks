import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The app is served by the Node server, not by Vite: `npm run build` writes apps/web/dist, and
// src/routes/shell.js sends dist/index.html (with the workspace's look written into it, the way the classic
// portals' pages are) at /dashboard and /employee for anyone who has switched to the new app, and the hashed
// files in dist at /ui. So every URL the build writes is under /ui/.
export default defineConfig({
  base: '/ui/',
  plugins: [react()],
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
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
