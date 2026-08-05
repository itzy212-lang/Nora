import { defineConfig } from 'vitest/config';

// Separate from vite.config.js deliberately: the main Vite config is for the
// React/Capacitor frontend build (jsx, portal.html, capacitor sync targets).
// Phase 1 tests only exercise plain Node ESM modules under api/lib — no DOM,
// no React plugin needed. Keeping this config isolated avoids coupling the
// frontend build pipeline to the backend unit-test pipeline.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['api/lib/__tests__/**/*.test.js'],
  },
});
