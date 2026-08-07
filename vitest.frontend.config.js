import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Added 2026-08-07 alongside vitest.config.js (which is deliberately
// Node-only, for api/lib). This config exists specifically to allow real
// simulation tests against frontend logic extracted into standalone,
// exported functions (e.g. computeAssistantMessagesFromResult in
// ProjectChat.jsx) — a genuine gap identified directly: prior tests for
// frontend rendering decisions were unit/structural only, never an
// actual simulation of a realistic result object through the real
// function.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.js'],
  },
});
